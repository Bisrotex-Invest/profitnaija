import { accumulatedDepreciation, leaseRightOfUseAsset, type AssetRecord, type FinanceRecord } from './finance.ts';
import { leaseLiabilitySplit, leasePaymentSplit, type WorkingCapitalRecord, type WorkingEntry } from './workingCapital.ts';
import type { OpeningBalances } from './index.ts';

export type LedgerClass = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export interface LedgerAccount {
  id: string;
  code: string;
  name: string;
  classification: LedgerClass;
}

export interface GeneralLedgerSourceEntry {
  id: string;
  type: string;
  date: string;
  amount: number;
  createdAt?: number;
  unitsPurchased?: number;
  stockDelta?: number;
  category?: string;
  notes?: string;
  reference?: string;
  itemName?: string;
  productId?: string;
  partyName?: string;
  paymentMode?: string;
  bankAccountName?: string;
  unitSalesPrice?: number;
  unitsSold?: number;
  vatExclusive?: boolean;
  vatPaid?: number;
  returnVat?: number;
  vatApplicable?: boolean;
  baseCost?: number;
  materialCosts?: number[];
  unitPurchasePrice?: number;
  purchaseAmount?: number;
  carriageInward?: number;
  handlingCost?: number;
  totalLandedCost?: number;
  linkedCreditEntryId?: string;
  linkedCreditKind?: string;
  returnCreditEntryId?: string;
  returnCreditKind?: string;
  returnLandedCost?: number;
  cogsAmount?: number;
  baseCostSnapshot?: number;
  purchaseVAT?: number;
  withholdingTax?: number;
  supplierPayable?: number;
  openingBalances?: OpeningBalances;
  confirmed?: boolean;
  ledgerStatus?: string;
  finance?: FinanceRecord;
}

export interface GeneralLedgerRules {
  saleNet: (entry: GeneralLedgerSourceEntry) => number;
  saleGross: (entry: GeneralLedgerSourceEntry) => number;
  saleVAT: (entry: GeneralLedgerSourceEntry) => number;
  purchaseInventory: (entry: GeneralLedgerSourceEntry) => number;
  purchasePayable: (entry: GeneralLedgerSourceEntry) => number;
  /** Return null when the historical carrying value cannot be established. */
  inventoryMovement: (entry: GeneralLedgerSourceEntry, allEntries: GeneralLedgerSourceEntry[]) => number | null;
}

export interface GeneralLedgerRow {
  id: string;
  journalId: string;
  date: string;
  sourceId?: string;
  sourceType: string;
  description: string;
  reference: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  classification: LedgerClass;
  debit: number;
  credit: number;
  /** Debit-positive running balance for this account. */
  balance: number;
  openingBalance?: boolean;
  needsReview?: boolean;
}

export interface GeneralLedgerBalance {
  accountId: string;
  accountCode: string;
  accountName: string;
  classification: LedgerClass;
  openingBalance: number;
  periodDebit: number;
  periodCredit: number;
  closingBalance: number;
}

export interface GeneralLedgerReviewItem {
  sourceId: string;
  date: string;
  description: string;
  reason: string;
}

export interface GeneralLedgerReference {
  sourceId: string;
  date: string;
  description: string;
  reason: string;
}

export interface GeneralLedgerReport {
  startDate: string;
  endDate: string;
  openingDate?: string;
  accounts: LedgerAccount[];
  rows: GeneralLedgerRow[];
  /** Older transactions superseded by a confirmed opening snapshot. */
  historicalRows: GeneralLedgerRow[];
  balances: GeneralLedgerBalance[];
  reviewItems: GeneralLedgerReviewItem[];
  referenceOnly: GeneralLedgerReference[];
  periodDebit: number;
  periodCredit: number;
  trialBalanceDebit: number;
  trialBalanceCredit: number;
  isBalanced: boolean;
  hasConfirmedOpening: boolean;
}

type Side = 'debit' | 'credit';
interface DraftPosting { accountId: string; side: Side; amount: number }
interface DraftJournal {
  id: string;
  date: string;
  sourceId?: string;
  sourceType: string;
  description: string;
  reference: string;
  postings: DraftPosting[];
  openingBalance?: boolean;
  isOpeningClassification?: boolean;
  needsReview?: boolean;
}

const STANDARD_ACCOUNTS: LedgerAccount[] = [
  { id: 'cash', code: '1000', name: 'Cash on hand', classification: 'asset' },
  { id: 'bank', code: '1010', name: 'Bank', classification: 'asset' },
  { id: 'debtors', code: '1100', name: 'Trade receivables (Debtors)', classification: 'asset' },
  { id: 'inventory', code: '1200', name: 'Inventory', classification: 'asset' },
  { id: 'prepayments', code: '1300', name: 'Prepayments', classification: 'asset' },
  { id: 'supplier-credit-receivable', code: '1310', name: 'Supplier credits receivable', classification: 'asset' },
  { id: 'input-vat', code: '1400', name: 'VAT control', classification: 'liability' },
  { id: 'other-current-assets', code: '1490', name: 'Other current assets', classification: 'asset' },
  { id: 'ppe-opening-net', code: '1500', name: 'Fixed assets at opening carrying value', classification: 'asset' },
  { id: 'ppe-cost', code: '1510', name: 'Property, plant and equipment', classification: 'asset' },
  { id: 'accumulated-depreciation', code: '1590', name: 'Accumulated depreciation', classification: 'asset' },
  { id: 'other-non-current-assets', code: '1600', name: 'Other non-current assets', classification: 'asset' },
  { id: 'right-of-use-assets', code: '1610', name: 'Right-of-use assets', classification: 'asset' },
  { id: 'creditors', code: '2000', name: 'Trade and expense creditors', classification: 'liability' },
  { id: 'wht-payable', code: '2110', name: 'Withholding tax payable', classification: 'liability' },
  { id: 'income-tax-payable', code: '2120', name: 'Income tax payable', classification: 'liability' },
  { id: 'other-current-liabilities', code: '2200', name: 'Other current liabilities', classification: 'liability' },
  { id: 'accrued-expenses', code: '2210', name: 'Accrued expenses', classification: 'liability' },
  { id: 'unearned-revenue', code: '2300', name: 'Unearned revenue', classification: 'liability' },
  { id: 'current-loans', code: '2400', name: 'Current loans', classification: 'liability' },
  { id: 'non-current-loans', code: '2500', name: 'Non-current loans', classification: 'liability' },
  { id: 'current-leases', code: '2410', name: 'Current lease liabilities', classification: 'liability' },
  { id: 'non-current-leases', code: '2510', name: 'Non-current lease liabilities', classification: 'liability' },
  { id: 'capital', code: '3000', name: 'Owner capital', classification: 'equity' },
  { id: 'retained-earnings', code: '3100', name: 'Retained earnings', classification: 'equity' },
  { id: 'drawings', code: '3200', name: 'Owner drawings', classification: 'equity' },
  { id: 'other-equity', code: '3300', name: 'Other equity', classification: 'equity' },
  { id: 'sales', code: '4000', name: 'Sales revenue', classification: 'income' },
  { id: 'unearned-revenue-release', code: '4010', name: 'Revenue from customer advances', classification: 'income' },
  { id: 'sales-returns', code: '4090', name: 'Sales returns and allowances', classification: 'income' },
  { id: 'cost-of-sales', code: '5000', name: 'Cost of sales', classification: 'expense' },
  { id: 'supplier-return-expense', code: '5010', name: 'Supplier return expenses', classification: 'expense' },
  { id: 'supplier-return-gain', code: '5020', name: 'Supplier return gain', classification: 'income' },
  { id: 'depreciation-expense', code: '6100', name: 'Depreciation expense', classification: 'expense' },
  { id: 'interest-expense', code: '6200', name: 'Interest expense', classification: 'expense' },
  { id: 'inventory-writeoff', code: '6300', name: 'Inventory write-off expense', classification: 'expense' },
  { id: 'tax-expense-vat', code: '6400', name: 'VAT charge expense', classification: 'expense' },
  { id: 'tax-expense-wht', code: '6410', name: 'Withholding tax charge expense', classification: 'expense' },
  { id: 'tax-expense-income', code: '6420', name: 'Income tax expense', classification: 'expense' },
  { id: 'asset-disposal-gain', code: '4500', name: 'Gain on asset disposal', classification: 'income' },
  { id: 'asset-disposal-loss', code: '6500', name: 'Loss on asset disposal', classification: 'expense' },
  { id: 'opening-suspense', code: '9990', name: 'Opening balance suspense — review required', classification: 'equity' },
  { id: 'transaction-suspense', code: '9991', name: 'Transaction suspense — review required', classification: 'equity' },
  { id: 'stock-suspense', code: '9992', name: 'Unclassified stock counterpart — review required', classification: 'equity' },
  { id: 'asset-suspense', code: '9993', name: 'Unclassified asset source — review required', classification: 'equity' },
  { id: 'settlement-suspense', code: '9994', name: 'Unclassified settlement — review required', classification: 'equity' },
];

const OPENING_ACCOUNTS: Array<[keyof OpeningBalances, string, Side]> = [
  ['cash', 'cash', 'debit'], ['bank', 'bank', 'debit'], ['inventory', 'inventory', 'debit'],
  ['debtors', 'debtors', 'debit'], ['otherCurrentAssets', 'other-current-assets', 'debit'],
  ['fixedAssets', 'ppe-opening-net', 'debit'], ['otherNonCurrentAssets', 'other-non-current-assets', 'debit'],
  ['creditors', 'creditors', 'credit'], ['vatLiability', 'input-vat', 'credit'],
  ['whtLiability', 'wht-payable', 'credit'], ['incomeTaxLiability', 'income-tax-payable', 'credit'],
  ['otherCurrentLiabilities', 'other-current-liabilities', 'credit'], ['loans', 'current-loans', 'credit'],
  ['capital', 'capital', 'credit'], ['retainedEarnings', 'retained-earnings', 'credit'],
  ['drawings', 'drawings', 'debit'], ['otherEquity', 'other-equity', 'credit'],
];

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const toCents = (value: number) => Math.round((value + Number.EPSILON) * 100);
const fromCents = (value: number) => value / 100;
const safe = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? roundMoney(value) : 0;
const validLedgerDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const STOCK_MOVEMENT_TYPES = new Set([
  'purchase', 'credit_purchase', 'sale', 'credit_sale', 'return_inward', 'return_outward',
]);

function movementQuantity(entry: GeneralLedgerSourceEntry): number {
  const value = entry.unitsPurchased ?? entry.unitsSold
    ?? (typeof entry.stockDelta === 'number' ? Math.abs(entry.stockDelta) : 0);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function recordedAncillaryCost(entry: GeneralLedgerSourceEntry): number {
  return roundMoney(
    (entry.materialCosts ?? []).reduce((sum, cost) => sum + safe(cost), 0)
    + safe(entry.carriageInward)
    + safe(entry.handlingCost),
  );
}

/**
 * Reconstruct a transaction's landed inventory cost only from its saved base
 * cost and the product's recorded purchase/stock history. This mirrors the
 * product ledger's weighted-average allocation of recorded ancillary costs.
 * It never falls back to today's mutable product cost.
 */
export function recordedLandedInventoryMovementCost(
  entry: GeneralLedgerSourceEntry,
  allEntries: GeneralLedgerSourceEntry[],
): number | null {
  if (entry.type === 'return_outward') {
    return typeof entry.returnLandedCost === 'number' && Number.isFinite(entry.returnLandedCost) && entry.returnLandedCost > 0
      ? roundMoney(entry.returnLandedCost)
      : null;
  }
  if (!['sale', 'credit_sale', 'return_inward'].includes(entry.type) || !entry.productId) return null;
  const quantity = movementQuantity(entry);
  if (!quantity) return null;

  let baseCost: number;
  if (entry.type === 'return_inward' && typeof entry.baseCostSnapshot === 'number'
    && Number.isFinite(entry.baseCostSnapshot) && entry.baseCostSnapshot > 0) {
    baseCost = roundMoney(entry.baseCostSnapshot * quantity);
  } else if (typeof entry.cogsAmount === 'number' && Number.isFinite(entry.cogsAmount) && entry.cogsAmount > 0) {
    baseCost = roundMoney(entry.cogsAmount);
  } else {
    return null;
  }

  const productHistory = allEntries.filter(candidate =>
    candidate.ledgerStatus !== 'void'
    && candidate.productId === entry.productId
    && (STOCK_MOVEMENT_TYPES.has(candidate.type) || candidate.type === 'opening_stock'
      || (typeof candidate.stockDelta === 'number' && candidate.stockDelta !== 0))
    && candidate.date <= entry.date,
  );
  if (!productHistory.some(candidate => candidate.id === entry.id)) return null;

  const byDate = new Map<string, GeneralLedgerSourceEntry[]>();
  for (const candidate of productHistory) byDate.set(candidate.date, [...(byDate.get(candidate.date) ?? []), candidate]);
  for (const sameDate of byDate.values()) {
    if (sameDate.length < 2) continue;
    const timestamps = sameDate.map(candidate => candidate.createdAt);
    if (timestamps.some(value => typeof value !== 'number' || !Number.isFinite(value))
      || new Set(timestamps).size !== timestamps.length) return null;
  }
  productHistory.sort((a, b) =>
    a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0),
  );
  const targetIndex = productHistory.findIndex(candidate => candidate.id === entry.id);
  if (targetIndex < 0) return null;

  let remainingUnits = 0;
  let ancillaryValue = 0;
  let lastKnownRate = 0;
  let hasStockHistory = false;
  for (const previous of productHistory.slice(0, targetIndex)) {
    if (!STOCK_MOVEMENT_TYPES.has(previous.type)) return null;
    const units = movementQuantity(previous);
    if (!units) return null;
    if (previous.type === 'purchase' || previous.type === 'credit_purchase') {
      remainingUnits += units;
      ancillaryValue += recordedAncillaryCost(previous);
      if (remainingUnits > 0) lastKnownRate = ancillaryValue / remainingUnits;
      hasStockHistory = true;
    } else if (previous.type === 'return_outward') {
      if (typeof previous.returnLandedCost !== 'number' || !Number.isFinite(previous.returnLandedCost) || previous.returnLandedCost <= 0) return null;
      if (units > remainingUnits + 1e-8) return null;
      const average = remainingUnits > 0 ? ancillaryValue / remainingUnits : lastKnownRate;
      remainingUnits = Math.max(0, remainingUnits - units);
      ancillaryValue = Math.max(0, ancillaryValue - average * units);
      lastKnownRate = remainingUnits > 0 ? ancillaryValue / remainingUnits : average;
    } else if (previous.type === 'sale' || previous.type === 'credit_sale') {
      if (units > remainingUnits + 1e-8) return null;
      const average = remainingUnits > 0 ? ancillaryValue / remainingUnits : lastKnownRate;
      remainingUnits = Math.max(0, remainingUnits - units);
      ancillaryValue = Math.max(0, ancillaryValue - average * units);
      lastKnownRate = remainingUnits > 0 ? ancillaryValue / remainingUnits : average;
    } else if (previous.type === 'return_inward') {
      if (!hasStockHistory) return null;
      const average = remainingUnits > 0 ? ancillaryValue / remainingUnits : lastKnownRate;
      remainingUnits += units;
      ancillaryValue += average * units;
      lastKnownRate = average;
    }
  }

  let ancillaryCost: number;
  if (entry.type === 'return_inward') {
    if (!hasStockHistory) return null;
    ancillaryCost = (remainingUnits > 0 ? ancillaryValue / remainingUnits : lastKnownRate) * quantity;
  } else {
    if (quantity > remainingUnits + 1e-8 || remainingUnits <= 0) return null;
    ancillaryCost = (ancillaryValue / remainingUnits) * quantity;
  }
  return roundMoney(baseCost + ancillaryCost);
}
const taxAccount = (type: string) => type === 'wht' ? 'wht-payable' : type === 'income_tax' ? 'income-tax-payable' : 'input-vat';
const taxExpenseAccount = (type: string) => type === 'wht' ? 'tax-expense-wht' : type === 'income_tax' ? 'tax-expense-income' : 'tax-expense-vat';
const moneyAccount = (mode?: string) => mode === 'bank' ? 'bank' : mode === 'cash' || !mode ? 'cash' : '';

function monthEnd(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
}
function nextMonthStart(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}
function previousDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Read-only reconstruction; it never writes or alters source accounting records. */
export function buildGeneralLedger(
  sourceEntries: GeneralLedgerSourceEntry[],
  startDate: string,
  endDate: string,
  rules: GeneralLedgerRules,
): GeneralLedgerReport {
  if (!validLedgerDate(startDate) || !validLedgerDate(endDate) || startDate > endDate) {
    throw new Error('Choose a valid General Ledger date range.');
  }

  const active = sourceEntries.filter(entry => entry.ledgerStatus !== 'void');
  const openings = active
    .filter(entry => entry.type === 'opening_balance' && entry.confirmed === true && entry.openingBalances && entry.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const anchor = openings[openings.length - 1];
  const anchorDate = anchor?.date;
  const accountMap = new Map(STANDARD_ACCOUNTS.map(account => [account.id, account]));
  const ensureExpenseAccount = (category: string) => {
    const label = category.trim() || 'Other expense';
    const id = `expense:${label.toLocaleLowerCase()}`;
    if (!accountMap.has(id)) accountMap.set(id, { id, code: '6000', name: label, classification: 'expense' });
    return id;
  };
  const reviewItems: GeneralLedgerReviewItem[] = [];
  const referenceOnly: GeneralLedgerReference[] = [];
  const journals: DraftJournal[] = [];
  const addReview = (sourceId: string, date: string, description: string, reason: string) => {
    reviewItems.push({ sourceId, date, description, reason });
  };
  const addReference = (sourceId: string, date: string, description: string, reason: string) => {
    referenceOnly.push({ sourceId, date, description, reason });
  };
  for (const entry of active) {
    if (entry.type === 'opening_balance' && entry.date <= endDate && (entry.confirmed !== true || !entry.openingBalances)) {
      const description = entry.reference?.trim() || 'Unconfirmed opening balances';
      addReview(entry.id, entry.date, description, 'This opening record is not confirmed with a complete balance snapshot, so it is not used as the ledger anchor.');
      addReference(entry.id, entry.date, description, 'Unconfirmed opening balance records are retained for review and are not posted.');
    }
  }
  const append = (items: DraftPosting[], accountId: string, side: Side, amount: number) => {
    const cents = toCents(safe(amount));
    if (!cents) return;
    const account = accountMap.get(accountId);
    if (!account) return;
    items.push({ accountId, side, amount: fromCents(cents) });
  };
  const makeJournal = (input: Omit<DraftJournal, 'postings'>, postings: DraftPosting[]) => {
    const debit = postings.filter(p => p.side === 'debit').reduce((sum, p) => sum + toCents(p.amount), 0);
    const credit = postings.filter(p => p.side === 'credit').reduce((sum, p) => sum + toCents(p.amount), 0);
    if (debit !== credit) {
      const diff = Math.abs(debit - credit) / 100;
      append(postings, input.openingBalance ? 'opening-suspense' : 'transaction-suspense', debit > credit ? 'credit' : 'debit', diff);
      input.needsReview = true;
      const reason = `The source posting differs by ₦${diff.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}; the difference is kept in suspense.`;
      if (input.sourceId) addReview(input.sourceId, input.date, input.description, reason);
    }
    journals.push({ ...input, postings });
  };
  const textOf = (entry: GeneralLedgerSourceEntry) => entry.reference?.trim() || entry.itemName?.trim() || entry.partyName?.trim() || entry.category?.trim() || entry.id;
  const modeAccount = (entry: GeneralLedgerSourceEntry, purpose: string, sourceId = entry.id) => {
    const account = moneyAccount(entry.paymentMode);
    if (account) return account;
    addReview(sourceId, entry.date, textOf(entry), `${purpose} has no supported cash or bank account; the settlement is not guessed.`);
    return 'settlement-suspense';
  };

  const assetRecords = active.filter(entry => entry.finance?.kind === 'asset');
  const assetBySource = new Map<string, GeneralLedgerSourceEntry>();
  for (const assetEntry of assetRecords) {
    const asset = assetEntry.finance as AssetRecord;
    if (!asset.sourceEntryId) continue;
    const source = active.find(candidate => candidate.id === asset.sourceEntryId);
    if (source?.type === 'expense' && source.category?.trim().toLocaleLowerCase() === 'equipment'
      && source.date === asset.date && Math.abs(source.amount - asset.cost) < 0.01) {
      assetBySource.set(asset.sourceEntryId, assetEntry);
    }
  }
  const linkedTaxPayments = active.filter(entry =>
    entry.finance?.kind === 'tax' && entry.finance.confirmed === true && entry.finance.action === 'payment' && !!entry.finance.sourceEntryId,
  );
  const taxPaymentSourceIds = new Set(linkedTaxPayments.flatMap(entry => {
    const tax = entry.finance as Extract<FinanceRecord, { kind: 'tax' }>;
    const source = active.find(candidate => candidate.id === tax.sourceEntryId);
    return source?.type === 'expense' && source.date === tax.date && Math.abs(source.amount - tax.amount) < 0.01
      ? [source.id]
      : [];
  }));
  if (assetRecords.length) {
    for (const manual of active.filter(entry =>
      entry.type === 'expense' && entry.category?.trim().toLocaleLowerCase() === 'depreciation'
      && entry.date <= endDate && (!anchorDate || entry.date > anchorDate),
    )) {
      const overlapsRegister = assetRecords.some(entry => {
        const asset = entry.finance as AssetRecord;
        return asset.date <= manual.date && asset.depreciationStart <= manual.date
          && (!asset.disposalDate || asset.disposalDate >= manual.date);
      });
      if (overlapsRegister) {
        addReview(manual.id, manual.date, textOf(manual), 'Manual depreciation overlaps a registered asset schedule; confirm the two expense sources do not cover the same depreciation.');
      }
    }
  }

  const makeSourceJournal = (
    entry: GeneralLedgerSourceEntry,
    description: string,
    postings: DraftPosting[],
    extras: Partial<Pick<DraftJournal, 'needsReview' | 'isOpeningClassification'>> = {},
  ) => makeJournal({
    id: `source:${entry.id}`,
    date: entry.date,
    sourceId: entry.id,
    sourceType: entry.type,
    description,
    reference: entry.reference?.trim() || entry.id,
    ...extras,
  }, postings);

  const recordedCost = (entry: GeneralLedgerSourceEntry): number | null => {
    const value = rules.inventoryMovement(entry, active);
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? roundMoney(value) : null;
  };
  const hasRecordedBaseCost = (entry: GeneralLedgerSourceEntry) =>
    (typeof entry.cogsAmount === 'number' && Number.isFinite(entry.cogsAmount) && entry.cogsAmount > 0)
    || (entry.type === 'return_inward' && typeof entry.baseCostSnapshot === 'number'
      && Number.isFinite(entry.baseCostSnapshot) && entry.baseCostSnapshot > 0);

  for (const entry of active) {
    if (entry.type === 'opening_balance') continue;
    const description = textOf(entry);
    const postings: DraftPosting[] = [];
    if (entry.type === 'sale' || entry.type === 'credit_sale') {
      const net = safe(rules.saleNet(entry));
      const vat = safe(rules.saleVAT(entry));
      const gross = safe(rules.saleGross(entry));
      const settlement = entry.type === 'credit_sale' ? 'debtors' : modeAccount(entry, 'Sale', entry.id);
      append(postings, settlement, 'debit', gross);
      append(postings, 'sales', 'credit', net);
      append(postings, 'input-vat', 'credit', vat);
      const cost = recordedCost(entry);
      let review = false;
      if (cost === null) {
        review = true;
        addReview(entry.id, entry.date, description, hasRecordedBaseCost(entry)
          ? 'Saved base cost exists, but complete product stock history does not verify its allocated landed cost; cost of sales and inventory movement remain unposted.'
          : 'Historical inventory carrying cost is not recorded; cost of sales and inventory movement are not inferred.');
      } else {
        append(postings, 'cost-of-sales', 'debit', cost);
        append(postings, 'inventory', 'credit', cost);
      }
      makeSourceJournal(entry, description, postings, { needsReview: review });
    } else if (entry.type === 'credit_sale_payment') {
      append(postings, modeAccount(entry, 'Debtors payment'), 'debit', entry.amount);
      append(postings, 'debtors', 'credit', entry.amount);
      makeSourceJournal(entry, description, postings);
    } else if (entry.type === 'purchase' || entry.type === 'credit_purchase') {
      const inventory = safe(rules.purchaseInventory(entry));
      const vat = safe(entry.purchaseVAT);
      const wht = safe(entry.withholdingTax);
      const payable = safe(rules.purchasePayable(entry));
      append(postings, 'inventory', 'debit', inventory);
      append(postings, 'input-vat', 'debit', vat);
      append(postings, entry.type === 'credit_purchase' ? 'creditors' : modeAccount(entry, 'Purchase'), 'credit', payable);
      append(postings, 'wht-payable', 'credit', wht);
      makeSourceJournal(entry, description, postings);
    } else if (entry.type === 'credit_purchase_payment') {
      append(postings, 'creditors', 'debit', entry.amount);
      append(postings, modeAccount(entry, 'Creditors payment'), 'credit', entry.amount);
      makeSourceJournal(entry, description, postings);
    } else if (entry.type === 'expense') {
      if (assetBySource.has(entry.id) || taxPaymentSourceIds.has(entry.id)) continue;
      if (entry.category === 'VAT Paid' && entry.notes?.startsWith('VAT on Sale ID:')) {
        addReference(entry.id, entry.date, description, 'VAT is already posted from the source sale; this generated record is not posted twice.');
        continue;
      }
      const category = entry.category?.trim().toLocaleLowerCase();
      if (category === 'equipment') {
        addReview(entry.id, entry.date, description, 'Equipment remains posted from its saved expense record because no matching registered asset purchase was found; confirm its expense or fixed-asset classification.');
      }
      const debitAccount = category === 'depreciation' ? 'depreciation-expense'
        : category === 'interest on loan' ? 'interest-expense'
          : ensureExpenseAccount(entry.category ?? 'Other expense');
      append(postings, debitAccount, 'debit', entry.amount);
      if (category === 'depreciation') append(postings, 'accumulated-depreciation', 'credit', entry.amount);
      else if (entry.paymentMode === 'credit') append(postings, 'creditors', 'credit', entry.amount);
      else if (entry.paymentMode === 'non_cash') {
        append(postings, 'settlement-suspense', 'credit', entry.amount);
        addReview(entry.id, entry.date, description, 'This non-cash expense has no linked payable, asset, or other supported counterpart.');
      } else append(postings, modeAccount(entry, 'Expense'), 'credit', entry.amount);
      makeSourceJournal(entry, description, postings);
    } else if (entry.type === 'return_inward') {
      const net = safe(rules.saleNet(entry));
      const vat = safe(rules.saleVAT(entry));
      const gross = safe(rules.saleGross(entry));
      append(postings, 'sales-returns', 'debit', net);
      append(postings, 'input-vat', 'debit', vat);
      append(postings, entry.returnCreditEntryId ? 'debtors' : modeAccount(entry, 'Customer return'), 'credit', gross);
      const cost = recordedCost(entry);
      let review = false;
      if (cost === null) {
        review = true;
        addReview(entry.id, entry.date, description, hasRecordedBaseCost(entry)
          ? 'Saved base cost exists, but complete product stock history does not verify its allocated landed cost; the inventory and cost-of-sales reversal remain unposted.'
          : 'Returned inventory carrying cost is not recorded; the inventory and cost-of-sales reversal is not inferred.');
      } else {
        append(postings, 'inventory', 'debit', cost);
        append(postings, 'cost-of-sales', 'credit', cost);
      }
      makeSourceJournal(entry, description, postings, { needsReview: review });
    } else if (entry.type === 'return_outward') {
      const carrying = recordedCost(entry);
      const creditAccount = entry.returnCreditEntryId ? 'creditors' : 'supplier-credit-receivable';
      append(postings, creditAccount, 'debit', entry.amount);
      let review = false;
      if (carrying === null) {
        append(postings, 'stock-suspense', 'credit', entry.amount);
        review = true;
        addReview(entry.id, entry.date, description, 'Supplier credit is known but returned inventory carrying cost is missing; the difference is held in stock suspense.');
      } else {
        append(postings, 'supplier-return-expense', 'debit', Math.max(0, carrying - entry.amount));
        append(postings, 'supplier-return-gain', 'credit', Math.max(0, entry.amount - carrying));
        append(postings, 'inventory', 'credit', carrying);
      }
      makeSourceJournal(entry, description, postings, { needsReview: review });
    } else if (entry.type === 'owner_contribution') {
      append(postings, modeAccount(entry, 'Owner contribution'), 'debit', entry.amount);
      append(postings, 'capital', 'credit', entry.amount);
      makeSourceJournal(entry, description, postings);
    } else if (entry.type === 'owner_drawings') {
      append(postings, 'drawings', 'debit', entry.amount);
      append(postings, modeAccount(entry, 'Owner drawings'), 'credit', entry.amount);
      makeSourceJournal(entry, description, postings);
    } else if (entry.type === 'opening_stock') {
      append(postings, 'inventory', 'debit', entry.amount);
      append(postings, 'stock-suspense', 'credit', entry.amount);
      addReview(entry.id, entry.date, description, 'The stock amount is recorded, but its source account is not; it is held in suspense rather than assigned to capital or income.');
      makeSourceJournal(entry, description, postings, { needsReview: true });
    } else if (entry.type === 'closing_stock') {
      if (entry.category?.toLocaleLowerCase().includes('damage')) {
        append(postings, 'inventory-writeoff', 'debit', entry.amount);
        append(postings, 'inventory', 'credit', entry.amount);
        makeSourceJournal(entry, description, postings);
      } else {
        addReference(entry.id, entry.date, description, 'Closing stock is a balance snapshot, not a transaction posting; the inventory balance is reported separately.');
      }
    } else if (entry.type === 'financial_record' && entry.finance) {
      const finance = entry.finance;
      if (finance.kind === 'statement') {
        addReference(entry.id, finance.endDate, finance.reference, 'Bank statements are reconciliation evidence and do not create journal postings.');
      } else if (finance.kind === 'bank_transfer') {
        const fromLabel = finance.fromAccount === 'bank' ? finance.fromBankAccountName : 'Cash';
        const toLabel = finance.toAccount === 'bank' ? finance.toBankAccountName : 'Cash';
        const detail = `Transfer from ${fromLabel || 'unassigned bank account'} to ${toLabel || 'unassigned bank account'}`;
        append(postings, finance.toAccount, 'debit', finance.amount);
        append(postings, finance.fromAccount, 'credit', finance.amount);
        makeJournal({
          id: `finance:${entry.id}`,
          date: finance.date,
          sourceId: entry.id,
          sourceType: 'financial_record',
          description: detail,
          reference: finance.reference || entry.id,
        }, postings);
      } else if (finance.kind === 'tax') {
        if (finance.confirmed !== true) {
          addReference(entry.id, finance.date, finance.reference, 'Unconfirmed tax records are not posted.');
          addReview(entry.id, finance.date, finance.reference, 'This tax record is not confirmed against supporting records, so it is excluded from the reconstructed ledger.');
          continue;
        }
        const account = taxAccount(finance.taxType);
        const taxExpense = taxExpenseAccount(finance.taxType);
        const linkedSource = finance.sourceEntryId && taxPaymentSourceIds.has(finance.sourceEntryId)
          ? active.find(candidate => candidate.id === finance.sourceEntryId)
          : undefined;
        const date = finance.date;
        if (finance.action === 'charge') {
          append(postings, taxExpense, 'debit', finance.amount);
          append(postings, account, 'credit', finance.amount);
        } else if (finance.action === 'credit') {
          append(postings, account, 'debit', finance.amount);
          append(postings, taxExpense, 'credit', finance.amount);
        } else {
          if (finance.sourceEntryId && !linkedSource) {
            addReview(entry.id, date, finance.reference, 'The linked expense does not match this confirmed tax payment by type, amount, and date; its settlement is held in suspense.');
          }
          const mode = linkedSource?.paymentMode ?? finance.paymentMode;
          const cashAccount = moneyAccount(mode);
          append(postings, account, 'debit', finance.amount);
          if (cashAccount) append(postings, cashAccount, 'credit', finance.amount);
          else {
            append(postings, 'settlement-suspense', 'credit', finance.amount);
            addReview(entry.id, date, finance.reference, linkedSource
              ? 'The linked tax payment has no supported cash or bank account.'
              : 'The tax payment has no supported cash or bank account.');
          }
        }
        makeJournal({
          id: `finance:${entry.id}`,
          date,
          sourceId: entry.id,
          sourceType: 'financial_record',
          description: `${finance.kind}: ${finance.reference}`,
          reference: finance.reference || entry.id,
        }, postings);
      } else if (finance.kind === 'working_capital') {
        const record = finance as WorkingCapitalRecord;
        const date = record.date;
        const detail = `${record.partyName} · ${record.reference}`;
        const cash = record.paymentMode === 'non_cash' ? '' : record.paymentMode;
        const loanAccount = record.loanTerm === 'current' ? 'current-loans' : 'non-current-loans';
        const accountId = record.account === 'prepayment' ? 'prepayments'
          : record.account === 'accrual' ? 'accrued-expenses'
            : record.account === 'unearned_revenue' ? 'unearned-revenue'
              : record.account === 'lease' ? (record.loanTerm === 'current' ? 'current-leases' : 'non-current-leases') : loanAccount;
        if (record.action === 'opening') {
          const aggregate = record.account === 'prepayment' ? 'other-current-assets'
            : record.account === 'loan' ? 'current-loans' : 'other-current-liabilities';
          if (record.account === 'prepayment' || record.account === 'loan') {
            append(postings, accountId, 'debit', record.amount);
            append(postings, aggregate, 'credit', record.amount);
          } else if (record.account === 'lease') {
            append(postings, 'right-of-use-assets', 'debit', record.amount);
            append(postings, accountId, 'credit', record.amount);
          } else {
            append(postings, aggregate, 'debit', record.amount);
            append(postings, accountId, 'credit', record.amount);
          }
          makeJournal({
            id: `finance:${entry.id}`,
            date,
            sourceId: entry.id,
            sourceType: 'financial_record',
            description: detail,
            reference: record.reference || entry.id,
            isOpeningClassification: true,
          }, postings);
        } else if (record.action === 'increase') {
          if (record.account === 'lease') {
            append(postings, 'right-of-use-assets', 'debit', record.amount);
            append(postings, 'non-current-leases', 'credit', record.amount);
          } else if (record.account === 'prepayment') {
            append(postings, accountId, 'debit', record.amount);
            append(postings, moneyAccount(cash) || 'settlement-suspense', 'credit', record.amount);
          } else if (record.account === 'accrual') {
            append(postings, ensureExpenseAccount('Accrued expense recognized'), 'debit', record.amount);
            append(postings, accountId, 'credit', record.amount);
          } else {
            append(postings, moneyAccount(cash) || 'settlement-suspense', 'debit', record.amount);
            append(postings, accountId, 'credit', record.amount);
          }
          makeJournal({ id: `finance:${entry.id}`, date, sourceId: entry.id, sourceType: 'financial_record', description: detail, reference: record.reference || entry.id }, postings);
        } else if (record.action === 'release') {
          if (record.account === 'prepayment') {
            append(postings, ensureExpenseAccount('Prepayment expense recognized'), 'debit', record.amount);
            append(postings, accountId, 'credit', record.amount);
          } else if (record.account === 'accrual') {
            append(postings, accountId, 'debit', record.amount);
            append(postings, moneyAccount(cash) || 'settlement-suspense', 'credit', record.amount);
          } else if (record.account === 'unearned_revenue') {
            append(postings, accountId, 'debit', record.amount);
            append(postings, 'unearned-revenue-release', 'credit', record.amount);
          } else if (record.account === 'lease') {
            const split = leasePaymentSplit(active as WorkingEntry[], entry.id);
            if (!split) {
              append(postings, 'transaction-suspense', 'debit', record.amount);
              append(postings, moneyAccount(cash) || 'settlement-suspense', 'credit', record.amount);
              addReview(entry.id, date, detail, 'The lease payment could not be allocated to its scheduled interest and principal.');
            } else {
              append(postings, 'current-leases', 'debit', split.principal);
              append(postings, 'interest-expense', 'debit', split.interest);
              append(postings, moneyAccount(cash) || 'settlement-suspense', 'credit', record.amount);
            }
          } else {
            append(postings, accountId, 'debit', record.amount);
            append(postings, moneyAccount(cash) || 'settlement-suspense', 'credit', record.amount);
          }
          makeJournal({ id: `finance:${entry.id}`, date, sourceId: entry.id, sourceType: 'financial_record', description: detail, reference: record.reference || entry.id }, postings);
        } else {
          append(postings, 'interest-expense', 'debit', record.amount);
          append(postings, moneyAccount(cash) || 'settlement-suspense', 'credit', record.amount);
          makeJournal({ id: `finance:${entry.id}`, date, sourceId: entry.id, sourceType: 'financial_record', description: detail, reference: record.reference || entry.id }, postings);
        }
      } else if (finance.kind === 'asset') {
        const asset = finance as AssetRecord;
        const source = asset.sourceEntryId ? active.find(candidate => candidate.id === asset.sourceEntryId) : undefined;
        const date = asset.date;
        const description = `${asset.name} · ${asset.reference}`;
        const assetPostings: DraftPosting[] = [];
        append(assetPostings, anchorDate && asset.date <= anchorDate ? 'ppe-opening-net' : 'ppe-cost', 'debit', asset.cost);
        const validSource = source?.type === 'expense' && assetBySource.has(source.id);
        if (validSource && source) {
          const offset = source.paymentMode === 'credit' ? 'creditors' : moneyAccount(source.paymentMode);
          if (offset) append(assetPostings, offset, 'credit', asset.cost);
          else {
            append(assetPostings, 'asset-suspense', 'credit', asset.cost);
            addReview(entry.id, date, description, 'Linked asset source does not identify a supported payment account.');
          }
        } else if (!asset.sourceEntryId && (asset.paymentMode === 'cash' || asset.paymentMode === 'bank')) {
          append(assetPostings, asset.paymentMode, 'credit', asset.cost);
        } else {
          append(assetPostings, 'asset-suspense', 'credit', asset.cost);
          addReview(entry.id, date, description, source
            ? 'The linked expense does not match the registered equipment purchase by category, amount, and date; its counterpart is held in suspense.'
            : asset.sourceEntryId
              ? 'The linked equipment expense was not found; its counterpart is held in suspense.'
              : 'The asset is not linked to a transaction and has no cash or bank account; its counterpart is held in suspense.');
        }
        makeJournal({ id: `asset:${entry.id}`, date, sourceId: entry.id, sourceType: 'financial_record', description, reference: asset.reference || entry.id }, assetPostings);
      } else {
        addReference(entry.id, entry.date, description, 'This financial record has no supported journal mapping.');
        addReview(entry.id, entry.date, description, 'Financial record type is not supported by the General Ledger mapping.');
      }
    } else {
      addReference(entry.id, entry.date, description, 'This source record is not a posted transaction.');
      addReview(entry.id, entry.date, description, 'No General Ledger mapping is available for this source record type.');
    }
  }

  let openingJournal: DraftJournal | undefined;
  if (anchor?.openingBalances) {
    const openingPostings: DraftPosting[] = [];
    for (const [field, accountId, normalSide] of OPENING_ACCOUNTS) {
      const value = anchor.openingBalances[field];
      if (typeof value === 'number' && Number.isFinite(value)) {
        const side = value < 0 ? (normalSide === 'debit' ? 'credit' : 'debit') : normalSide;
        append(openingPostings, accountId, side, Math.abs(value));
      } else {
        addReview(anchor.id, anchor.date, anchor.reference ?? 'Opening balances', `Opening amount for ${field} is missing; the starting position is incomplete.`);
      }
    }
    openingJournal = {
      id: `opening:${anchor.id}`,
      date: anchor.date,
      sourceId: anchor.id,
      sourceType: 'opening_balance',
      description: 'Confirmed opening balances',
      reference: anchor.reference || anchor.id,
      postings: openingPostings,
      openingBalance: true,
    };
    const debit = openingPostings.filter(p => p.side === 'debit').reduce((sum, p) => sum + toCents(p.amount), 0);
    const credit = openingPostings.filter(p => p.side === 'credit').reduce((sum, p) => sum + toCents(p.amount), 0);
    if (debit !== credit) {
      const difference = Math.abs(debit - credit) / 100;
      append(openingPostings, 'opening-suspense', debit > credit ? 'credit' : 'debit', difference);
      openingJournal.needsReview = true;
      addReview(anchor.id, anchor.date, openingJournal.description, 'Opening account balances do not balance; the difference is shown in opening suspense, not assigned to capital.');
    }
  }

  const assetAnchorDate = anchorDate ?? '';
  const registeredAssetsAtAnchor = assetRecords
    .map(entry => entry.finance as AssetRecord)
    .filter(asset => asset.date <= assetAnchorDate && (!asset.disposalDate || asset.disposalDate > assetAnchorDate))
    .reduce((sum, asset) => sum + asset.cost - accumulatedDepreciation(asset, assetAnchorDate), 0);
  if (anchor?.openingBalances && Math.abs(registeredAssetsAtAnchor - anchor.openingBalances.fixedAssets) > 0.01 && registeredAssetsAtAnchor > 0) {
    addReview(anchor.id, anchor.date, 'Fixed assets', 'The registered asset carrying values do not match the confirmed opening fixed-asset balance. Review before relying on fixed-asset balances.');
  }

  const leaseRoots = active.filter(entry => entry.finance?.kind === 'working_capital'
    && entry.finance.account === 'lease' && entry.finance.action === 'increase');
  for (const root of leaseRoots) {
    const record = root.finance as WorkingCapitalRecord;
    const dates = new Set<string>([record.date]);
    let month = monthEnd(record.date);
    while (month <= endDate) {
      if (month >= record.date) dates.add(month);
      month = monthEnd(nextMonthStart(month));
    }
    let priorCurrent = 0;
    for (const date of [...dates].sort()) {
      if (date > endDate || date < (anchorDate ?? '0000-01-01')) continue;
      const current = leaseLiabilitySplit(active as WorkingEntry[], root.id, date).current;
      const difference = roundMoney(current - priorCurrent);
      if (difference) {
        const postings: DraftPosting[] = [];
        append(postings, difference > 0 ? 'non-current-leases' : 'current-leases', 'debit', Math.abs(difference));
        append(postings, difference > 0 ? 'current-leases' : 'non-current-leases', 'credit', Math.abs(difference));
        makeJournal({
          id: `lease-reclassification:${root.id}:${date}`,
          date,
          sourceId: root.id,
          sourceType: 'calculated_lease_reclassification',
          description: `${record.partyName} lease current portion`,
          reference: record.reference || root.id,
        }, postings);
      }
      priorCurrent = current;
    }
  }

  // Depreciation is derived from the existing asset register, not written back as a transaction.
  for (const assetEntry of assetRecords) {
    const asset = assetEntry.finance as AssetRecord;
    const until = asset.disposalDate && asset.disposalDate < endDate ? asset.disposalDate : endDate;
    if (until < asset.depreciationStart) continue;
    let previous = previousDate(asset.depreciationStart);
    let periodStart = asset.depreciationStart;
    while (periodStart <= until) {
      const date = monthEnd(periodStart) < until ? monthEnd(periodStart) : until;
      const amount = roundMoney(Math.max(0, accumulatedDepreciation(asset, date) - accumulatedDepreciation(asset, previous)));
      if (amount > 0) {
        const postings: DraftPosting[] = [];
        append(postings, 'depreciation-expense', 'debit', amount);
        append(postings, anchorDate && asset.date <= anchorDate ? 'ppe-opening-net' : 'accumulated-depreciation', 'credit', amount);
        makeJournal({
          id: `depreciation:${assetEntry.id}:${date}`,
          date,
          sourceId: assetEntry.id,
          sourceType: 'calculated_depreciation',
          description: `${asset.name} depreciation`,
          reference: asset.reference || assetEntry.id,
        }, postings);
      }
      previous = date;
      periodStart = nextMonthStart(date);
    }
    if (asset.disposalDate && asset.disposalDate >= (anchorDate ?? '0000-01-01') && asset.disposalDate <= endDate) {
      const disposalPostings: DraftPosting[] = [];
      const carrying = roundMoney(Math.max(0, asset.cost - accumulatedDepreciation(asset, asset.disposalDate)));
      const netAssetAccount = anchorDate && asset.date <= anchorDate ? 'ppe-opening-net' : 'ppe-cost';
      if (asset.disposalAccount && typeof asset.disposalProceeds === 'number') append(disposalPostings, asset.disposalAccount, 'debit', asset.disposalProceeds);
      if (anchorDate && asset.date <= anchorDate) {
        append(disposalPostings, netAssetAccount, 'credit', carrying);
      } else {
        append(disposalPostings, 'accumulated-depreciation', 'debit', accumulatedDepreciation(asset, asset.disposalDate));
        append(disposalPostings, netAssetAccount, 'credit', asset.cost);
      }
      const proceeds = safe(asset.disposalProceeds);
      if (proceeds > carrying) append(disposalPostings, 'asset-disposal-gain', 'credit', proceeds - carrying);
      else append(disposalPostings, 'asset-disposal-loss', 'debit', carrying - proceeds);
      makeJournal({
        id: `disposal:${assetEntry.id}`,
        date: asset.disposalDate,
        sourceId: assetEntry.id,
        sourceType: 'asset_disposal',
        description: `${asset.name} disposal`,
        reference: asset.reference || assetEntry.id,
      }, disposalPostings);
    }
  }
  for (const leaseEntry of active.filter(entry => entry.finance?.kind === 'working_capital'
    && entry.finance.account === 'lease' && entry.finance.action === 'increase')) {
    const lease = leaseEntry.finance as WorkingCapitalRecord;
    const asset = leaseRightOfUseAsset(lease);
    if (!asset || lease.date > endDate) continue;
    const until = lease.date < endDate ? endDate : lease.date;
    let previous = previousDate(asset.depreciationStart);
    let periodStart = asset.depreciationStart;
    while (periodStart <= until) {
      const date = monthEnd(periodStart) < until ? monthEnd(periodStart) : until;
      const amount = roundMoney(Math.max(0, accumulatedDepreciation(asset, date) - accumulatedDepreciation(asset, previous)));
      if (amount > 0) {
        const postings: DraftPosting[] = [];
        append(postings, 'depreciation-expense', 'debit', amount);
        append(postings, 'right-of-use-assets', 'credit', amount);
        makeJournal({
          id: `lease-depreciation:${leaseEntry.id}:${date}`,
          date,
          sourceId: leaseEntry.id,
          sourceType: 'calculated_depreciation',
          description: `${asset.name} depreciation`,
          reference: lease.reference || leaseEntry.id,
        }, postings);
      }
      previous = date;
      periodStart = nextMonthStart(date);
    }
  }

  const sortJournals = (items: DraftJournal[]) => [...items].sort((a, b) =>
    a.date.localeCompare(b.date) || Number(!!b.openingBalance) - Number(!!a.openingBalance) || a.id.localeCompare(b.id),
  );
  const sorted = sortJournals(journals);
  const snapshotAtStart = openings.some(entry => entry.date === startDate);
  const startAnchor = openings.filter(entry => entry.date < startDate).at(-1);
  const startBalances: Record<string, number> = {};
  if (snapshotAtStart) {
    // The snapshot is a close-of-day balance row in the selected period, not
    // both an opening balance and a period transaction.
  } else if (startAnchor?.openingBalances) {
    for (const [field, accountId, normalSide] of OPENING_ACCOUNTS) {
      const value = startAnchor.openingBalances[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      startBalances[accountId] = (startBalances[accountId] ?? 0) + toCents(value) * (normalSide === 'debit' ? 1 : -1);
    }
    for (const journal of sorted.filter(item =>
      (item.date > startAnchor.date || (item.isOpeningClassification && item.date === startAnchor.date)) && item.date < startDate,
    )) {
      for (const posting of journal.postings) startBalances[posting.accountId] = (startBalances[posting.accountId] ?? 0) + (posting.side === 'debit' ? toCents(posting.amount) : -toCents(posting.amount));
    }
  } else {
    for (const journal of sorted.filter(item => item.date < startDate && (!anchorDate || item.date < anchorDate))) {
      for (const posting of journal.postings) startBalances[posting.accountId] = (startBalances[posting.accountId] ?? 0) + (posting.side === 'debit' ? toCents(posting.amount) : -toCents(posting.amount));
    }
  }

  const legacyJournals = anchorDate && startDate < anchorDate
    ? sorted.filter(item => !item.openingBalance && item.date >= startDate && item.date <= anchorDate && !(item.isOpeningClassification && item.date === anchorDate))
    : [];
  const reportJournals = sorted.filter(item => {
    if (item.openingBalance) return item.id === openingJournal?.id && item.date >= startDate;
    if (item.isOpeningClassification && item.date === anchorDate) return !!anchorDate && item.date <= endDate && item.date >= startDate;
    if (anchorDate && item.date <= anchorDate) return false;
    return item.date >= startDate && item.date <= endDate;
  });
  if (openingJournal && openingJournal.date >= startDate && openingJournal.date <= endDate) {
    reportJournals.push(openingJournal);
  }
  const uniqueReportJournals = sortJournals([...new Map(reportJournals.map(journal => [journal.id, journal])).values()]);
  const legacyLines = materializeRows(legacyJournals, {});
  const balancesAtEnd: Record<string, number> = {};
  const latestOpening = openings.filter(entry => entry.date <= endDate).at(-1);
  if (latestOpening?.openingBalances) {
    for (const [field, accountId, normalSide] of OPENING_ACCOUNTS) {
      const value = latestOpening.openingBalances[field];
      if (typeof value === 'number' && Number.isFinite(value)) balancesAtEnd[accountId] = (balancesAtEnd[accountId] ?? 0) + toCents(value) * (normalSide === 'debit' ? 1 : -1);
    }
    for (const journal of sorted.filter(item => item.date > latestOpening.date && item.date <= endDate)) {
      for (const posting of journal.postings) balancesAtEnd[posting.accountId] = (balancesAtEnd[posting.accountId] ?? 0) + (posting.side === 'debit' ? toCents(posting.amount) : -toCents(posting.amount));
    }
    for (const journal of sorted.filter(item => item.isOpeningClassification && item.date === latestOpening.date)) {
      for (const posting of journal.postings) balancesAtEnd[posting.accountId] = (balancesAtEnd[posting.accountId] ?? 0) + (posting.side === 'debit' ? toCents(posting.amount) : -toCents(posting.amount));
    }
  } else {
    for (const journal of sorted.filter(item => item.date <= endDate)) {
      for (const posting of journal.postings) balancesAtEnd[posting.accountId] = (balancesAtEnd[posting.accountId] ?? 0) + (posting.side === 'debit' ? toCents(posting.amount) : -toCents(posting.amount));
    }
  }

  const currentBalances = { ...startBalances };
  const rows: GeneralLedgerRow[] = [];
  for (const journal of uniqueReportJournals) {
    rows.push(...materializeRows([journal], currentBalances));
  }
  const balances = [...accountMap.values()].map(account => {
    const openingBalance = fromCents(startBalances[account.id] ?? 0);
    const periodRows = rows.filter(row => row.accountId === account.id && !row.openingBalance);
    const periodDebit = roundMoney(periodRows.reduce((sum, row) => sum + row.debit, 0));
    const periodCredit = roundMoney(periodRows.reduce((sum, row) => sum + row.credit, 0));
    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.name,
      classification: account.classification,
      openingBalance,
      periodDebit,
      periodCredit,
      closingBalance: fromCents(balancesAtEnd[account.id] ?? 0),
    };
  }).filter(balance => balance.openingBalance !== 0 || balance.periodDebit !== 0 || balance.periodCredit !== 0 || balance.closingBalance !== 0);
  const periodDebit = roundMoney(rows.filter(row => !row.openingBalance).reduce((sum, row) => sum + row.debit, 0));
  const periodCredit = roundMoney(rows.filter(row => !row.openingBalance).reduce((sum, row) => sum + row.credit, 0));
  const trialBalanceDebit = roundMoney(Object.values(balancesAtEnd).reduce((sum, value) => sum + Math.max(0, value), 0) / 100);
  const trialBalanceCredit = roundMoney(Object.values(balancesAtEnd).reduce((sum, value) => sum + Math.max(0, -value), 0) / 100);
  const isBalanced = Math.abs(trialBalanceDebit - trialBalanceCredit) < 0.01;
  return {
    startDate,
    endDate,
    openingDate: anchorDate,
    accounts: [...accountMap.values()].sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name)),
    rows,
    historicalRows: legacyLines,
    balances,
    reviewItems: reviewItems.sort((a, b) => a.date.localeCompare(b.date) || a.sourceId.localeCompare(b.sourceId)),
    referenceOnly: referenceOnly.sort((a, b) => a.date.localeCompare(b.date) || a.sourceId.localeCompare(b.sourceId)),
    periodDebit,
    periodCredit,
    trialBalanceDebit,
    trialBalanceCredit,
    isBalanced,
    hasConfirmedOpening: !!anchor,
  };

  function materializeRows(items: DraftJournal[], running: Record<string, number>): GeneralLedgerRow[] {
    const result: GeneralLedgerRow[] = [];
    for (const journal of items) {
      if (journal.openingBalance) {
        for (const accountId of accountMap.keys()) running[accountId] = 0;
      }
      for (let index = 0; index < journal.postings.length; index++) {
        const posting = journal.postings[index];
        const account = accountMap.get(posting.accountId)!;
        const debit = posting.side === 'debit' ? posting.amount : 0;
        const credit = posting.side === 'credit' ? posting.amount : 0;
        const signed = posting.side === 'debit' ? toCents(debit) : -toCents(credit);
        running[posting.accountId] = (running[posting.accountId] ?? 0) + signed;
        const balance = running[posting.accountId];
        result.push({
          id: `${journal.id}:${index}`,
          journalId: journal.id,
          date: journal.date,
          sourceId: journal.sourceId,
          sourceType: journal.sourceType,
          description: journal.description,
          reference: journal.reference,
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          classification: account.classification,
          debit,
          credit,
          balance: fromCents(balance),
          openingBalance: journal.openingBalance,
          needsReview: journal.needsReview,
        });
      }
    }
    return result;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function generalLedgerToHTML(businessName: string, report: GeneralLedgerReport, accountId = 'all'): string {
  const rows = report.rows.filter(row => accountId === 'all' || row.accountId === accountId);
  const historical = report.historicalRows.filter(row => accountId === 'all' || row.accountId === accountId);
  const amount = (value: number) => `₦${Math.abs(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const bodyRows = rows.map(row => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.accountCode)} · ${escapeHtml(row.accountName)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.reference)}</td><td class="number">${row.debit ? amount(row.debit) : ''}</td><td class="number">${row.credit ? amount(row.credit) : ''}</td><td class="number">${amount(row.balance)} ${row.balance < 0 ? 'Cr' : 'Dr'}</td></tr>`).join('');
  const historicalRows = historical.length ? `<h2>Historical activity before the opening snapshot</h2><p>These source records are shown for review and do not carry into the confirmed opening balances.</p><table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${historical.map(row => `<tr><td>${escapeHtml(row.date)}</td><td>${escapeHtml(row.accountName)}</td><td>${escapeHtml(row.description)}</td><td>${escapeHtml(row.reference)}</td><td class="number">${row.debit ? amount(row.debit) : ''}</td><td class="number">${row.credit ? amount(row.credit) : ''}</td><td class="number">${amount(row.balance)} ${row.balance < 0 ? 'Cr' : 'Dr'}</td></tr>`).join('')}</tbody></table>` : '';
  const review = report.reviewItems.length
    ? `<h2>Needs review (${report.reviewItems.length})</h2><ul>${report.reviewItems.map(item => `<li>${escapeHtml(item.date)} · ${escapeHtml(item.description)} — ${escapeHtml(item.reason)}</li>`).join('')}</ul>`
    : '<p>No source mappings need review.</p>';
  const references = report.referenceOnly.length
    ? `<h2>Source records shown as evidence only (${report.referenceOnly.length})</h2><ul>${report.referenceOnly.map(item => `<li>${escapeHtml(item.date)} · ${escapeHtml(item.description)} — ${escapeHtml(item.reason)}</li>`).join('')}</ul>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(businessName)} — General Ledger</title><style>@page{size:A4 landscape;margin:14mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#17202a;margin:0 auto;padding:24px;max-width:1200px;font-size:12px}h1{font-size:22px;margin:0 0 4px}p{color:#566;margin:4px 0 16px}h2{font-size:15px;margin:24px 0 8px}table{width:100%;border-collapse:collapse;table-layout:fixed;margin:10px 0 18px}th{background:#173b35;color:white;text-align:left;font-size:10px;text-transform:uppercase;padding:8px 6px}td{padding:7px 6px;border-bottom:1px solid #dce3e0;overflow-wrap:anywhere;vertical-align:top}th:nth-child(1){width:9%}th:nth-child(2){width:19%}th:nth-child(3){width:22%}th:nth-child(4){width:14%}th:nth-child(5),th:nth-child(6),th:nth-child(7){width:12%;text-align:right}.number{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.summary{display:flex;gap:16px;flex-wrap:wrap;padding:10px;background:#f3f7f5;border:1px solid #dce3e0;border-radius:8px}.summary b{display:block;margin-top:3px}.note{font-size:11px;color:#455}</style></head><body><h1>${escapeHtml(businessName)} — General Ledger</h1><p>${escapeHtml(report.startDate)} to ${escapeHtml(report.endDate)}${report.openingDate ? ` · Opening snapshot ${escapeHtml(report.openingDate)}` : ' · No confirmed opening snapshot'}</p><div class="summary"><div>Period debits<b>${amount(report.periodDebit)}</b></div><div>Period credits<b>${amount(report.periodCredit)}</b></div><div>Trial balance debits<b>${amount(report.trialBalanceDebit)}</b></div><div>Trial balance credits<b>${amount(report.trialBalanceCredit)}</b></div><div>Status<b>${report.isBalanced ? 'Debits equal credits' : 'Out of balance'}</b></div></div><p class="note">Read-only reconstruction from saved source records. Bank transactions are grouped into one Bank account. Items needing account or source review are listed below; this report does not modify historical records.</p><table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Reference</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${bodyRows || '<tr><td colspan="7">No General Ledger activity in this period.</td></tr>'}</tbody></table>${historicalRows}<h2>Review items</h2>${review}${references}</body></html>`;
}
