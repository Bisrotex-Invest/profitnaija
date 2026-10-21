import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  runTransaction,
  onSnapshot,
  orderBy,
  limit,
  query,
  where,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, getAuthInstance } from '@/lib/firebase';
import { extractVATAmount, getVATExclusiveSuggestedPrice } from '@/lib/utils/price';
import { normalizeSaleEntry } from '@/lib/utils/formulas';
import { buildPnLReport, calcCostBalance, calcCostForEntries, calcDirectExpensesForEntries, calcInventoryPurchasesForEntries, calcInventoryValueAsOf, calcNigerianPIT, calcNetRevenue, calcTotalSales, getPurchaseBaseCost, getSaleValue } from '@/lib/utils/formulas';
import { normalizeNigerianPhone, normalizePartyName } from '@/lib/utils/party';

function withoutUndefined<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined),
  ) as T;
}
import { useAuth } from '@/context/AuthContext';
import { useProfile } from '@/context/ProfileContext';
import {
  createLinkedCreditPayment,
  updateLinkedCreditPayment,
  deleteLinkedCreditPayment,
  updateLinkedCredit,
  deleteLinkedCredit,
  getBackupStatus,
  setAuthTokenGetter,
  setBaseUrl,
} from '@workspace/api-client-react';

setBaseUrl(process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}` : null);
setAuthTokenGetter(async () => {
  const auth = await getAuthInstance();
  return auth.currentUser?.getIdToken() ?? null;
});

// ── Offline queue ─────────────────────────────────────────────────────────────
export const OFFLINE_QUEUE_KEY = 'pn_offline_queue';

interface QueuedWrite {
  id: string;
  col: string;
  segments: string[];
  documentId?: string;
  data: Record<string, any>;
  savedAt: number;
  partyIdentity?: { kind: 'customer' | 'supplier'; canonicalPhone: string; normalizedName: string };
  customerUpsert?: { customerId: string; fields: Record<string, any> };
  stockOperation?: {
    productId: string; stockDelta: number; movementId: string; reason: string;
    productName: string; entryType: EntryType; stockValueImpact: number;
    inventoryPurchase?: boolean; industry?: string; markup?: number; suggestedPrice?: number;
  };
  transactional?: boolean;
  rejectedReason?: string;
}

/** Write to AsyncStorage queue. Returns the item id so the caller can dequeue on success. */
async function enqueueOffline(
  segments: string[],
  data: Record<string, any>,
  partyIdentity?: QueuedWrite['partyIdentity'],
  documentId?: string,
  customerUpsert?: QueuedWrite['customerUpsert'],
  stockOperation?: QueuedWrite['stockOperation'],
): Promise<string> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  const queue: QueuedWrite[] = raw ? JSON.parse(raw) : [];
  const id = `${Date.now()}-${Math.random()}`;
  queue.push({
    id,
    col: 'users',
    segments,
    data,
    savedAt: Date.now(),
    transactional: true,
    ...(partyIdentity ? { partyIdentity } : {}),
    ...(documentId ? { documentId } : {}),
    ...(customerUpsert ? { customerUpsert } : {}),
    ...(stockOperation ? { stockOperation } : {}),
  });
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  console.log('[offlineQueue] enqueued. Total pending:', queue.length);
  return id;
}

/** Remove one item from the queue by id (called after a successful Firestore write). */
async function dequeueOffline(id: string): Promise<void> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return;
  const queue: QueuedWrite[] = JSON.parse(raw);
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue.filter((q) => q.id !== id)));
}

/** How many items are currently waiting in the offline queue. */
async function getQueueCount(): Promise<number> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  return raw ? (JSON.parse(raw) as QueuedWrite[]).length : 0;
}

async function drainOfflineQueue(): Promise<{ remaining: number; rejectedSupplierReturns: number }> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return { remaining: 0, rejectedSupplierReturns: 0 };
  const queue: QueuedWrite[] = JSON.parse(raw);
  if (!queue.length) return { remaining: 0, rejectedSupplierReturns: 0 };
  console.log('[offlineQueue] draining', queue.length, 'queued writes…');
  const remaining: QueuedWrite[] = [];
  let rejectedSupplierReturns = 0;
  for (const item of queue) {
    if (item.rejectedReason) {
      remaining.push(item);
      rejectedSupplierReturns++;
      continue;
    }
    try {
      // 10-second per-item timeout prevents the drain from hanging forever
      // when Firestore is unreachable (no timeout = addDoc never resolves).
      const write = (item.transactional || item.partyIdentity || item.customerUpsert || item.stockOperation)
        ? runTransaction(db, async (tx) => {
            const userId = item.segments[0];
            const subName = item.segments[1];
            const identityRef = item.partyIdentity
              ? doc(db, 'users', userId, 'partyIdentities', `${item.partyIdentity.kind}_${item.partyIdentity.canonicalPhone}`) : null;
            const identitySnap = identityRef ? await tx.get(identityRef) : null;
            if (item.partyIdentity && identitySnap?.exists() && normalizePartyName(identitySnap.data()?.normalizedName) !== item.partyIdentity.normalizedName) {
              throw new Error(`This phone number is already used for a different ${item.partyIdentity.kind}.`);
            }
            // Reuse the original preallocated ID on every retry. For queue
            // records created before documentId existed, the stable queue ID
            // is a safe one-time fallback.
            const entryRef = doc(db, 'users', userId, subName, item.documentId ?? item.id);
            const existingEntry = await tx.get(entryRef);
            if (existingEntry.exists()) return;
            const stock = item.stockOperation;
            const productRef = stock ? doc(db, 'users', userId, 'products', stock.productId) : null;
            const movementRef = stock ? doc(db, 'users', userId, 'stockMovements', stock.movementId) : null;
            const productSnap = productRef ? await tx.get(productRef) : null;
            const movementSnap = movementRef ? await tx.get(movementRef) : null;
            const customerRef = item.customerUpsert
              ? doc(db, 'users', userId, 'customers', item.customerUpsert.customerId) : null;
            const customerSnap = customerRef ? await tx.get(customerRef) : null;
            if (stock && (!productSnap?.exists() || movementSnap?.exists())) {
              if (!productSnap?.exists()) throw new Error('This product no longer exists.');
              return;
            }
            if (stock) {
              const product = productSnap!.data()!;
              if (item.data.type === 'return_outward') {
                const savedBaseCost = Number(item.data.baseCostSnapshot);
                const savedQuantity = Number(item.data.unitsSold);
                const currentBaseCost = Number(product.costPrice);
                const expectedCredit = Math.round(savedBaseCost * savedQuantity * 100) / 100;
                if (!Number.isFinite(savedBaseCost) || savedBaseCost <= 0 ||
                  !Number.isFinite(savedQuantity) || savedQuantity <= 0 ||
                  !Number.isFinite(currentBaseCost) || currentBaseCost <= 0 ||
                  Math.abs(currentBaseCost - savedBaseCost) > 0.005 ||
                  Math.abs(Number(item.data.unitSalesPrice) - savedBaseCost) > 0.005 ||
                  Math.abs(Number(item.data.amount) - expectedCredit) > 0.005) {
                  const staleError = new Error('The product base cost changed while this supplier return was offline. Refresh the product and record the return again.');
                  (staleError as any).code = 'STALE_SUPPLIER_RETURN_COST';
                  throw staleError;
                }
              }
              const currentStock = Number(product.currentStock ?? product.stockQty ?? 0);
              const nextStock = currentStock + stock.stockDelta;
              if (nextStock < 0) throw new Error(`Not enough stock. Only ${currentStock} unit${currentStock === 1 ? '' : 's'} left.`);
              const currentCost = Number(product.costPrice ?? 0);
              const valueChange = stock.inventoryPurchase
                ? stock.stockValueImpact
                : stock.entryType === 'sale' || stock.entryType === 'credit_sale'
                  ? stock.stockDelta * currentCost
                  : stock.stockValueImpact;
              const nextValue = Math.max(0, currentStock * currentCost + valueChange);
              const nextCost = nextStock > 0 ? nextValue / nextStock : currentCost;
              tx.update(productRef!, {
                stockQty: nextStock, currentStock: nextStock,
                stockCost: nextValue,
                latestStockEventId: entryRef.id,
                stockRevision: Number(product.stockRevision ?? 0) + 1,
                ...(stock.inventoryPurchase ? {
                  costPrice: nextCost,
                  ...(stock.industry ? { industry: stock.industry } : {}),
                  ...(typeof stock.markup === 'number' ? { markup: stock.markup } : {}),
                  ...(typeof stock.suggestedPrice === 'number' ? {
                    suggestedPrice: stock.suggestedPrice,
                    vatExclusive: true,
                    vat: extractVATAmount(stock.suggestedPrice),
                  } : {}),
                } : {}),
              });
              tx.set(movementRef!, {
                productId: stock.productId, productName: stock.productName,
                type: stock.stockDelta > 0 ? 'IN' : 'OUT', qty: Math.abs(stock.stockDelta),
                reason: stock.reason, sourceEntryId: entryRef.id, date: item.data.date,
                userId, createdAt: new Date(item.savedAt),
              });
            }
            if (item.customerUpsert) {
              const current = customerSnap?.exists() ? customerSnap.data() : {};
              const missing = Object.fromEntries(Object.entries(item.customerUpsert.fields)
                .filter(([key, value]) => value !== undefined && value !== '' && !current[key]));
              if (!customerSnap?.exists()) tx.set(customerRef!, { ...item.customerUpsert.fields, userId, createdAt: new Date(item.savedAt) });
              else if (Object.keys(missing).length) tx.update(customerRef!, missing);
            }
            if (item.partyIdentity && identityRef && !identitySnap?.exists()) tx.set(identityRef, { ...item.partyIdentity, userId });
            tx.set(entryRef, { ...item.data, createdAt: new Date(item.savedAt), _syncedAt: Date.now() });
          })
        : addDoc(collection(db, item.col, ...item.segments), {
            ...item.data,
            createdAt: new Date(item.savedAt),
            _syncedAt: Date.now(),
          });
      await Promise.race([
        write,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DRAIN_TIMEOUT')), 10_000),
        ),
      ]);
      console.log('[offlineQueue] synced:', item.segments.join('/'));
    } catch (e: any) {
      if (e?.code === 'STALE_SUPPLIER_RETURN_COST') {
        rejectedSupplierReturns++;
        console.error('[offlineQueue] rejected stale supplier return:', item.segments.join('/'), e?.message);
        remaining.push({ ...item, rejectedReason: String(e?.message ?? 'Supplier return cost changed before sync.') });
      } else {
        console.warn('[offlineQueue] sync failed, keeping:', item.segments.join('/'), e?.code ?? e?.message);
        remaining.push(item);
      }
    }
  }
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  console.log('[offlineQueue] drain done. Still pending:', remaining.length);
  return { remaining: remaining.length, rejectedSupplierReturns };
}

// ── Sync status ───────────────────────────────────────────────────────────────
export type SyncStatus = 'synced' | 'pending' | 'syncing';

// Thrown by addEntry/addProduct when the write falls back to offline storage.
export class OfflineSaveError extends Error {
  readonly savedOffline = true;
  constructor() { super('SAVED_OFFLINE'); }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type EntryType =
  | 'sale'
  | 'credit_sale'
  | 'credit_sale_payment'
  | 'expense'
  | 'purchase'
  | 'credit_purchase'
  | 'credit_purchase_payment'
  | 'opening_stock'
  | 'closing_stock'
  | 'return_inward'
  | 'return_outward'
  | 'opening_balance'
  | 'owner_contribution'
  | 'owner_drawings'
  | 'financial_record';

export type PaymentMode = 'cash' | 'bank' | 'credit' | 'non_cash';

export type LinkedCreditKind = 'sale' | 'purchase' | 'expense';

export interface Entry {
  returnCreditEntryId?: string;
  returnCreditKind?: 'sale' | 'purchase';
  returnCreditReference?: string;
  linkedCreditKind?: LinkedCreditKind;
  paymentMode?: PaymentMode;
  id: string;
  type: EntryType;
  amount: number;
  category: string;
  notes: string;
  date: string;
  createdAt: number;
  itemName?: string;
  partyName?: string;        // customer for credit sales; supplier for credit purchases
  partyPhone?: string;       // phone number for the customer or supplier
  partyAddress?: string;
  partyEmail?: string;
  customerId?: string;
  baseCost?: number;
  materialCosts?: number[];
  unitPurchasePrice?: number;
  purchaseAmount?: number;   // base purchase plus other purchase charges, excluding carriage/handling
  carriageInward?: number;
  handlingCost?: number;     // handling / packaging cost on a purchase
  totalLandedCost?: number;
  industry?: string;
  markup?: number;
  suggestedPrice?: number;
  cogsAmount?: number;       // cost of goods for this sale = qty × costPrice
  baseCostSnapshot?: number; // immutable unit cost captured when goods were returned
  /** Full inventory carrying value removed on a supplier return, including allocated landed costs. */
  returnLandedCost?: number;
  /** Original supplier credit retained as an audit value after legacy correction. */
  supplierCreditOriginalAmount?: number;
  /** Presence of this timestamp marks a historical supplier-credit correction. */
  supplierCreditCorrectionAt?: number;
  // sale-specific
  vatExclusive?: boolean;
  purchaseVatCharged?: boolean;
  purchaseVAT?: number;
  withholdingTax?: number;
  supplierPayable?: number;
  unitSalesPrice?: number;   // price per unit sold
  unitsSold?: number;        // number of units sold
  returns?: number;          // returns deducted from this sale
  vatPaid?: number;          // VAT remitted to FIRS on this sale (unitsSold × product.vat)
  returnVat?: number;        // immutable VAT snapshot for return-inward reversals
  unitsPurchased?: number;   // units bought (purchase entries)
  productId?: string;        // product affected by a sale, purchase, or return
  stockDelta?: number;       // stock change committed together with the entry
  stockMovementReason?: string;
  stockMovementId?: string;  // stable link to the movement created with this entry
  linkedCreditEntryId?: string;
  allocatedVat?: number;
  openingBalances?: import('@workspace/accounting-core').OpeningBalances;
  finance?: import('@workspace/accounting-core').FinanceRecord;
  ownerName?: string;
  reference?: string;
  ledgerRevision?: number;
  ledgerStatus?: 'active' | 'void';
  confirmed?: boolean;
}

export interface Product {
  id: string;
  name: string;
  costPrice: number;
  industry: string;
  markup: number;
  suggestedPrice: number;
  date: string;
  createdAt: number;
  sourceEntryId?: string;
  stockQty: number;   // units on hand; 0 = out of stock
  stockCost?: number; // total live inventory value at weighted-average cost
  vat?: number;       // VAT per unit in ₦ = extractVATAmount(suggestedPrice)
  archived?: boolean;
  vatExclusive?: boolean;
  latestStockEventId?: string;
  stockRevision?: number;
}

export interface StockMovement {
  id: string;
  productId: string;
  productName: string;
  type: 'IN' | 'OUT';
  qty: number;
  reason: string;
  date: string;        // ISO date string YYYY-MM-DD
  createdAt: number;
}

interface EntriesContextValue {
  entries: Entry[];
  loading: boolean;
  error: string | null;
  retry: () => void;
  addEntry: (entry: Omit<Entry, 'id' | 'createdAt'>) => Promise<void>;
  addPurchaseWithProduct: (entry: Omit<Entry, 'id' | 'createdAt'>, product: Omit<Product, 'id' | 'createdAt' | 'stockQty'>) => Promise<void>;
  updateEntry: (entryId: string, type: EntryType, entry: Omit<Entry, 'id' | 'createdAt'>) => Promise<void>;
  correctSupplierReturnLandedCost: (entryId: string, totalLandedCost: number) => Promise<void>;
  deleteEntry: (entryId: string, type: EntryType) => Promise<void>;
  totalSales: number;          // gross cash + credit sales, before separate VAT calculation
  totalReturnInwards: number;  // sum of return_inward entries
  totalRevenue: number;        // gross sales less gross returns inward; VAT is reported separately
  totalExpenses: number;
  totalVATPaid: number;      // VAT remitted to FIRS across all sales
  totalCost: number;         // all purchase costs (base + carriage + handling)
  pnlRevenue: number;        // total revenue used for P&L
  pnlCost: number;           // inventory-based COGS used for P&L
  totalCostPrice: number;    // current stock value (available qty × costPrice)
  totalPurchaseCost: number;
  openingStock: number;
  closingStock: number;
  netProfit: number;
  grossProfit: number;       // Revenue − COGS
  profitBeforeTax: number;   // grossProfit − (totalExpenses + totalVATPaid)
  incomeTax: number;         // profitBeforeTax × user-set tax rate (profile)
  totalCOGS: number;         // Opening + Purchases − Closing
  products: Product[];
  productsLoading: boolean;
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<void>;
  updateProduct: (productId: string, data: Partial<Omit<Product, 'id' | 'createdAt'>>) => Promise<void>;
  deleteProduct: (productId: string) => Promise<void>;
  updateProductStock: (productId: string, delta: number) => Promise<void>;
  stockMovements: StockMovement[];
  stockMovementsLoading: boolean;
  addStockMovement: (
    productId: string,
    productName: string,
    qty: number,
    type: 'IN' | 'OUT',
    reason?: string,
  ) => Promise<void>;
  syncStatus: SyncStatus;
  pendingCount: number;
}

const FIRESTORE_TIMEOUT_MS = 8000;   // reduced from 15s — shows error faster
const STOCK_MOVEMENTS_LIMIT = 100;

function subcollectionForType(type: EntryType): string {
  switch (type) {
    case 'sale':
    case 'credit_sale':
    case 'credit_sale_payment': return 'sales';
    case 'purchase':
    case 'credit_purchase':
    case 'credit_purchase_payment': return 'purchases';
    case 'expense':         return 'expenses';
    case 'return_inward':   return 'returns';
    case 'return_outward':  return 'returns';
    case 'opening_stock':
    case 'closing_stock':   return 'stock';
    case 'opening_balance':
    case 'owner_contribution':
    case 'owner_drawings':
    case 'financial_record': return 'accountingLedger';
  }
}

const EntriesContext = createContext<EntriesContextValue | undefined>(undefined);

// ── Provider ──────────────────────────────────────────────────────────────────

export function EntriesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.uid ?? null;
  const { profile } = useProfile();
  const incomeTaxRateRaw = profile.incomeTaxRate;

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountingError, setAccountingError] = useState<string | null>(null);
  const [accountingReady, setAccountingReady] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  const [stockMovements, setStockMovements] = useState<StockMovement[]>([]);
  const [stockMovementsLoading, setStockMovementsLoading] = useState(true);

  // Start as 'syncing' so the chip shows "Connecting…" until the first queue
  // check resolves — gives the user visible feedback that the app is starting up.
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('syncing');
  const [pendingCount, setPendingCount] = useState(0);

  // Per-subcollection caches — merged into `entries` whenever any updates
  const salesRef     = useRef<Entry[]>([]);
  const purchasesRef = useRef<Entry[]>([]);
  const expensesRef  = useRef<Entry[]>([]);
  const stockRef     = useRef<Entry[]>([]);
  const returnsRef   = useRef<Entry[]>([]);
  const accountingRef = useRef<Entry[]>([]);
  const vatBackfilledRef = useRef<Set<string>>(new Set());
  const supplierReturnCorrectionInFlightRef = useRef<Set<string>>(new Set());

  const rebuildEntries = useCallback(() => {
    const all = [
      ...salesRef.current,
      ...purchasesRef.current,
      ...expensesRef.current,
      ...stockRef.current,
      ...returnsRef.current,
      ...accountingRef.current.filter(entry => entry.ledgerStatus !== 'void'),
    ].sort((a, b) => b.createdAt - a.createdAt);
    setEntries(all.map(normalizeSaleEntry));
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setEntries([]);
    setProducts([]);
    setProductsLoading(true);
    setStockMovements([]);
    setStockMovementsLoading(true);
    salesRef.current     = [];
    purchasesRef.current = [];
    expensesRef.current  = [];
    stockRef.current     = [];
    returnsRef.current   = [];
    accountingRef.current = [];
    setAccountingError(null);
    setAccountingReady(false);
    setRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    setEntries([]);
    setProducts([]);
    setError(null);
    setStockMovements([]);
    salesRef.current     = [];
    purchasesRef.current = [];
    expensesRef.current  = [];
    stockRef.current     = [];
    returnsRef.current   = [];
    accountingRef.current = [];
    setAccountingError(null);
    setAccountingReady(false);

    if (!userId) {
      setLoading(false);
      setProductsLoading(false);
      setStockMovementsLoading(false);
      return;
    }

    setLoading(true);
    setProductsLoading(true);
    setStockMovementsLoading(true);

    // Diagnostic probe removed — database connection is verified working.
    // Database ID is "default" (named, not the special "(default)").
    // SDK writes confirmed via [addEntry] DONE ✓ / [addProduct] DONE ✓ logs.

    let unsubscribed = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    const unsubs: Array<() => void> = [];

    // Subscribe immediately — do NOT defer via InteractionManager.
    // Deferring caused Device A to see zero entries because the callback
    // never fired (or fired after the 15s timeout already expired).
    (() => {
      if (unsubscribed) return;

      // Timeout guard
      timeoutId = setTimeout(() => {
        if (!unsubscribed) {
          setError('Connection timed out. Check your internet and Firestore rules, then tap Retry.');
          setLoading(false);
          setProductsLoading(false);
          setStockMovementsLoading(false);
        }
      }, FIRESTORE_TIMEOUT_MS);

      // Track when all 5 entry subcollections have fired at least once
      const resolvedCollections = new Set<string>();
      const onEntryReady = (name: string) => {
        if (name === 'accountingLedger') setAccountingReady(true);
        resolvedCollections.add(name);
        if (resolvedCollections.size >= 6) {
          clearTimeout(timeoutId);
          setLoading(false);
        }
      };

      const mapEntry = (docSnap: any, defaultType: EntryType): Entry => {
        const d = docSnap.data();
        return {
          id: docSnap.id,
          type: (d.type ?? defaultType) as EntryType,
          amount: d.amount ?? 0,
          category: d.category ?? '',
          notes: d.notes ?? '',
          date: d.date ?? '',
          createdAt: d.createdAt?.toMillis() ?? Date.now(),
          itemName: d.itemName,
          paymentMode: d.paymentMode,
          linkedCreditKind: d.linkedCreditKind,
          returnCreditEntryId: d.returnCreditEntryId,
          returnCreditKind: d.returnCreditKind,
          returnCreditReference: d.returnCreditReference,
           partyName: d.partyName,
           partyPhone: d.partyPhone,
           partyAddress: d.partyAddress,
           partyEmail: d.partyEmail,
           customerId: d.customerId,
           linkedCreditEntryId: d.linkedCreditEntryId,
           allocatedVat: d.allocatedVat,
          openingBalances: d.openingBalances,
          finance: d.finance,
          ownerName: d.ownerName,
          reference: d.reference,
          ledgerRevision: d.ledgerRevision,
          ledgerStatus: d.ledgerStatus,
          confirmed: d.confirmed,
          baseCost: d.baseCost,
          materialCosts: d.materialCosts,
          unitPurchasePrice: d.unitPurchasePrice,
          purchaseAmount: d.purchaseAmount,
          carriageInward: d.carriageInward,
          handlingCost: d.handlingCost,
          totalLandedCost: d.totalLandedCost,
          industry: d.industry,
          markup: d.markup,
          suggestedPrice: d.suggestedPrice === undefined ? undefined : getVATExclusiveSuggestedPrice(d),
          cogsAmount: d.cogsAmount,
           baseCostSnapshot: d.baseCostSnapshot,
          returnLandedCost: d.returnLandedCost,
          supplierCreditOriginalAmount: d.supplierCreditOriginalAmount,
          supplierCreditCorrectionAt: d.supplierCreditCorrectionAt,
          unitSalesPrice: d.unitSalesPrice,
          unitsSold: d.unitsSold,
          returns: d.returns,
          vatPaid: d.vatPaid,
          vatExclusive: d.vatExclusive ?? (
            ['purchase', 'credit_purchase'].includes(d.type ?? defaultType) && d.suggestedPrice !== undefined ? true : undefined
          ),
          purchaseVatCharged: d.purchaseVatCharged,
          purchaseVAT: d.purchaseVAT,
          withholdingTax: d.withholdingTax,
          supplierPayable: d.supplierPayable,
           returnVat: d.returnVat,
          unitsPurchased: d.unitsPurchased,
          productId: d.productId,
           stockDelta: d.stockDelta,
           stockMovementReason: d.stockMovementReason,
           stockMovementId: d.stockMovementId,
        };
      };

      const subscribeEntries = (
        subName: string,
        defaultType: EntryType,
        cacheRef: React.MutableRefObject<Entry[]>,
      ) => {
        try {
          const q = query(
            collection(db, `users/${userId}/${subName}`),
            orderBy('createdAt', 'desc'),
          );
          const unsub = onSnapshot(
            q,
            (snap) => {
              if (unsubscribed) return;
              cacheRef.current = snap.docs.map((d) => ({...mapEntry(d, defaultType),finance:subName==='accountingLedger'?d.data().finance:undefined}));
              rebuildEntries();
              onEntryReady(subName);
              if (subName === 'accountingLedger') setAccountingError(null);
              setError(null);

              // Backfill legacy supplier credits only from confirmed server
              // snapshots. Cached/offline and locally pending writes must not
              // cause a correction attempt based on stale optimistic data.
              if (subName === 'returns' && !snap.metadata.fromCache) {
                snap.docs.forEach((returnSnap) => {
                  if (returnSnap.metadata.hasPendingWrites) return;
                  const d = returnSnap.data();
                  if ((d.type ?? defaultType) !== 'return_outward' ||
                    d.supplierCreditCorrectionAt != null) return;
                  const baseCost = d.baseCostSnapshot;
                  const quantity = d.unitsSold;
                  const landedCost = d.returnLandedCost;
                  const currentAmount = d.amount;
                  if (typeof baseCost !== 'number' || !Number.isFinite(baseCost) || baseCost <= 0 ||
                    typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0 ||
                    typeof currentAmount !== 'number' || !Number.isFinite(currentAmount)) return;
                  const targetAmount = Math.round(baseCost * quantity * 100) / 100;
                  if ((typeof landedCost === 'number' && Number.isFinite(landedCost) &&
                    targetAmount > landedCost + 0.005) ||
                    Math.abs(currentAmount - targetAmount) < 0.005) return;

                  const correctionKey = `${userId}/${returnSnap.id}`;
                  if (supplierReturnCorrectionInFlightRef.current.has(correctionKey)) return;
                  supplierReturnCorrectionInFlightRef.current.add(correctionKey);
                  const correctionAt = Date.now();
                  runTransaction(db, async (tx) => {
                    const fresh = await tx.get(returnSnap.ref);
                    if (!fresh.exists()) return;
                    const current = fresh.data();
                    if ((current.type ?? defaultType) !== 'return_outward' ||
                      current.supplierCreditCorrectionAt != null) return;
                    const freshBaseCost = current.baseCostSnapshot;
                    const freshQuantity = current.unitsSold;
                    const freshLandedCost = current.returnLandedCost;
                    const oldCredit = current.amount;
                    if (typeof freshBaseCost !== 'number' || !Number.isFinite(freshBaseCost) || freshBaseCost <= 0 ||
                      typeof freshQuantity !== 'number' || !Number.isFinite(freshQuantity) || freshQuantity <= 0 ||
                      typeof oldCredit !== 'number' || !Number.isFinite(oldCredit)) return;
                    const freshTarget = Math.round(freshBaseCost * freshQuantity * 100) / 100;
                    if ((typeof freshLandedCost === 'number' && Number.isFinite(freshLandedCost) &&
                      freshTarget > freshLandedCost + 0.005) ||
                      Math.abs(oldCredit - freshTarget) < 0.005) return;
                    tx.update(returnSnap.ref, {
                      amount: freshTarget,
                      unitSalesPrice: freshBaseCost,
                      supplierCreditOriginalAmount: oldCredit,
                      supplierCreditCorrectionAt: correctionAt,
                    });
                  }).catch((e) => {
                    console.warn('[supplier return credit migration] failed for', returnSnap.id, e?.message ?? e);
                    if (!unsubscribed) {
                      setError('Could not correct an older supplier return. Reconnect and refresh to retry.');
                    }
                  }).finally(() => {
                    supplierReturnCorrectionInFlightRef.current.delete(correctionKey);
                  });
                });
              }
            },
            (err) => {
              if (unsubscribed) return;
              console.error(`[Firestore] ${subName}:`, err.code, err.message);
              onEntryReady(subName);
              if (subName === 'accountingLedger') setAccountingError('Opening balances and owner movements could not be loaded. Retry before relying on money balances.');
              setError(humanizeError(err));
            },
          );
          unsubs.push(unsub);
        } catch (e: any) {
          console.error(`[Firestore] subscribe(${subName}) threw:`, e);
          onEntryReady(subName);
          if (subName === 'accountingLedger') setAccountingError('Opening balances and owner movements could not be loaded. Retry before relying on money balances.');
        }
      };

      subscribeEntries('sales',     'sale',           salesRef);
      subscribeEntries('purchases', 'purchase',       purchasesRef);
      subscribeEntries('expenses',  'expense',        expensesRef);
      subscribeEntries('stock',     'opening_stock',  stockRef);
      subscribeEntries('returns',   'return_inward',  returnsRef);
      subscribeEntries('accountingLedger', 'opening_balance', accountingRef);

      // Products subcollection
      try {
        const prodQ = query(
          collection(db, `users/${userId}/products`),
          orderBy('createdAt', 'desc'),
        );
        const prodUnsub = onSnapshot(
          prodQ,
          (snap) => {
            if (unsubscribed) return;
            setProducts(
              snap.docs.map((docSnap) => {
                const d = docSnap.data();
                return {
                  id: docSnap.id,
                  name: d.name ?? '',
                  costPrice: d.costPrice ?? 0,
                  industry: d.industry ?? '',
                  markup: d.markup ?? 0,
                  suggestedPrice: getVATExclusiveSuggestedPrice(d),
                  vatExclusive: true,
                  date: d.date ?? '',
                   createdAt: d.createdAt?.toMillis() ?? Date.now(),
                  // support both old 'stockQty' and new 'currentStock' field names
                  stockQty: d.currentStock ?? d.stockQty ?? 0,
                   stockCost: d.stockCost,
                  vat: extractVATAmount(getVATExclusiveSuggestedPrice(d)),
                   archived: d.archived === true,
                   latestStockEventId: d.latestStockEventId,
                   stockRevision: d.stockRevision ?? 0,
                };
              }),
            );
            setProductsLoading(false);

            // Correct old VAT-added suggestions once, marking the stored base
            // price so future reads and restocks never remove VAT again.
            snap.docs.forEach((docSnap) => {
              const d = docSnap.data();
              const needsFix = d.vatExclusive !== true && (d.suggestedPrice ?? 0) > 0;
              if (!needsFix || vatBackfilledRef.current.has(docSnap.id)) return;
              // Mark once per session regardless of outcome (a failure will be
              // retried on a later session, not hammered within this one).
              vatBackfilledRef.current.add(docSnap.id);
              // Re-read under a transaction to preserve concurrent price edits.
              runTransaction(db, async (tx) => {
                const fresh = await tx.get(docSnap.ref);
                if (!fresh.exists()) return;
                const fd = fresh.data();
                const price = getVATExclusiveSuggestedPrice(fd);
                if (fd.vatExclusive !== true && price > 0) {
                  tx.update(docSnap.ref, { suggestedPrice: price, vat: extractVATAmount(price), vatExclusive: true });
                }
              }).catch((e) => {
                console.warn('[Suggested price correction]', e?.message);
                if (!unsubscribed) setError('Could not save an older suggested-price correction. Reconnect and retry.');
              });
            });
          },
          (err) => {
            if (unsubscribed) return;
            console.error('[Firestore] products:', err.code, err.message);
            setProductsLoading(false);
          },
        );
        unsubs.push(prodUnsub);
      } catch {
        setProductsLoading(false);
      }

      // Stock movements subcollection (last 100, newest first)
      try {
        const movQ = query(
          collection(db, `users/${userId}/stockMovements`),
          orderBy('createdAt', 'desc'),
          limit(STOCK_MOVEMENTS_LIMIT),
        );
        const movUnsub = onSnapshot(
          movQ,
          (snap) => {
            if (unsubscribed) return;
            setStockMovements(
              snap.docs.map((docSnap) => {
                const d = docSnap.data();
                return {
                  id: docSnap.id,
                  productId: d.productId ?? '',
                  productName: d.productName ?? '',
                  type: d.type ?? 'IN',
                  qty: d.qty ?? 0,
                  reason: d.reason ?? '',
                  date: d.date ?? '',
                  createdAt: d.createdAt?.toMillis() ?? Date.now(),
                   sourceEntryId: d.sourceEntryId,
                } as StockMovement;
              }),
            );
            setStockMovementsLoading(false);
          },
          (err) => {
            if (unsubscribed) return;
            console.error('[Firestore] stockMovements:', err.code, err.message);
            setStockMovementsLoading(false);
          },
        );
        unsubs.push(movUnsub);
      } catch {
        setStockMovementsLoading(false);
      }
    })();   // ← IIFE: must be invoked or no subscriptions are ever set up

    return () => {
      unsubscribed = true;
      clearTimeout(timeoutId!);
      unsubs.forEach((u) => u());
    };
  }, [userId, retryKey, rebuildEntries]);

  // One-time, customer-only migration for legacy credit sales. The marker is
  // written last, so an interrupted/offline run is safe to retry.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const markerRef = doc(db, 'users', userId, 'migrationMarkers', 'customerAutoCapture_v2');
      const marker = await getDoc(markerRef);
      if (marker.exists() || cancelled) return;
      // Include legacy random-id profiles in the match map. This prevents the
      // migration from creating deterministic duplicates for existing phones.
      const customerSnap = await getDocs(collection(db, 'users', userId, 'customers'));
      const customersByPhone = new Map<string, { id: string; data: any }>();
      customerSnap.docs.forEach((customer) => {
        const data = customer.data();
        const phone = normalizeNigerianPhone(data.normalizedPhone || data.phone);
        if (phone && !customersByPhone.has(phone)) customersByPhone.set(phone, { id: customer.id, data });
      });
      const snap = await getDocs(collection(db, 'users', userId, 'sales'));
      for (const source of snap.docs) {
        if (cancelled) return;
        const d = source.data();
        if ((d.type ?? 'sale') !== 'credit_sale' || (!d.partyPhone && !d.partyName)) continue;
        const phone = normalizeNigerianPhone(d.partyPhone);
        const name = normalizePartyName(d.partyName);
        const existingCustomer = d.customerId
          ? customerSnap.docs.find(customer => customer.id === d.customerId)
          : (phone ? customersByPhone.get(phone) : undefined);
        // Every phone-bearing customer is canonicalized to this stable id.
        // The old random profile is merged into it transactionally below.
        const customerId = phone ? `phone_${phone}` : (existingCustomer?.id || d.customerId || `legacy_${source.id}`);
        const customerRef = doc(db, 'users', userId, 'customers', customerId);
        const sourceRef = doc(db, 'users', userId, 'sales', source.id);
        await runTransaction(db, async (tx) => {
          const customer = await tx.get(customerRef);
          const current = customer.exists() ? customer.data() : {};
          const legacyRef = existingCustomer && existingCustomer.id !== customerId
            ? doc(db, 'users', userId, 'customers', existingCustomer.id) : null;
          const legacy = legacyRef ? await tx.get(legacyRef) : null;
          const legacyData = legacy?.exists() ? legacy.data() : {};
          const customerData: Record<string, any> = {
            userId,
            ...(d.partyName ? { fullName: d.partyName, normalizedName: name } : {}),
            ...(d.partyPhone ? { phone: d.partyPhone, normalizedPhone: phone } : {}),
            ...(d.partyAddress ? { homeAddress: d.partyAddress } : {}),
            ...(d.partyEmail ? { email: d.partyEmail } : {}),
          };
          const merged = { ...customerData };
          Object.entries(legacyData || {}).forEach(([key, value]) => {
            if (key !== 'id' && value !== undefined && value !== '' && !merged[key]) merged[key] = value;
          });
          if (!customer.exists()) tx.set(customerRef, { ...merged, createdAt: serverTimestamp() });
          else {
            const missing = Object.fromEntries(Object.entries(merged).filter(([k, v]) => k !== 'userId' && v && !current[k]));
            if (Object.keys(missing).length) tx.update(customerRef, missing);
          }
          if (legacyRef && legacy?.exists()) tx.update(legacyRef, { _mergedInto: customerId, normalizedPhone: phone });
          tx.update(sourceRef, {
            customerId,
            ...(d.partyName ? { partyName: d.partyName } : {}),
            ...(d.partyPhone ? { partyPhone: d.partyPhone } : {}),
            ...(d.partyAddress ? { partyAddress: d.partyAddress } : {}),
            ...(d.partyEmail ? { partyEmail: d.partyEmail } : {}),
          });
        });
      }
      if (!cancelled) await setDoc(markerRef, { version: 1, completedAt: serverTimestamp() });
    })().catch((error) => console.warn('[customer migration]', error?.message ?? error));
    return () => { cancelled = true; };
  }, [userId]);

  // ── Mutations ─────────────────────────────────────────────────────────────

  // Older entries did not retain stockDelta. Infer it only where the quantity
  // is explicit; this makes correcting legacy sales/restocks safe without
  // guessing from monetary amounts.
  const entryStockDelta = (entry: Partial<Entry>): number => {
    if (typeof entry.stockDelta === 'number') return entry.stockDelta;
    const qty = Number(
      entry.type === 'purchase' || entry.type === 'credit_purchase'
        ? entry.unitsPurchased
        : entry.type === 'sale' || entry.type === 'credit_sale'
          ? entry.unitsSold
          : (entry.returns ?? entry.unitsSold),
    );
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    if (entry.type === 'purchase' || entry.type === 'credit_purchase' || entry.type === 'return_inward') return qty;
    if (entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_outward') return -qty;
    return 0;
  };

  // Only item base cost affects stock value. Ancillary purchase charges stay in
  // Cost, while returns use the immutable cost snapshot captured at return time.
  const entryStockValueImpact = (entry: Partial<Entry>): number => {
    const qty = Number(entry.unitsPurchased ?? entry.unitsSold ?? 0);
    if (entry.type === 'return_inward' || entry.type === 'return_outward') {
      const unit = typeof entry.baseCostSnapshot === 'number'
        ? entry.baseCostSnapshot
        : typeof entry.cogsAmount === 'number' && qty > 0 ? entry.cogsAmount / qty : 0;
      return unit * qty * (entry.type === 'return_inward' ? 1 : -1);
    }
    if (entry.type !== 'purchase' && entry.type !== 'credit_purchase') return 0;
    if ((typeof entry.unitPurchasePrice === 'number' || typeof entry.baseCost === 'number') && qty > 0) {
      return (entry.unitPurchasePrice ?? entry.baseCost ?? 0) * qty;
    }
    const ancillary = (entry.materialCosts ?? []).reduce((sum, value) => sum + value, 0)
      + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0);
    return Math.max(0, (entry.purchaseAmount ?? entry.totalLandedCost ?? entry.amount ?? 0) - ancillary);
  };

  // This reservation is the authoritative per-user identity guard. It lives
  // in the same Firestore transaction as the original entry write, so two
  // devices cannot claim one phone for different parties concurrently.
  const reservePartyIdentity = async (tx: any, entry: Pick<Entry, 'type' | 'partyName' | 'partyPhone' | 'paymentMode'>) => {
    const kind = entry.type === 'credit_sale' ? 'customer' : (entry.type === 'credit_purchase' || (entry.type === 'expense' && entry.paymentMode === 'credit')) ? 'supplier' : null;
    const phone = normalizeNigerianPhone(entry.partyPhone);
    const name = normalizePartyName(entry.partyName);
    if (!kind || !phone || !name) return;
    const ref = doc(db, 'users', userId!, 'partyIdentities', `${kind}_${phone}`);
    const snap = await tx.get(ref);
    if (snap.exists() && normalizePartyName(snap.data()?.normalizedName) !== name) {
      throw new Error(`This phone number is already used for a different ${kind}. Use the existing name or a different phone number.`);
    }
    if (!snap.exists()) tx.set(ref, { kind, canonicalPhone: phone, normalizedName: name, userId });
  };

  const customerUpsertForEntry = (entry: Pick<Entry, 'type' | 'customerId' | 'partyName' | 'partyPhone' | 'partyAddress' | 'partyEmail'>) => {
    if ((entry.type !== 'sale' && entry.type !== 'credit_sale') || !entry.customerId) return undefined;
    return {
      customerId: entry.customerId,
      fields: withoutUndefined({
        fullName: entry.partyName?.trim(),
        phone: entry.partyPhone?.trim(),
        email: entry.partyEmail?.trim(),
        homeAddress: entry.partyAddress?.trim(),
        normalizedName: normalizePartyName(entry.partyName),
        normalizedPhone: normalizeNigerianPhone(entry.partyPhone),
      }),
    };
  };

  // ── Initial drain on login + 10-second auto-retry while items are pending ──
  useEffect(() => {
    if (!userId) { setSyncStatus('syncing'); return; }

    console.log('[EntriesContext] UID:', userId);

    // Run once immediately on login / UID change.
    const runDrain = async () => {
      const count = await getQueueCount().catch(() => 0);
      setPendingCount(count);
      if (count === 0) { setSyncStatus('synced'); return; }
      setSyncStatus('syncing');
      const result = await drainOfflineQueue().catch(() => ({ remaining: count, rejectedSupplierReturns: 0 }));
      setPendingCount(result.remaining);
      setSyncStatus(result.remaining === 0 ? 'synced' : 'pending');
      if (result.rejectedSupplierReturns > 0) {
        setError('A queued supplier return was rejected because the product base cost changed. Refresh the product and record the return again.');
      }
    };

    runDrain();

    // Retry every 10 s while items are still in the queue.
    const interval = setInterval(async () => {
      const count = await getQueueCount().catch(() => 0);
      if (count === 0) return; // nothing to do
      setSyncStatus('syncing');
      const result = await drainOfflineQueue().catch(() => ({ remaining: count, rejectedSupplierReturns: 0 }));
      setPendingCount(result.remaining);
      setSyncStatus(result.remaining === 0 ? 'synced' : 'pending');
      if (result.rejectedSupplierReturns > 0) {
        setError('A queued supplier return was rejected because the product base cost changed. Refresh the product and record the return again.');
      }
      if (result.remaining === 0) clearInterval(interval);
    }, 10_000);

    return () => clearInterval(interval);
  }, [userId]);

  // Wake the server-side scheduler whenever a signed-in business session is
  // active. This lets due daily/weekly backups run without requiring the user
  // to open the Data & Backup screen.
  useEffect(() => {
    if (!userId) return;
    const checkDueBackup = () => { void getBackupStatus().catch(() => undefined); };
    const initial = setTimeout(checkDueBackup, 5_000);
    const interval = setInterval(checkDueBackup, 6 * 60 * 60_000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [userId]);

  const addEntry = async (entry: Omit<Entry, 'id' | 'createdAt'>) => {
    if (['opening_balance', 'owner_contribution', 'owner_drawings', 'financial_record'].includes(entry.type)) throw new Error('Manage this record in Equity or Financial Controls.');
    if (!userId) throw new Error('You must be signed in to save entries.');
    await getAuthInstance();
    const subName = subcollectionForType(entry.type);
    if (entry.type === 'return_outward') {
      const baseCostSnapshot = Number(entry.baseCostSnapshot);
      const quantity = Number(entry.unitsSold);
      const targetCredit = Math.round(baseCostSnapshot * quantity * 100) / 100;
      if (!entry.productId || !Number.isFinite(baseCostSnapshot) || baseCostSnapshot <= 0 ||
        !Number.isFinite(quantity) || quantity <= 0 ||
        entry.stockDelta !== -quantity ||
        !Number.isFinite(Number(entry.unitSalesPrice)) ||
        !Number.isFinite(Number(entry.amount)) ||
        Math.abs(Number(entry.unitSalesPrice) - baseCostSnapshot) > 0.005 ||
        Math.abs(Number(entry.amount) - targetCredit) > 0.005) {
        throw new Error('Supplier returns require a selected product with a valid base cost. Refresh products and try again.');
      }
    }
    if (entry.type === 'credit_sale_payment' || entry.type === 'credit_purchase_payment') {
      if (!entry.linkedCreditEntryId) {
        throw new Error('This payment must be linked to an existing credit transaction.');
      }
      if (!(entry.amount > 0)) throw new Error('Payment amount must be greater than zero.');
      const kind: LinkedCreditKind = entry.linkedCreditKind ?? (entry.type === 'credit_sale_payment' ? 'sale' : 'purchase');
      await createLinkedCreditPayment(kind, {
        linkedCreditKind: kind,
        linkedCreditEntryId: entry.linkedCreditEntryId,
        amount: entry.amount,
        ...(entry.category !== undefined ? { category: entry.category } : {}),
        ...(entry.notes !== undefined ? { notes: entry.notes } : {}),
        ...(entry.date !== undefined ? { date: entry.date } : {}),
        ...(entry.itemName !== undefined ? { itemName: entry.itemName } : {}),
        ...(entry.partyName !== undefined ? { partyName: entry.partyName } : {}),
        ...(entry.partyPhone !== undefined ? { partyPhone: entry.partyPhone } : {}),
        ...(entry.partyAddress !== undefined ? { partyAddress: entry.partyAddress } : {}),
        ...(entry.partyEmail !== undefined ? { partyEmail: entry.partyEmail } : {}),
        ...(entry.customerId !== undefined ? { customerId: entry.customerId } : {}),
        ...(entry.paymentMode ? { paymentMode: entry.paymentMode === 'bank' ? 'bank' : 'cash' } : {}),
      });
      // Linked payments are committed by the authenticated server transaction.
      // The Firestore listener will publish the authoritative allocation.
      return;
    }
    const { stockDelta, stockMovementReason, productId, ...entryData } = entry;
    const data: Record<string, any> = withoutUndefined({ ...entryData, userId, userEmail: user?.email ?? null });
    if (typeof stockDelta === 'number') data.stockDelta = stockDelta;
    if (stockMovementReason) data.stockMovementReason = stockMovementReason;
    if (productId) data.productId = productId;

    // A sale and its stock movement are one operation. Reading the latest stock
    // in a transaction prevents concurrent sales or an old screen from sending
    // units below zero.
    if (productId && typeof stockDelta === 'number' && stockDelta !== 0) {
      const productRef = doc(db, 'users', userId, 'products', productId);
      const entryRef = doc(collection(db, 'users', userId, subName));
      const movementRef = doc(collection(db, 'users', userId, 'stockMovements'));

      let transactionPromise: Promise<any> | undefined;
      try {
      transactionPromise = runTransaction(db, async (tx) => {
        // The entry ID is preallocated and stable across online retries and
        // offline replay. Read it before every other operation so a replay
        // that wins a timeout race cannot mutate stock twice.
        const existingEntry = await tx.get(entryRef);
        if (existingEntry.exists()) return;
        const productSnap = await tx.get(productRef);
        const customer = customerUpsertForEntry(entry);
        const customerRef = customer ? doc(db, 'users', userId, 'customers', customer.customerId) : null;
        const customerSnap = customerRef ? await tx.get(customerRef) : null;
        await reservePartyIdentity(tx, entry);
        if (!productSnap.exists()) throw new Error('This product no longer exists.');
        if (customer && customerRef) {
          const current = customerSnap?.exists() ? customerSnap.data() : {};
          const missing = Object.fromEntries(Object.entries(customer.fields).filter(([k, v]) => v && !current[k]));
          if (!customerSnap?.exists()) tx.set(customerRef, { ...customer.fields, userId, createdAt: serverTimestamp() });
          else if (Object.keys(missing).length) tx.update(customerRef, missing);
        }
        const product = productSnap.data();
        if (entry.type === 'return_outward') {
          const currentBaseCost = Number(product.costPrice);
          const savedBaseCost = Number(entry.baseCostSnapshot);
          if (!Number.isFinite(currentBaseCost) || currentBaseCost <= 0 ||
            Math.abs(currentBaseCost - savedBaseCost) > 0.005) {
            throw new Error('The product base cost changed. Refresh the product and retry this supplier return.');
          }
        }
        const currentStock = Number(product.currentStock ?? product.stockQty ?? 0);
        const nextStock = currentStock + stockDelta;
        if (nextStock < 0) {
          throw new Error(`Not enough stock. Only ${currentStock} unit${currentStock === 1 ? '' : 's'} left.`);
        }

        tx.set(entryRef, {
          ...data,
          productId,
          stockMovementId: movementRef.id,
          createdAt: serverTimestamp(),
        });
        const isInventoryPurchase = entry.type === 'purchase' || entry.type === 'credit_purchase';
        const landedCost = entryStockValueImpact(entry);
        const currentCost = Number(product.costPrice ?? 0);
        const valueChange = isInventoryPurchase || entry.type === 'return_inward' || entry.type === 'return_outward'
          ? landedCost
          : stockDelta * currentCost;
        const nextValue = Math.max(0, currentStock * currentCost + valueChange);
        const nextCost = nextStock > 0 ? nextValue / nextStock : currentCost;
        tx.update(productRef, {
          stockQty: nextStock, currentStock: nextStock,
          stockCost: nextValue,
          latestStockEventId: entryRef.id,
          stockRevision: Number(product.stockRevision ?? 0) + 1,
          ...(isInventoryPurchase && stockDelta > 0 ? {
            costPrice: nextCost,
            ...(entry.industry ? { industry: entry.industry } : {}),
            ...(typeof entry.markup === 'number' ? { markup: entry.markup } : {}),
            ...(typeof entry.suggestedPrice === 'number' ? {
              suggestedPrice: entry.suggestedPrice,
              vatExclusive: true,
              vat: extractVATAmount(entry.suggestedPrice),
            } : {}),
          } : {}),
        });
        tx.set(movementRef, {
          productId,
          productName: product.name ?? entry.itemName ?? 'Product',
          type: stockDelta > 0 ? 'IN' : 'OUT',
          qty: Math.abs(stockDelta),
          reason: stockMovementReason ?? entry.type,
          sourceEntryId: entryRef.id,
          date: entry.date,
          userId,
          createdAt: serverTimestamp(),
        });
      });
      await Promise.race([
        transactionPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error('STOCK_TRANSACTION_TIMEOUT'), { code: 'deadline-exceeded' })), 5000)),
      ]);
      } catch (error: any) {
        const code = String(error?.code ?? '');
        const message = String(error?.message ?? '').toLowerCase();
        const retryable = ['unavailable', 'deadline-exceeded', 'aborted', 'internal', 'resource-exhausted'].some(part => code.includes(part))
          || /offline|network|timed out|timeout|internet|connection/.test(message);
        if (!retryable) throw error;
        if (entry.type === 'return_outward') {
          throw new Error('Supplier returns cannot be saved offline. Reconnect and retry; no supplier return was queued.');
        }
        const customer = customerUpsertForEntry(entry);
        const stockOperation = {
          productId, stockDelta, movementId: movementRef.id,
          reason: stockMovementReason ?? entry.type,
          productName: entry.itemName ?? 'Product', entryType: entry.type,
          stockValueImpact: entryStockValueImpact(entry),
          inventoryPurchase: entry.type === 'purchase' || entry.type === 'credit_purchase',
          ...(entry.industry ? { industry: entry.industry } : {}),
          ...(typeof entry.markup === 'number' ? { markup: entry.markup } : {}),
          ...(typeof entry.suggestedPrice === 'number' ? { suggestedPrice: entry.suggestedPrice } : {}),
        };
        const partyIdentity = entry.type === 'credit_sale' ? {
          kind: 'customer' as const, canonicalPhone: normalizeNigerianPhone(entry.partyPhone),
          normalizedName: normalizePartyName(entry.partyName),
        } : undefined;
        const queuedId = await enqueueOffline([userId, subName], { ...data, createdAt: Date.now() }, partyIdentity,
          entryRef.id, customer, stockOperation);
        // If the timed-out transaction eventually commits, remove this exact
        // queue item so replay cannot mutate stock a second time.
        if (typeof transactionPromise !== 'undefined') {
          transactionPromise.then(() => dequeueOffline(queuedId).catch(() => {})).catch(() => {});
        }
        throw new OfflineSaveError();
      }
      return;
    }

    // ── Write strategy: start the Firestore write immediately, wait 5s for
    //    confirmation. If it doesn't confirm in time, queue for durability but
    //    let the SDK write keep running in the background.
    //
    // IMPORTANT: the old approach (queue first, then race) caused DUPLICATE writes:
    //   1. Our 8s timeout fired → item stayed in queue
    //   2. SDK's internal write eventually succeeded (Firestore got the doc)
    //   3. Queue drain ran → wrote the doc AGAIN → duplicate
    //
    // New approach: queue ONLY if Firestore is slow. If the SDK's background
    // write later succeeds, dequeue immediately so the drain never fires for it.
    const entryRef = doc(collection(db, 'users', userId, subName));
    const customer = customerUpsertForEntry(entry);
    const firestorePromise = runTransaction(db, async (tx) => {
          const customerRef = customer ? doc(db, 'users', userId, 'customers', customer.customerId) : null;
          const customerSnap = customerRef ? await tx.get(customerRef) : null;
          await reservePartyIdentity(tx, entry);
          if (customer && customerRef) {
            const current = customerSnap?.exists() ? customerSnap.data() : {};
            const missing = Object.fromEntries(Object.entries(customer.fields).filter(([k, v]) => v && !current[k]));
            if (!customerSnap?.exists()) tx.set(customerRef, { ...customer.fields, userId, createdAt: serverTimestamp() });
            else if (Object.keys(missing).length) tx.update(customerRef, missing);
          }
          tx.set(entryRef, { ...data, createdAt: serverTimestamp() });
        });

    const UX_TIMEOUT_MS = 5000;
    let winner: 'online' | 'timeout' = 'timeout';
    try {
      winner = await Promise.race([
        firestorePromise.then(() => 'online' as const),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), UX_TIMEOUT_MS)),
      ]);
    } catch (error: any) {
      // A transaction can reject immediately when the device is offline.
      // Queue only transport/unavailability failures; identity and validation
      // conflicts must remain visible to the user.
      const code = String(error?.code ?? '');
      const message = String(error?.message ?? '').toLowerCase();
      const retryable = ['unavailable', 'deadline-exceeded', 'aborted', 'internal', 'resource-exhausted'].some(part => code.includes(part))
        || /offline|network|timed out|timeout|internet|connection/.test(message);
      if (!retryable) throw error;
      winner = 'timeout';
    }

    if (winner === 'online') {
      // Fast path — write confirmed by Firestore, no queue needed.
      const remaining = await getQueueCount();
      setPendingCount(remaining);
      if (remaining === 0) setSyncStatus('synced');
      console.log('[addEntry] DONE ✓ (confirmed by Firestore)');
      return;
    }

    // Slow / offline path — queue for cross-restart durability.
    const partyIdentity = (entry.type === 'credit_sale' || entry.type === 'credit_purchase' || (entry.type === 'expense' && entry.paymentMode === 'credit'))
      ? {
          kind: entry.type === 'credit_sale' ? 'customer' as const : 'supplier' as const,
          canonicalPhone: normalizeNigerianPhone(entry.partyPhone),
          normalizedName: normalizePartyName(entry.partyName),
        }
      : undefined;
    const customerUpsert = customerUpsertForEntry(entry);
    const localId = await enqueueOffline(
      [userId, subName],
      { ...data, createdAt: Date.now() },
      partyIdentity,
      entryRef.id,
      customerUpsert,
    );
    setPendingCount((c) => c + 1);
    setSyncStatus('pending');
    console.log('[addEntry] queued offline. Background SDK write still running…');

    // If the SDK's write eventually succeeds, dequeue immediately so the drain
    // does NOT write a duplicate copy.
    firestorePromise
      .then(async () => {
        console.log('[addEntry] background write succeeded — dequeuing to prevent duplicate');
        await dequeueOffline(localId).catch(() => {});
        const remaining = await getQueueCount().catch(() => 0);
        setPendingCount(remaining);
        if (remaining === 0) setSyncStatus('synced');
      })
      .catch(() => {
        // SDK write also failed — item stays in queue, drain will handle it later.
      });

    throw new OfflineSaveError();
  };

  // New product purchases must never be split into separately committed writes.
  // Preallocated document IDs let the entry and its movement permanently link to
  // the product in one transaction.
  const addPurchaseWithProduct = async (
    entry: Omit<Entry, 'id' | 'createdAt'>,
    product: Omit<Product, 'id' | 'createdAt' | 'stockQty'>,
  ) => {
    if (!userId) throw new Error('You must be signed in to save entries.');
    if (entry.type !== 'purchase' && entry.type !== 'credit_purchase') throw new Error('Only purchases can create a product.');
    const qty = Number(entry.unitsPurchased ?? entry.stockDelta ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Purchase quantity must be greater than zero.');
    await getAuthInstance();
    const productRef = doc(collection(db, 'users', userId, 'products'));
    const entryRef = doc(collection(db, 'users', userId, subcollectionForType(entry.type)));
    const movementRef = doc(collection(db, 'users', userId, 'stockMovements'));
    await runTransaction(db, async (tx) => {
      const landed = entryStockValueImpact(entry);
      await reservePartyIdentity(tx, entry);
      tx.set(productRef, {
        ...product, stockQty: qty, currentStock: qty, stockCost: landed,
        latestStockEventId: entryRef.id, stockRevision: 1,
        userId, userEmail: user?.email ?? null, archived: false, createdAt: serverTimestamp(),
      });
      tx.set(entryRef, {
        ...entry, productId: productRef.id, stockDelta: qty,
        stockMovementId: movementRef.id, userId, userEmail: user?.email ?? null,
        createdAt: serverTimestamp(),
      });
      tx.set(movementRef, {
        productId: productRef.id, productName: product.name, type: 'IN', qty,
        reason: entry.stockMovementReason ?? (entry.type === 'credit_purchase' ? 'Creditors' : 'Purchase'),
        date: entry.date, userId, sourceEntryId: entryRef.id, createdAt: serverTimestamp(),
      });
    });
  };

  /**
   * Record the historical TOTAL landed cost for a supplier return with no
   * recorded cost. This deliberately updates only the return entry field:
   * correcting historical information must not replay stock movements.
   */
  const correctSupplierReturnLandedCost = async (entryId: string, totalLandedCost: number) => {
    if (!userId) throw new Error('You must be signed in to correct this return.');
    if (!Number.isFinite(totalLandedCost) || totalLandedCost < 0 || Math.abs(Math.round(totalLandedCost * 100) - totalLandedCost * 100) > 0.000001) {
      throw new Error('Enter a valid total landed cost with up to two decimal places.');
    }
    await getAuthInstance();
    const entryRef = doc(db, 'users', userId, 'returns', entryId);
    await runTransaction(db, async (tx) => {
      const snapshot = await tx.get(entryRef);
      if (!snapshot.exists()) throw new Error('This supplier return no longer exists. Refresh the report and try again.');
      const current = snapshot.data();
      if (current.type !== 'return_outward') {
        throw new Error('Only supplier returns can receive a landed-cost correction.');
      }
      if (typeof current.returnLandedCost === 'number') {
        throw new Error('A landed cost is already recorded for this return. Refresh the report before making another change.');
      }
      const supplierCredit = Number(current.amount);
      if (!Number.isFinite(supplierCredit) || supplierCredit < 0) {
        throw new Error('The recorded supplier credit is invalid. Correct the return record before adding a landed cost.');
      }
      if (totalLandedCost < supplierCredit) {
        throw new Error('Total landed cost must be at least the recorded supplier credit.');
      }
      // Keep this write intentionally narrow: no amount, stock, product, or
      // stock-movement fields are read-modify-written here.
      tx.update(entryRef, { returnLandedCost: totalLandedCost });
    });
  };

  /**
   * Correct an entry and its inventory impact atomically.  The entry itself is
   * the source of truth; movement documents are an auditable projection linked
   * by stockMovementId/sourceEntryId.
   */
  const updateEntry = async (
    entryId: string,
    type: EntryType,
    entry: Omit<Entry, 'id' | 'createdAt'>,
  ) => {
    if (entries.find(e => e.id === entryId)?.returnCreditEntryId)
      throw new Error('Remove the reviewed credit link in Finance → Return credits before editing this return.');
    if (['opening_balance', 'owner_contribution', 'owner_drawings', 'financial_record'].includes(type) || ['opening_balance', 'owner_contribution', 'owner_drawings', 'financial_record'].includes(entry.type)) throw new Error('Manage this record in Equity or Financial Controls.');
    if (!userId) throw new Error('You must be signed in.');
    const subName = subcollectionForType(type);
    if (subcollectionForType(entry.type) !== subName) {
      throw new Error('Changing an entry between record types is not supported. Delete it and add the corrected entry.');
    }
    if (type === 'credit_sale' || type === 'credit_purchase' || type === 'expense') {
      const kind: LinkedCreditKind = type === 'credit_sale' ? 'sale' : type === 'expense' ? 'expense' : 'purchase';
      await updateLinkedCredit(kind, entryId, {
        ...(entry.amount !== undefined ? { amount: entry.amount } : {}),
        ...(entry.category !== undefined ? { category: entry.category } : {}),
        ...(entry.notes !== undefined ? { notes: entry.notes } : {}),
        ...(entry.date !== undefined ? { date: entry.date } : {}),
        ...(entry.itemName !== undefined ? { itemName: entry.itemName } : {}),
        ...(entry.partyName !== undefined ? { partyName: entry.partyName } : {}),
        ...(entry.partyPhone !== undefined ? { partyPhone: entry.partyPhone } : {}),
        ...(entry.partyAddress !== undefined ? { partyAddress: entry.partyAddress } : {}),
        ...(entry.partyEmail !== undefined ? { partyEmail: entry.partyEmail } : {}),
        ...(entry.customerId !== undefined ? { customerId: entry.customerId } : {}),
        ...(entry.baseCost !== undefined ? { baseCost: entry.baseCost } : {}),
        ...(entry.purchaseAmount !== undefined ? { purchaseAmount: entry.purchaseAmount } : {}),
        ...(entry.totalLandedCost !== undefined ? { totalLandedCost: entry.totalLandedCost } : {}),
        ...(entry.unitPurchasePrice !== undefined ? { unitPurchasePrice: entry.unitPurchasePrice } : {}),
        ...(entry.unitsPurchased !== undefined ? { unitsPurchased: entry.unitsPurchased } : {}),
        ...(entry.unitSalesPrice !== undefined ? { unitSalesPrice: entry.unitSalesPrice } : {}),
        ...(entry.unitsSold !== undefined ? { unitsSold: entry.unitsSold } : {}),
        ...(entry.vatPaid !== undefined ? { vatPaid: entry.vatPaid } : {}),
        ...(entry.vatExclusive !== undefined ? { vatExclusive: entry.vatExclusive } : {}),
        ...(entry.purchaseVatCharged !== undefined ? { purchaseVatCharged: entry.purchaseVatCharged } : {}),
        ...(entry.purchaseVAT !== undefined ? { purchaseVAT: entry.purchaseVAT } : {}),
        ...(entry.withholdingTax !== undefined ? { withholdingTax: entry.withholdingTax } : {}),
        ...(entry.supplierPayable !== undefined ? { supplierPayable: entry.supplierPayable } : {}),
        ...(entry.productId !== undefined ? { productId: entry.productId } : {}),
        ...(entry.stockDelta !== undefined ? { stockDelta: entry.stockDelta } : {}),
        ...(entry.stockMovementReason !== undefined ? { stockMovementReason: entry.stockMovementReason } : {}),
        ...(entry.cogsAmount !== undefined ? { cogsAmount: entry.cogsAmount } : {}),
        ...(entry.industry !== undefined ? { industry: entry.industry } : {}),
        ...(entry.markup !== undefined ? { markup: entry.markup } : {}),
        ...(entry.suggestedPrice !== undefined ? { suggestedPrice: entry.suggestedPrice } : {}),
        ...(entry.paymentMode ? { paymentMode: entry.paymentMode } : {}),
      });
      return;
    }
    if (type === 'credit_sale_payment' || type === 'credit_purchase_payment') {
      if (!entry.linkedCreditEntryId) throw new Error('This payment must remain linked to an existing credit transaction.');
      const kind: LinkedCreditKind = entry.linkedCreditKind ?? entries.find(e => e.id === entryId)?.linkedCreditKind ?? (type === 'credit_sale_payment' ? 'sale' : 'purchase');
      await updateLinkedCreditPayment(kind, entryId, {
                amount: entry.amount,
        ...(entry.category !== undefined ? { category: entry.category } : {}),
        ...(entry.notes !== undefined ? { notes: entry.notes } : {}),
        ...(entry.date !== undefined ? { date: entry.date } : {}),
        ...(entry.itemName !== undefined ? { itemName: entry.itemName } : {}),
        ...(entry.partyName !== undefined ? { partyName: entry.partyName } : {}),
        ...(entry.partyPhone !== undefined ? { partyPhone: entry.partyPhone } : {}),
        ...(entry.paymentMode ? { paymentMode: entry.paymentMode === 'bank' ? 'bank' as const : 'cash' as const } : {}),
      });
      return;
    }
    const entryRef = doc(db, 'users', userId, subName, entryId);
    // Firestore's RN transaction implementation only supports document reads.
    // Resolve an already source-linked legacy movement before the transaction;
    // never manufacture a replacement movement when none is linked.
    const linkedSnap = await getDocs(query(
      collection(db, 'users', userId, 'stockMovements'),
      where('sourceEntryId', '==', entryId),
      limit(1),
    ));
    const sourceLinkedMovementId = linkedSnap.docs[0]?.id;
    await runTransaction(db, async (tx) => {
      const oldSnap = await tx.get(entryRef);
      if (oldSnap.data()?.returnCreditEntryId) throw new Error('Remove the reviewed return credit before editing this return.');
      if (!oldSnap.exists()) throw new Error('This entry no longer exists.');
      const old = oldSnap.data() as Partial<Entry>;
      const oldDelta = entryStockDelta(old);
      const newDelta = entryStockDelta(entry);
      const oldProductId = old.productId;
      const newProductId = entry.productId;

      // Read every affected product before writes. Combining deltas handles
      // both a quantity correction and moving the entry to another product.
      const productIds = [...new Set([oldProductId, newProductId].filter(Boolean) as string[])];
      const productSnaps = new Map<string, any>();
      for (const productId of productIds) {
        const snap = await tx.get(doc(db, 'users', userId, 'products', productId));
        if (!snap.exists()) throw new Error('An affected product no longer exists; restore it before editing this entry.');
        productSnaps.set(productId, snap);
      }
      const isOldPurchase = old.type === 'purchase' || old.type === 'credit_purchase';
      if (isOldPurchase && oldProductId) {
        const latestEventId = productSnaps.get(oldProductId).data().latestStockEventId;
        if (!latestEventId) {
          throw new Error('This legacy purchase cannot be changed safely because its stock order cannot be verified. Record a compensating stock adjustment instead.');
        }
        if (latestEventId !== entryId) {
          throw new Error('This purchase has later stock activity. Record a compensating purchase or stock adjustment instead of editing it.');
        }
      }
      const deltas = new Map<string, number>();
      const stockValueDeltas = new Map<string, number>();
      if (oldProductId && oldDelta) deltas.set(oldProductId, (deltas.get(oldProductId) ?? 0) - oldDelta);
      if (newProductId && newDelta) deltas.set(newProductId, (deltas.get(newProductId) ?? 0) + newDelta);
      const isNewPurchase = entry.type === 'purchase' || entry.type === 'credit_purchase';
      if (oldProductId && (isOldPurchase || old.type === 'return_inward' || old.type === 'return_outward')) stockValueDeltas.set(oldProductId, (stockValueDeltas.get(oldProductId) ?? 0) - entryStockValueImpact(old));
      if (newProductId && (isNewPurchase || entry.type === 'return_inward' || entry.type === 'return_outward')) stockValueDeltas.set(newProductId, (stockValueDeltas.get(newProductId) ?? 0) + entryStockValueImpact(entry));
      const movementId = (old.stockMovementId as string | undefined) ?? sourceLinkedMovementId;
      deltas.forEach((delta, productId) => {
        const product = productSnaps.get(productId).data();
        const current = Number(product.currentStock ?? product.stockQty ?? 0);
        const next = current + delta;
        if (next < 0) throw new Error(`Not enough stock. Only ${current} unit${current === 1 ? '' : 's'} left.`);
        const currentValue = Number(product.stockCost ?? current * Number(product.costPrice ?? 0));
        const hasValueCorrection = stockValueDeltas.has(productId);
        const calculatedValue = hasValueCorrection
          ? currentValue + (stockValueDeltas.get(productId) ?? 0)
          : next * Number(product.costPrice ?? 0);
        if (hasValueCorrection && calculatedValue < -0.01) {
          throw new Error('This purchase correction would make inventory value negative. Record a compensating entry instead.');
        }
        const nextValue = Math.abs(calculatedValue) < 0.01 ? 0 : calculatedValue;
        const nextCost = next > 0 ? nextValue / next : 0;
        const isNewEventForProduct = newProductId === productId && !!newDelta;
        const removesLatestEvent = oldProductId === productId && product.latestStockEventId === entryId;
        tx.update(productSnaps.get(productId).ref, {
          stockQty: next, currentStock: next, stockCost: nextValue,
          stockRevision: Number(product.stockRevision ?? 0) + 1,
          ...(isNewEventForProduct
            ? { latestStockEventId: entryId }
            : removesLatestEvent ? { latestStockEventId: `correction:${entryId}` } : {}),
          ...(hasValueCorrection ? { costPrice: nextCost } : {}),
        });
      });

      const { id: _id, createdAt: _createdAt, ...writeData } = entry as Entry;
      tx.update(entryRef, {
        ...writeData,
        userId,
        stockDelta: newDelta,
        ...(movementId ? { stockMovementId: movementId } : {}),
      });
      if (movementId) {
        const movementRef = doc(db, 'users', userId, 'stockMovements', movementId);
        if (newProductId && newDelta) {
          const product = productSnaps.get(newProductId).data();
          tx.set(movementRef, {
            productId: newProductId,
            productName: product.name ?? entry.itemName ?? 'Product',
            type: newDelta > 0 ? 'IN' : 'OUT',
            qty: Math.abs(newDelta),
            reason: entry.stockMovementReason ?? entry.type,
            date: entry.date,
            userId,
            sourceEntryId: entryId,
            ...(old.stockMovementId ? {} : { createdAt: serverTimestamp() }),
          }, { merge: !!old.stockMovementId });
        } else if (old.stockMovementId) {
          tx.delete(movementRef);
        }
      }
    });
  };

  const deleteEntry = async (entryId: string, type: EntryType) => {
    if (entries.find(e => e.id === entryId)?.returnCreditEntryId)
      throw new Error('Remove the reviewed credit link in Finance → Return credits before deleting this return.');
    if (['opening_balance', 'owner_contribution', 'owner_drawings', 'financial_record'].includes(type)) throw new Error('Void this record in Equity or Financial Controls to preserve its audit history.');
    if (!userId) throw new Error('You must be signed in.');
    if (type === 'credit_sale' || type === 'credit_purchase' || type === 'expense') {
      await deleteLinkedCredit((type === 'credit_sale' ? 'sale' : type === 'expense' ? 'expense' : 'purchase'), entryId);
      return;
    }
    if (type === 'credit_sale_payment' || type === 'credit_purchase_payment') {
      await deleteLinkedCreditPayment((entries.find(e => e.id === entryId)?.linkedCreditKind ?? (type === 'credit_sale_payment' ? 'sale' : 'purchase')), entryId);
      return;
    }
    const entryRef = doc(db, 'users', userId, subcollectionForType(type), entryId);
    const linkedSnap = await getDocs(query(
      collection(db, 'users', userId, 'stockMovements'),
      where('sourceEntryId', '==', entryId),
      limit(1),
    ));
    const sourceLinkedMovementId = linkedSnap.docs[0]?.id;
    await runTransaction(db, async (tx) => {
      const entrySnap = await tx.get(entryRef);
      if (!entrySnap.exists()) throw new Error('This entry no longer exists.');
      if (entrySnap.data().returnCreditEntryId) throw new Error('Remove the reviewed return credit before deleting this return.');
      const entry = entrySnap.data() as Partial<Entry>;
      const delta = entryStockDelta(entry);
      const movementId = (entry.stockMovementId as string | undefined) ?? sourceLinkedMovementId;
      if (entry.productId && delta) {
        const productRef = doc(db, 'users', userId, 'products', entry.productId);
        const productSnap = await tx.get(productRef);
        if (!productSnap.exists()) throw new Error('This product no longer exists; restore it before deleting this entry.');
        const isPurchase = entry.type === 'purchase' || entry.type === 'credit_purchase';
        const latestEventId = productSnap.data().latestStockEventId;
        if (isPurchase && !latestEventId) {
          throw new Error('This legacy purchase cannot be deleted safely because its stock order cannot be verified. Record a compensating stock adjustment instead.');
        }
        if (isPurchase && latestEventId !== entryId) {
          throw new Error('This purchase has later stock activity. Record a compensating purchase or stock adjustment instead of deleting it.');
        }
        const current = Number(productSnap.data().currentStock ?? productSnap.data().stockQty ?? 0);
        const next = current - delta;
        if (next < 0) throw new Error(`Cannot delete: reversing this entry would leave stock below zero (currently ${current}).`);
        const currentValue = Number(productSnap.data().stockCost ?? current * Number(productSnap.data().costPrice ?? 0));
        const calculatedValue = isPurchase || entry.type === 'return_inward' || entry.type === 'return_outward'
          ? currentValue - entryStockValueImpact(entry)
          : next * Number(productSnap.data().costPrice ?? 0);
        if ((isPurchase || entry.type === 'return_inward' || entry.type === 'return_outward') && calculatedValue < -0.01) {
          throw new Error('Deleting this purchase would make inventory value negative. Record a compensating entry instead.');
        }
        const nextValue = Math.abs(calculatedValue) < 0.01 ? 0 : calculatedValue;
        tx.update(productRef, {
          stockQty: next, currentStock: next, stockCost: nextValue,
          stockRevision: Number(productSnap.data().stockRevision ?? 0) + 1,
          ...(latestEventId === entryId ? { latestStockEventId: `deleted:${entryId}` } : {}),
           ...((isPurchase || entry.type === 'return_inward' || entry.type === 'return_outward') ? { costPrice: next > 0 ? nextValue / next : 0 } : {}),
        });
      }
      tx.delete(entryRef);
      if (movementId) tx.delete(doc(db, 'users', userId, 'stockMovements', movementId));
    });
  };

  const addProduct = async (product: Omit<Product, 'id' | 'createdAt'>) => {
    if (!userId) throw new Error('You must be signed in to save products.');
    await getAuthInstance();
    const data: Record<string, any> = { ...product, vatExclusive: true, userId, userEmail: user?.email ?? null };

    // Same duplicate-safe pattern as addEntry (see comments there).
    const firestorePromise = addDoc(
      collection(db, 'users', userId, 'products'),
      { ...data, createdAt: serverTimestamp() },
    );

    const UX_TIMEOUT_MS = 5000;
    const winner = await Promise.race([
      firestorePromise.then(() => 'online' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), UX_TIMEOUT_MS)),
    ]);

    if (winner === 'online') {
      const remaining = await getQueueCount();
      setPendingCount(remaining);
      if (remaining === 0) setSyncStatus('synced');
      console.log('[addProduct] DONE ✓ (confirmed by Firestore)');
      return;
    }

    const localId = await enqueueOffline([userId, 'products'], { ...data, createdAt: Date.now() });
    setPendingCount((c) => c + 1);
    setSyncStatus('pending');
    console.log('[addProduct] queued offline. Background SDK write still running…');

    firestorePromise
      .then(async () => {
        console.log('[addProduct] background write succeeded — dequeuing to prevent duplicate');
        await dequeueOffline(localId).catch(() => {});
        const remaining = await getQueueCount().catch(() => 0);
        setPendingCount(remaining);
        if (remaining === 0) setSyncStatus('synced');
      })
      .catch(() => {});

    throw new OfflineSaveError();
  };

  // Product cost and total stock value must never diverge.
  const updateProduct = async (
    productId: string,
    data: Partial<Omit<Product, 'id' | 'createdAt'>>,
  ) => {
    if (typeof data.suggestedPrice === 'number') data = { ...data, vatExclusive: true };
    if (!userId) throw new Error('You must be signed in.');
    const ref = doc(db, 'users', userId, 'products', productId);
    const revaluationEventId = `revaluation:${doc(collection(db, 'users', userId, 'stockMovements')).id}`;
    await Promise.race([
      runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw new Error('This product no longer exists.');
        const currentStock = Number(snap.data().currentStock ?? snap.data().stockQty ?? 0);
        const revaluesStock = currentStock > 0
          && typeof data.costPrice === 'number'
          && data.costPrice !== Number(snap.data().costPrice ?? 0);
        tx.update(ref, {
          ...data,
          ...(typeof data.costPrice === 'number'
            ? { stockCost: currentStock * data.costPrice }
            : {}),
          ...(revaluesStock ? {
            latestStockEventId: revaluationEventId,
            stockRevision: Number(snap.data().stockRevision ?? 0) + 1,
          } : {}),
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000)),
    ]);
  };

  // Archive rather than destroying a product referenced by accounting history.
  const deleteProduct = async (productId: string) => {
    if (!userId) throw new Error('You must be signed in.');
    const ref = doc(db, 'users', userId, 'products', productId);
    const movementRef = doc(collection(db, 'users', userId, 'stockMovements'));
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('This product no longer exists.');
      const product = snap.data();
      const currentStock = Math.max(0, Number(product.currentStock ?? product.stockQty ?? 0));
      const currentValue = Math.max(0, Number(product.stockCost ?? currentStock * Number(product.costPrice ?? 0)));
      if (currentStock > 0) {
        tx.set(movementRef, {
          productId,
          productName: product.name ?? 'Product',
          type: 'OUT',
          qty: currentStock,
          reason: 'Product archived — remaining stock removed',
          date: new Date().toISOString().split('T')[0],
          unitCost: currentStock > 0 ? currentValue / currentStock : 0,
          valueChange: -currentValue,
          userId,
          createdAt: serverTimestamp(),
        });
      }
      tx.update(ref, {
        archived: true,
        archivedAt: serverTimestamp(),
        stockQty: 0,
        currentStock: 0,
        stockCost: 0,
        ...(currentStock > 0 ? { latestStockEventId: movementRef.id } : {}),
        stockRevision: Number(product.stockRevision ?? 0) + 1,
      });
    });
  };

  // Simple qty adjustment (no movement record) — kept for backward compat
  const updateProductStock = async (productId: string, delta: number) => {
    if (!userId) throw new Error('You must be signed in.');
    const ref = doc(db, 'users', userId, 'products', productId);
    const eventId = `adjustment:${doc(collection(db, 'users', userId, 'stockMovements')).id}`;
    await Promise.race([
      runTransaction(db, async (tx) => {
        const productSnap = await tx.get(ref);
        if (!productSnap.exists()) throw new Error('This product no longer exists.');
        const product = productSnap.data();
        const currentStock = Number(product.currentStock ?? product.stockQty ?? 0);
        const nextStock = currentStock + delta;
        if (nextStock < 0) throw new Error(`Not enough stock. Only ${currentStock} left.`);
        const unitCost = Number(product.costPrice ?? 0);
        tx.update(ref, {
          stockQty: nextStock,
          currentStock: nextStock,
          stockCost: nextStock * unitCost,
          latestStockEventId: eventId,
          stockRevision: Number(product.stockRevision ?? 0) + 1,
        });
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000)),
    ]);
  };

  // Atomic: write a stock movement and update the product, never below zero.
  const addStockMovement = async (
    productId: string,
    productName: string,
    qty: number,
    type: 'IN' | 'OUT',
    reason: string = '',
  ) => {
    if (!userId) throw new Error('You must be signed in.');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Enter a stock quantity greater than zero.');
    const delta = type === 'IN' ? qty : -qty;
    const movRef = doc(collection(db, 'users', userId, 'stockMovements'));
    const prodRef = doc(db, 'users', userId, 'products', productId);
    await runTransaction(db, async (tx) => {
      const productSnap = await tx.get(prodRef);
      if (!productSnap.exists()) throw new Error('This product no longer exists.');
      const product = productSnap.data();
      const currentStock = Number(product.currentStock ?? product.stockQty ?? 0);
      const nextStock = currentStock + delta;
      if (nextStock < 0) throw new Error(`Not enough stock. Only ${currentStock} left.`);

      tx.set(movRef, {
        productId,
        productName,
        type,
        qty,
        reason,
        date: new Date().toISOString().split('T')[0],
        userId,
        createdAt: serverTimestamp(),
      });
      const unitCost = Number(product.costPrice ?? 0);
      tx.update(prodRef, {
        stockQty: nextStock, currentStock: nextStock,
        stockCost: Math.max(0, Number(product.stockCost ?? currentStock * unitCost) + delta * unitCost),
        latestStockEventId: movRef.id,
        stockRevision: Number(product.stockRevision ?? 0) + 1,
      });
    });
    console.log('[addStockMovement] DONE ✓', type, qty, 'units of', productName);
  };

  // ── Derived totals ────────────────────────────────────────────────────────

  // A credit sale is recognized as a Sale when the goods leave the store.
  const totalSales = calcTotalSales(entries);

  const totalReturnInwards = entries
    .filter((e) => e.type === 'return_inward')
    .reduce((sum, e) => sum + getSaleValue(e), 0);

  const totalRevenue = calcNetRevenue(entries);

  const openingStock = buildPnLReport(entries,entries,products).openingStock;

  // Available stock at the per-unit landed purchase price.
  const closingStock = calcInventoryValueAsOf(products, entries, '9999-12-31');

  // Cost = cash purchases + credit-purchase payments + carriage inward +
  // handling costs − returns outward.
  const inventoryPurchases = calcInventoryPurchasesForEntries(entries, products);

  // Total Cost Price = closing stock value (point-in-time snapshot of stock on hand)
  const totalCostPrice = closingStock;

  // VAT Paid = sum of expense entries automatically created when a sale is saved
  const totalVATPaid = entries
    .filter((e) => e.type === 'expense' && e.category === 'VAT Paid')
    .reduce((sum, e) => sum + e.amount, 0);

  // Centralized P&L
  const pnlReport = buildPnLReport(entries, entries, products);
  const costBalance = calcCostBalance(entries, products);
  const totalCOGS = pnlReport.cost; // Use exact cost match

  const totalCost = costBalance;
  const totalPurchaseCost = costBalance; // alias kept for backward compat
  const totalExpenses = pnlReport.operatingExpenses;

  const pnlRevenue = pnlReport.revenue;
  const pnlCost = pnlReport.cost;
  const grossProfit = pnlReport.grossProfit;
  const profitBeforeTax = pnlReport.profitBeforeTax;
  const incomeTax = pnlReport.tax;
  const netProfit = pnlReport.profitAfterTax;

  return (
    <EntriesContext.Provider
      value={{
        entries, loading: loading || !accountingReady, error: accountingError ?? error, retry, addEntry, addPurchaseWithProduct, updateEntry, correctSupplierReturnLandedCost, deleteEntry,
         totalSales, totalRevenue, totalReturnInwards, totalExpenses, totalVATPaid, totalCost: costBalance, pnlRevenue, pnlCost,
        totalCostPrice, totalCOGS, totalPurchaseCost,
        openingStock, closingStock, netProfit, grossProfit, profitBeforeTax, incomeTax,
        products, productsLoading, addProduct, updateProduct, deleteProduct, updateProductStock,
        stockMovements, stockMovementsLoading, addStockMovement,
        syncStatus, pendingCount,
      }}
    >
      {children}
    </EntriesContext.Provider>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanizeError(err: { code?: string; message: string }): string {
  if (err.code === 'permission-denied')
    return 'Firestore rules are blocking access.\n\nFix: Go to Firebase Console → Firestore Database → Rules → paste the authenticated rules → Publish.';
  if (err.code === 'failed-precondition' || err.message?.includes('index'))
    return 'A Firestore index is required. Check the Metro/Expo logs for a link to create it, then tap Retry.';
  if (err.code === 'unavailable' || err.message?.includes('UNAVAILABLE'))
    return 'Firestore is unreachable. Check your internet, then tap Retry.';
  if (err.code === 'not-found')
    return 'Firestore database not found. Go to Firebase Console → Firestore Database → Create database.';
  if (err.message?.includes('timed out') || err.message?.includes('TIMEOUT'))
    return 'Connection timed out. Check your internet and Firestore rules, then tap Retry.';
  return err.message ?? 'An unexpected error occurred.';
}

export function useEntries(): EntriesContextValue {
  const ctx = useContext(EntriesContext);
  if (!ctx) throw new Error('useEntries must be used inside EntriesProvider');
  return ctx;
}
