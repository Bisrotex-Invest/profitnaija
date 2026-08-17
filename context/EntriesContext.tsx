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
  updateDoc,
  increment,
  writeBatch,
  onSnapshot,
  orderBy,
  limit,
  query,
  serverTimestamp,
} from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { db, getAuthInstance } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';

// ── Offline queue ─────────────────────────────────────────────────────────────
export const OFFLINE_QUEUE_KEY = 'pn_offline_queue';

interface QueuedWrite {
  id: string;
  col: string;
  segments: string[];
  data: Record<string, any>;
  savedAt: number;
}

/** Write to AsyncStorage queue. Returns the item id so the caller can dequeue on success. */
async function enqueueOffline(segments: string[], data: Record<string, any>): Promise<string> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  const queue: QueuedWrite[] = raw ? JSON.parse(raw) : [];
  const id = `${Date.now()}-${Math.random()}`;
  queue.push({ id, col: 'users', segments, data, savedAt: Date.now() });
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

async function drainOfflineQueue(): Promise<number> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!raw) return 0;
  const queue: QueuedWrite[] = JSON.parse(raw);
  if (!queue.length) return 0;
  console.log('[offlineQueue] draining', queue.length, 'queued writes…');
  const remaining: QueuedWrite[] = [];
  for (const item of queue) {
    try {
      // 10-second per-item timeout prevents the drain from hanging forever
      // when Firestore is unreachable (no timeout = addDoc never resolves).
      await Promise.race([
        addDoc(collection(db, item.col, ...item.segments), {
          ...item.data,
          createdAt: serverTimestamp(),
          _syncedAt: Date.now(),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DRAIN_TIMEOUT')), 10_000),
        ),
      ]);
      console.log('[offlineQueue] synced:', item.segments.join('/'));
    } catch (e: any) {
      console.warn('[offlineQueue] sync failed, keeping:', item.segments.join('/'), e?.code ?? e?.message);
      remaining.push(item);
    }
  }
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  console.log('[offlineQueue] drain done. Still pending:', remaining.length);
  return remaining.length;
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
  | 'expense'
  | 'purchase'
  | 'opening_stock'
  | 'closing_stock';

export interface Entry {
  id: string;
  type: EntryType;
  amount: number;
  category: string;
  notes: string;
  date: string;
  createdAt: number;
  itemName?: string;
  baseCost?: number;
  materialCosts?: number[];
  carriageInward?: number;
  totalLandedCost?: number;
  industry?: string;
  markup?: number;
  suggestedPrice?: number;
  cogsAmount?: number;   // cost of goods for this sale = qty × costPrice
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
  stockQty: number;   // units on hand; 0 = out of stock
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
  totalRevenue: number;
  totalExpenses: number;
  totalCostPrice: number;   // now = sum(stockQty * costPrice) across all products
  totalPurchaseCost: number;
  openingStock: number;
  closingStock: number;
  netProfit: number;
  totalCOGS: number;    // sum of cogsAmount across all sale entries
  products: Product[];
  productsLoading: boolean;
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<void>;
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
    case 'sale':          return 'sales';
    case 'purchase':      return 'purchases';
    case 'expense':       return 'expenses';
    case 'opening_stock':
    case 'closing_stock': return 'stock';
  }
}

const EntriesContext = createContext<EntriesContextValue | undefined>(undefined);

// ── Provider ──────────────────────────────────────────────────────────────────

export function EntriesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.uid ?? null;

  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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

  const rebuildEntries = useCallback(() => {
    const all = [
      ...salesRef.current,
      ...purchasesRef.current,
      ...expensesRef.current,
      ...stockRef.current,
    ].sort((a, b) => b.createdAt - a.createdAt);
    setEntries(all);
  }, []);

  const retry = useCallback(() => {
    setError(null);
    setLoading(true);
    setEntries([]);
    setProducts([]);
    setProductsLoading(true);
    setStockMovements([]);
    setStockMovementsLoading(true);
    salesRef.current = [];
    purchasesRef.current = [];
    expensesRef.current = [];
    stockRef.current = [];
    setRetryKey((k) => k + 1);
  }, []);

  useEffect(() => {
    setEntries([]);
    setProducts([]);
    setError(null);
    setStockMovements([]);
    salesRef.current = [];
    purchasesRef.current = [];
    expensesRef.current = [];
    stockRef.current = [];

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

      // Track when all 4 entry subcollections have fired at least once
      let resolvedCount = 0;
      const onEntryReady = () => {
        resolvedCount++;
        if (resolvedCount >= 4) {
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
          baseCost: d.baseCost,
          materialCosts: d.materialCosts,
          carriageInward: d.carriageInward,
          totalLandedCost: d.totalLandedCost,
          industry: d.industry,
          markup: d.markup,
          suggestedPrice: d.suggestedPrice,
          cogsAmount: d.cogsAmount,
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
              cacheRef.current = snap.docs.map((d) => mapEntry(d, defaultType));
              rebuildEntries();
              onEntryReady();
              setError(null);
            },
            (err) => {
              if (unsubscribed) return;
              console.error(`[Firestore] ${subName}:`, err.code, err.message);
              onEntryReady();
              setError(humanizeError(err));
            },
          );
          unsubs.push(unsub);
        } catch (e: any) {
          console.error(`[Firestore] subscribe(${subName}) threw:`, e);
          onEntryReady();
        }
      };

      subscribeEntries('sales',     'sale',          salesRef);
      subscribeEntries('purchases', 'purchase',      purchasesRef);
      subscribeEntries('expenses',  'expense',       expensesRef);
      subscribeEntries('stock',     'opening_stock', stockRef);

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
                  suggestedPrice: d.suggestedPrice ?? 0,
                  date: d.date ?? '',
                  createdAt: d.createdAt?.toMillis() ?? Date.now(),
                  // support both old 'stockQty' and new 'currentStock' field names
                  stockQty: d.currentStock ?? d.stockQty ?? 0,
                };
              }),
            );
            setProductsLoading(false);
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

  // ── Mutations ─────────────────────────────────────────────────────────────

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
      const remaining = await drainOfflineQueue().catch(() => count);
      setPendingCount(remaining);
      setSyncStatus(remaining === 0 ? 'synced' : 'pending');
    };

    runDrain();

    // Retry every 10 s while items are still in the queue.
    const interval = setInterval(async () => {
      const count = await getQueueCount().catch(() => 0);
      if (count === 0) return; // nothing to do
      setSyncStatus('syncing');
      const remaining = await drainOfflineQueue().catch(() => count);
      setPendingCount(remaining);
      setSyncStatus(remaining === 0 ? 'synced' : 'pending');
      if (remaining === 0) clearInterval(interval);
    }, 10_000);

    return () => clearInterval(interval);
  }, [userId]);

  const addEntry = async (entry: Omit<Entry, 'id' | 'createdAt'>) => {
    if (!userId) throw new Error('You must be signed in to save entries.');
    await getAuthInstance();
    const subName = subcollectionForType(entry.type);
    const data: Record<string, any> = { ...entry, userId, userEmail: user?.email ?? null };

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
    const firestorePromise = addDoc(
      collection(db, 'users', userId, subName),
      { ...data, createdAt: serverTimestamp() },
    );

    const UX_TIMEOUT_MS = 5000;
    const winner = await Promise.race([
      firestorePromise.then(() => 'online' as const),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), UX_TIMEOUT_MS)),
    ]);

    if (winner === 'online') {
      // Fast path — write confirmed by Firestore, no queue needed.
      const remaining = await getQueueCount();
      setPendingCount(remaining);
      if (remaining === 0) setSyncStatus('synced');
      console.log('[addEntry] DONE ✓ (confirmed by Firestore)');
      return;
    }

    // Slow / offline path — queue for cross-restart durability.
    const localId = await enqueueOffline([userId, subName], { ...data, createdAt: Date.now() });
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

  const addProduct = async (product: Omit<Product, 'id' | 'createdAt'>) => {
    if (!userId) throw new Error('You must be signed in to save products.');
    await getAuthInstance();
    const data: Record<string, any> = { ...product, userId, userEmail: user?.email ?? null };

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

  // Simple qty adjustment (no movement record) — kept for backward compat
  const updateProductStock = async (productId: string, delta: number) => {
    if (!userId) throw new Error('You must be signed in.');
    const ref = doc(db, 'users', userId, 'products', productId);
    await Promise.race([
      updateDoc(ref, { stockQty: increment(delta) }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000)),
    ]);
  };

  // Atomic: write a stockMovement doc + update product currentStock in one batch
  const addStockMovement = async (
    productId: string,
    productName: string,
    qty: number,
    type: 'IN' | 'OUT',
    reason: string = '',
  ) => {
    if (!userId) throw new Error('You must be signed in.');
    const delta = type === 'IN' ? qty : -qty;
    const batch = writeBatch(db);

    // Movement document
    const movRef = doc(collection(db, 'users', userId, 'stockMovements'));
    batch.set(movRef, {
      productId,
      productName,
      type,
      qty,
      reason,
      date: new Date().toISOString().split('T')[0],
      userId,
      createdAt: serverTimestamp(),
    });

    // Update product stock atomically
    const prodRef = doc(db, 'users', userId, 'products', productId);
    batch.update(prodRef, {
      stockQty: increment(delta),
      currentStock: increment(delta), // keep both field names in sync
    });

    await Promise.race([
      batch.commit(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000)),
    ]);
    console.log('[addStockMovement] DONE ✓', type, qty, 'units of', productName);
  };

  // ── Derived totals ────────────────────────────────────────────────────────

  const totalRevenue = entries
    .filter((e) => e.type === 'sale')
    .reduce((sum, e) => sum + e.amount, 0);

  const totalExpenses = entries
    .filter((e) => e.type === 'expense')
    .reduce((sum, e) => sum + e.amount, 0);

  const openingStock = entries
    .filter((e) => e.type === 'opening_stock')
    .reduce((sum, e) => sum + e.amount, 0);

  const closingStock = entries
    .filter((e) => e.type === 'closing_stock')
    .reduce((sum, e) => sum + e.amount, 0);

  const totalPurchaseCost = entries
    .filter((e) => e.type === 'purchase')
    .reduce((sum, e) => sum + (e.totalLandedCost ?? e.amount), 0);

  // Total Cost Price = current stock value (qty × costPrice per product)
  // Falls back to the entry-based calculation when no products are tracked yet
  const stockBasedCost = products.reduce((sum, p) => sum + p.stockQty * p.costPrice, 0);
  const entryBasedCost = Math.max(0, openingStock + totalPurchaseCost - closingStock);
  const totalCostPrice = products.length > 0 ? stockBasedCost : entryBasedCost;

  // COGS = sum of cogsAmount on sale entries (set when selling from Stock tab)
  const totalCOGS = entries
    .filter((e) => e.type === 'sale')
    .reduce((sum, e) => sum + (e.cogsAmount ?? 0), 0);

  const netProfit = totalRevenue - totalCOGS - totalExpenses;

  return (
    <EntriesContext.Provider
      value={{
        entries, loading, error, retry, addEntry,
        totalRevenue, totalExpenses, totalCostPrice, totalCOGS,
        totalPurchaseCost, openingStock, closingStock, netProfit,
        products, productsLoading, addProduct, updateProductStock,
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
