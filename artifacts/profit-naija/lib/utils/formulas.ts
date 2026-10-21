/**
 * ProfitNaija — Business formula library
 *
 * All financial calculations are centralised here so every screen
 * uses the same definitions.
 */

import type { Entry, Product } from '@/context/EntriesContext';
import { creditReturnTotal, isCreditReturn, workingPeriod } from '@workspace/accounting-core';
import { dayBefore, financialPeriod, financeRecords, financialCashFlow, getOpeningRecord, linkedTaxSourceIds, supplierPurchasePayable } from '@workspace/accounting-core';
export { supplierPurchasePayable } from '@workspace/accounting-core';
import { getMoneyReportingWindow, calcMoneyAccountBalances } from './moneyAccounts.ts';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Period = 'daily' | 'weekly' | 'monthly' | 'yearly';

// ── Date helpers ──────────────────────────────────────────────────────────────

function pad(n: number): string { return String(n).padStart(2, '0'); }
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Return inclusive [start, end] date strings for the given period.
 */
export function getDateBounds(period: Period): { start: string; end: string } {
  const now  = new Date();
  const today = todayStr();
  if (period === 'daily') return { start: today, end: today };
  if (period === 'weekly') {
    const s = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return { start: `${s.getFullYear()}-${pad(s.getMonth()+1)}-${pad(s.getDate())}`, end: today };
  }
  if (period === 'monthly') {
    return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: today };
  }
  // yearly
  return { start: `${now.getFullYear()}-01-01`, end: today };
}

/**
 * Filter entries to those whose date falls within the given period.
 */
export function filterByPeriod(entries: Entry[], period: Period): Entry[] {
  const { start, end } = getDateBounds(period);
  return entries.filter(e => e.date >= start && e.date <= end);
}

/**
 * Human-readable label for a period.
 */
export function getPeriodLabel(period: Period): string {
  const now = new Date();
  if (period === 'daily')
    return now.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (period === 'weekly') {
    const s = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return `${s.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })} – ${now.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  if (period === 'monthly')
    return now.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });
  return `FY ${now.getFullYear()}`;
}

// ── Core formulas ─────────────────────────────────────────────────────────────

/**
 * Every unit selling price is VAT-exclusive, including historical sale lines.
 */
export function getSaleValue(entry: Pick<Entry, 'amount' | 'unitsSold' | 'unitSalesPrice' | 'vatPaid' | 'returnVat' | 'vatExclusive'>): number {
  if (typeof entry.unitsSold === 'number' && typeof entry.unitSalesPrice === 'number') {
    return Math.round(entry.unitsSold * entry.unitSalesPrice * 100) / 100;
  }
  return entry.vatExclusive ? Math.max(0, entry.amount - getEntryVAT(entry)) : entry.amount;
}

/** Entered sale/return total before separately tracked VAT calculations. */
export function getGrossSaleValue(entry: Pick<Entry, 'amount' | 'unitsSold' | 'unitSalesPrice' | 'vatExclusive' | 'vatPaid' | 'returnVat'>): number {
  return Math.round((getSaleValue(entry) + getEntryVAT(entry)) * 100) / 100;
}

/** Normalize old records at every read, without rewriting their unit prices. */
export function normalizeSaleEntry<T extends Entry>(entry: T): T {
  if (!['sale', 'credit_sale', 'return_inward'].includes(entry.type)) return entry;
  const vat = getEntryVAT(entry);
  return { ...entry, amount: getGrossSaleValue(entry), vatExclusive: true, vatPaid: vat, ...(entry.type === 'return_inward' ? { returnVat: vat } : {}) };
}

export function formatEntryDescription(entry: Entry): string {
  if(entry.finance?.kind==='working_capital'){
    const account={prepayment:'Prepayment',accrual:'Accrued expense',unearned_revenue:'Customer advance',loan:'Loan'}[entry.finance.account];
    const action={opening:'opening balance',increase:'increase',release:'settlement / recognition',interest:'interest paid'}[entry.finance.action];
    return `${account} ${action} · ${entry.finance.partyName} · ${entry.finance.reference}`;
  }
  const first = entry.itemName || entry.category || entry.notes || 'Transaction';
  return entry.partyName ? `${first} · ${entry.partyName}` : first;
}

export function getPurchaseBaseCost(entry: Pick<Entry, 'amount' | 'baseCost' | 'purchaseAmount' | 'totalLandedCost' | 'unitPurchasePrice' | 'unitsPurchased' | 'materialCosts' | 'carriageInward' | 'handlingCost'>): number {
  if ((typeof entry.unitPurchasePrice === 'number' || typeof entry.baseCost === 'number') && typeof entry.unitsPurchased === 'number') {
    return entry.unitsPurchased * (entry.unitPurchasePrice ?? entry.baseCost ?? 0);
  }
  const materialCosts = entry.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0;
  if (typeof entry.purchaseAmount === 'number') return Math.max(0, entry.purchaseAmount - materialCosts);
  if (typeof entry.totalLandedCost === 'number') {
    return Math.max(0, entry.totalLandedCost - materialCosts - (entry.carriageInward ?? 0) - (entry.handlingCost ?? 0));
  }
  return Math.max(0, entry.amount - materialCosts);
}

export function getRecognizedCreditPurchasePaymentCost(entry: Entry, allEntries: Entry[]): number {
  const original = entry.linkedCreditEntryId
    ? allEntries.find(candidate => candidate.type === 'credit_purchase' && candidate.id === entry.linkedCreditEntryId)
    : undefined;
  if (!original) return entry.amount;
  const gross = supplierPurchasePayable(original);
  const deferredCost = getPurchaseBaseCost(original)
    + (original.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0);
  return entry.amount * (deferredCost / Math.max(gross, deferredCost, 1));
}

function entriesForPeriod(entries: Entry[], period?: Period): Entry[] {
  return period ? filterByPeriod(entries, period) : entries;
}

/** Gross cash sales include only transactions paid at the time of sale. */
export function calcCashSales(entries: Entry[], period?: Period): number {
  return entriesForPeriod(entries, period)
    .filter(entry => entry.type === 'sale')
    .reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
}

/** Sales = cash and credit sale totals before returns inward; VAT is reported separately. */
export function calcTotalSales(entries: Entry[], period?: Period): number {
  const scopedEntries = entriesForPeriod(entries, period);
  return scopedEntries
    .filter(entry => entry.type === 'sale' || entry.type === 'credit_sale')
    .reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
}

/** VAT-exclusive sales before returns, for the Sales dashboard card. */
export function calcSalesExcludingVAT(entries: Entry[], period?: Period): number {
  return entriesForPeriod(entries, period)
    .filter(entry => entry.type === 'sale' || entry.type === 'credit_sale')
    .reduce((sum, entry) => sum + getSaleValue(entry), 0);
}

/** Dashboard Revenue uses VAT-exclusive sales less the VAT-exclusive part of customer refunds. */
export function calcDashboardRevenue(entries: Entry[], period?: Period): number {
  const scopedEntries = entriesForPeriod(entries, period);
  const returnsInward = scopedEntries
    .filter(entry => entry.type === 'return_inward')
    .reduce((sum, entry) => sum + getSaleValue(entry), 0);
  const start=scopedEntries.reduce((d,e)=>e.date<d?e.date:d,'9999-12-31');
  const end=scopedEntries.reduce((d,e)=>e.date>d?e.date:d,'0001-01-01');
  return calcSalesExcludingVAT(scopedEntries) - returnsInward + (scopedEntries.length ? workingPeriod(scopedEntries,start,end).revenue : 0);
}

/** Revenue = gross sale totals less gross returns inward; VAT remains a separate ledger. */
export function calcNetRevenue(entries: Entry[], period?: Period): number {
  const scopedEntries = entriesForPeriod(entries, period);
  const sales = calcTotalSales(scopedEntries);
  const returnInwards = scopedEntries
    .filter(entry => entry.type === 'return_inward')
    .reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
  const start=scopedEntries.reduce((d,e)=>e.date<d?e.date:d,'9999-12-31');
  const end=scopedEntries.reduce((d,e)=>e.date>d?e.date:d,'0001-01-01');
  return sales - returnInwards + (scopedEntries.length ? workingPeriod(scopedEntries,start,end).revenue : 0);
}

/** VAT included in gross revenue: sales VAT less VAT reversed on returns. */
export function calcSalesVATPassThrough(entries: Entry[]): number {
  return entries.reduce((total, entry) => {
    if (entry.type === 'sale' || entry.type === 'credit_sale') return total + getEntryVAT(entry);
    if (entry.type === 'return_inward') return total - getEntryVAT(entry);
    return total;
  }, 0);
}

export interface DirectCashFlowData {
  workingCapital: ReturnType<typeof workingPeriod>;
  reconciliationDifference: number;
  taxPayments: number;
  assetAcquisitions: number;
  assetDisposalProceeds: number;
  openingCash: number;
  ownerContributions: number;
  ownerDrawings: number;
  openingDate?: string;
  cashSales: number;
  debtorPayments: number;
  customerReturnRefunds: number;
  supplierReturnSettlements: number;
  totalOperatingReceipts: number;
  cashPurchases: number;
  creditorPayments: number;
  manualExpenses: number;
  totalOperatingPayments: number;
  netOperatingCashFlow: number;
  investingCashFlow: number;
  financingCashFlow: number;
  netChangeInCash: number;
  closingCash: number;
}

/**
 * Direct-method cash flow from recorded entries. Entries before the selected
 * period reconstruct opening cash; absent history means an explicit zero.
 * Return entries are treated as cash refunds/settlements because the entry
 * model has no non-cash settlement indicator. Automatically generated VAT
 * entries and calculated income-tax estimates are accruals, not cash events.
 */
export function buildDirectCashFlow(
  allEntries: Entry[],
  periodEntries: Entry[],
  periodStart: string,
  periodEnd?: string,
): DirectCashFlowData {
  const cashMovements = (entries: Entry[]) => {
    let receipts = 0;
    let payments = 0;
    for (const entry of entries) {
      if (entry.type === 'sale') receipts += getGrossSaleValue(entry);
      else if (entry.type === 'credit_sale_payment') receipts += entry.amount;
      else if (entry.type === 'return_outward') receipts += entry.amount;
      else if (entry.type === 'purchase') {
        payments += typeof entry.totalLandedCost === 'number'
          ? entry.totalLandedCost + (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0)
          : getPurchaseBaseCost(entry)
            + (entry.materialCosts?.reduce((sum, value) => sum + value, 0) ?? 0)
            + (entry.carriageInward ?? 0)
            + (entry.handlingCost ?? 0) + (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0);
      } else if (entry.type === 'credit_purchase_payment') payments += entry.amount;
      else if (entry.type === 'return_inward') payments += getGrossSaleValue(entry);
      else if (isCashExpenseEntry(entry)) payments += entry.amount;
    }
    return { receipts, payments };
  };

  const window = getMoneyReportingWindow(allEntries, periodEntries, periodStart,periodEnd);
  periodEntries = window.entries;
  const openingCash = window.openingCash;
  const cashSales = periodEntries.filter(entry => entry.type === 'sale')
    .reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
  const debtorPayments = periodEntries.filter(entry => entry.type === 'credit_sale_payment')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const customerReturnRefunds = periodEntries.filter(entry => entry.type === 'return_inward' && !isCreditReturn(entry))
    .reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
  const supplierReturnSettlements = periodEntries.filter(entry => entry.type === 'return_outward' && !isCreditReturn(entry))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const workingCapital=workingPeriod(periodEntries,periodStart,periodEnd??'9999-12-31');
  const totalOperatingReceipts = cashSales + debtorPayments + supplierReturnSettlements + workingCapital.advancesReceived;
  const cashPurchases = periodEntries.filter(entry => entry.type === 'purchase')
    .reduce((sum, entry) => sum + (typeof entry.totalLandedCost === 'number'
      ? entry.totalLandedCost + (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0)
      : getPurchaseBaseCost(entry)
        + (entry.materialCosts?.reduce((subtotal, value) => subtotal + value, 0) ?? 0)
        + (entry.carriageInward ?? 0)
        + (entry.handlingCost ?? 0) + (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0)), 0);
  const creditorPayments = periodEntries.filter(entry => entry.type === 'credit_purchase_payment')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const linkedTaxSources=linkedTaxSourceIds(allEntries);
  const manualExpenses = periodEntries
    .filter(entry => isCashExpenseEntry(entry) && entry.category?.toLowerCase() !== 'equipment')
    .filter(entry=>!linkedTaxSources.has(entry.id))
    .reduce((sum, entry) => sum + entry.amount, 0);
  const end=periodEnd??periodEntries.reduce((date,e)=>e.date>date?e.date:date,periodStart);
  const financial=financialCashFlow(allEntries,periodStart,end,getOpeningRecord(allEntries,end)?.date);
  const totalOperatingPayments = cashPurchases + creditorPayments + customerReturnRefunds + manualExpenses + financial.taxPayments
    + workingCapital.prepayments + workingCapital.accruedPayments + workingCapital.interestPaid;
  const netOperatingCashFlow = totalOperatingReceipts - totalOperatingPayments;
  const equipmentPurchases = periodEntries
    .filter(entry => isCashExpenseEntry(entry) && entry.category?.toLowerCase() === 'equipment')
    .reduce((sum, entry) => sum + entry.amount, 0);
  const investingCashFlow = -equipmentPurchases-financial.assetAcquisitions+financial.assetDisposalProceeds;
  const ownerContributions = periodEntries.filter(e => e.type === 'owner_contribution').reduce((n, e) => n + e.amount, 0);
  const ownerDrawings = periodEntries.filter(e => e.type === 'owner_drawings').reduce((n, e) => n + e.amount, 0);
  const financingCashFlow = ownerContributions - ownerDrawings + workingCapital.financing;
  const netChangeInCash = netOperatingCashFlow + investingCashFlow + financingCashFlow;
  const accounts=calcMoneyAccountBalances(allEntries,end);
  const closingCash=Math.round((accounts.cash+accounts.bank)*100)/100;
  return {
    ...financial, openingCash, ownerContributions, ownerDrawings, openingDate: window.openingDate,
    cashSales, debtorPayments, customerReturnRefunds,
    supplierReturnSettlements, totalOperatingReceipts, cashPurchases,
    creditorPayments, manualExpenses, totalOperatingPayments,
    netOperatingCashFlow, investingCashFlow, financingCashFlow,
    netChangeInCash, closingCash, workingCapital,
    reconciliationDifference:Math.round((closingCash-openingCash-netChangeInCash)*100)/100,
  };
}

/**
 * COST = Cash Purchases + Credit Purchases + Carriage + Handling + Other Cost
 * − Returns Outward.
 *
 * Supplier payments settle creditors and do not create a second cost. Returns
 * inward reduce revenue only; they are not added to COST.
 */
export function calcCostBalance(entries: Entry[], products: Product[] = []): number {
  return entries.reduce((total, entry) => {
    if (entry.type === 'purchase' || entry.type === 'credit_purchase') {
      return total + getPurchaseBaseCost(entry)
        + (entry.materialCosts?.reduce((s, v) => s + v, 0) ?? 0)
        + (entry.carriageInward ?? 0)
        + (entry.handlingCost ?? 0);
    }
    if (entry.type === 'return_outward') {
      return total - getInventoryMovementCost(entry, products);
    }
    return total;
  }, 0);
}

export function calcRevenue(entries: Entry[], period: Period): number {
  return calcNetRevenue(entries, period);
}

/**
 * Purchase value = units purchased × unit purchase price.
 *
 * New entries keep an explicit unit purchase price. Older entries may keep the
 * same value as baseCost instead, so baseCost × quantity is the next fallback.
 * Aggregate fields are only used when no unit-cost record is available.
 */
export function getPurchaseValue(
  entry: Pick<Entry, 'amount' | 'baseCost' | 'materialCosts' | 'purchaseAmount' | 'totalLandedCost' | 'unitPurchasePrice' | 'unitsPurchased'>,
): number {
  const otherCosts = entry.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0;
  if (
    typeof entry.unitPurchasePrice === 'number' &&
    typeof entry.unitsPurchased === 'number'
  ) {
    return (entry.unitsPurchased * entry.unitPurchasePrice) + otherCosts;
  }
  if (
    typeof entry.baseCost === 'number' &&
    typeof entry.unitsPurchased === 'number'
  ) {
    return (entry.unitsPurchased * entry.baseCost) + otherCosts;
  }
  if (typeof entry.purchaseAmount === 'number') return entry.purchaseAmount;
  return entry.totalLandedCost ?? entry.amount;
}

/**
 * Inventory received at cost. Explicit unit cost × quantity is authoritative;
 * legacy aggregate landed-cost fields may have been saved without multiplying
 * by quantity.
 */
export function getInventoryPurchaseCost(entry: Entry): number {
  if (
    (typeof entry.unitPurchasePrice === 'number' || typeof entry.baseCost === 'number') &&
    typeof entry.unitsPurchased === 'number'
  ) {
    return getPurchaseBaseCost(entry);
  }
  return getPurchaseBaseCost(entry);
}

/**
 * COST = cash purchases + credit purchases + carriage + handling + other cost
 * − returns outward.
 */
export function calcCostForEntries(entries: Entry[], products: Product[] = []): number {
  return calcCostBalance(entries, products);
}

/**
 * Inventory purchases are recognized when goods are received, regardless of
 * whether the supplier was paid immediately or on credit.
 */
export function getInventoryMovementCost(entry: Entry, products: Product[]): number {
  if (entry.type === 'return_outward' && typeof entry.returnLandedCost === 'number') {
    return entry.returnLandedCost;
  }
  if (entry.type === 'return_inward' || entry.type === 'return_outward') {
    const product = entry.productId ? products.find(candidate => candidate.id === entry.productId) : undefined;
    return getReturnBaseCost(entry, product?.costPrice ?? 0) * (entry.unitsSold ?? 0);
  }
  if (typeof entry.cogsAmount === 'number') return entry.cogsAmount;
  const product = entry.productId
    ? products.find(candidate => candidate.id === entry.productId)
    : undefined;
  const quantity = entry.unitsSold ?? entry.unitsPurchased ?? 0;
  return product ? product.costPrice * quantity : 0;
}

/** Product stockCost stores base value; ancillary value is tracked separately. */
function getInventoryBaseMovementCost(entry: Entry, products: Product[]): number {
  if (entry.type !== 'return_outward') return getInventoryMovementCost(entry, products);
  const product = products.find(candidate => candidate.id === entry.productId);
  return getReturnBaseCost(entry, product?.costPrice ?? 0) * (entry.unitsSold ?? 0);
}

export function calcInventoryPurchasesForEntries(entries: Entry[], products: Product[] = []): number {
  return entries.reduce((total, entry) => {
    if (entry.type === 'purchase' || entry.type === 'credit_purchase') {
      return total + getInventoryPurchaseCost(entry);
    }
    if (entry.type === 'return_outward') return total - getInventoryMovementCost(entry, products);
    return total;
  }, 0);
}

export function calcCost(entries: Entry[], period: Period): number {
  return calcCostForEntries(filterByPeriod(entries, period));
}

/** Automatically generated VAT entries are reported separately from expenses. */
export function isDirectExpenseEntry(entry: Entry): boolean {
  return entry.type === 'expense' && !(
    entry.category === 'VAT Paid' &&
    entry.notes?.startsWith('VAT on Sale ID:')
  );
}

/** Expense recognition is independent of payment; credit and depreciation are not cash outflows. */
export function isCashExpenseEntry(entry: Entry): boolean {
  return isDirectExpenseEntry(entry) && entry.paymentMode !== 'credit'
    && entry.paymentMode !== 'non_cash' && entry.category?.trim().toLowerCase() !== 'depreciation';
}

/** Supplier credit is the return's amount; the unrecovered carrying cost is a separate expense. */
export function getSupplierReturnExpense(entry: Entry): number {
  return entry.type === 'return_outward' && typeof entry.returnLandedCost === 'number'
    ? Math.max(0, entry.returnLandedCost - entry.amount)
    : 0;
}

/** User-facing expense label; preserve both the entered description and category. */
export function formatDirectExpenseDescription(entry: Pick<Entry, 'notes' | 'category'>): string {
  const category = entry.category && entry.category.toLowerCase() !== 'expenses' ? entry.category : '';
  return [entry.notes, category].filter(Boolean).join(' · ') || 'Other';
}

/** Expenses are all entries manually recorded through Add Entry. */
export function calcDirectExpensesForEntries(entries: Entry[]): number {
  return entries
    .reduce((sum, entry) => sum + (isDirectExpenseEntry(entry) ? entry.amount : 0) + getSupplierReturnExpense(entry), 0);
}

export function calcExpenses(entries: Entry[], period: Period): number {
  const scoped=filterByPeriod(entries, period);
  const working=workingPeriod(scoped,'0001-01-01','9999-12-31');
  return calcDirectExpensesForEntries(scoped)+working.expense+working.interest;
}

export interface PnLReportData {
  revenue: number;
  vatPassThrough: number;
  statementRevenue: number;
  openingStock: number;
  purchases: number;
  closingStock: number;
  cost: number;
  grossProfit: number;
  operatingExpenses: number;
  cashOperatingExpenses: number;
  nonCashOperatingExpenses: number;
  operatingProfit: number;
  interestOnLoan: number;
  profitBeforeTax: number;
  taxBasisProfitBeforeTax: number;
  taxBasisPreviousTax: number;
  tax: number;
  profitAfterTax: number;
  estimatedTax: number;
  assetDisposalProfit: number;
  inventoryIntroductions: number;
  itemizedOperatingExpenses: Array<{ label: string, value: number }>;
}

export function buildPnLReport(allEntries: Entry[], scopedEntries: Entry[], products: Product[], closingDate?: string, periodStart?: string): PnLReportData {
  const periodEnd = closingDate ?? (
    scopedEntries.reduce((end, entry) => entry.date > end ? entry.date : end, '') || todayStr()
  );
  const start = periodStart ?? (
    scopedEntries.reduce((earliest,e)=>e.date<earliest?e.date:earliest, periodEnd) || periodEnd
  );
  const working = workingPeriod(allEntries,start,periodEnd);
  const revenue = calcNetRevenue(scopedEntries);
  const vatPassThrough = calcSalesVATPassThrough(scopedEntries);
  // The P&L uses the same revenue basis as the dashboard.
  const statementRevenue = calcDashboardRevenue(scopedEntries);
  const purchases = calcCostBalance(scopedEntries, products);
  const closingStock = periodEnd ? calcInventoryValueAsOf(products, allEntries, periodEnd) : calcStockValue(products, allEntries);
  // Opening stock is the register value immediately before the report starts.
  const openingStock = calcInventoryValueAsOf(products,allEntries,dayBefore(start));
  const inventoryIntroductions=scopedEntries.filter(e=>e.type==='opening_stock').reduce((sum,e)=>sum+e.amount,0);
  const cost = openingStock + purchases + inventoryIntroductions - closingStock;

  const grossProfit = statementRevenue - cost;

  const registeredSources = new Set(financeRecords(allEntries).flatMap(r=>r.kind==='asset'||r.kind==='tax'?[r.sourceEntryId]:[]).filter(Boolean));
  const rawExpenses = scopedEntries.filter(isDirectExpenseEntry).filter(e=>!registeredSources.has(e.id));
  const operatingExpenseEntries = rawExpenses.filter(e => e.category?.toLowerCase() !== 'interest on loan');
  const interestEntries = rawExpenses.filter(e => e.category?.toLowerCase() === 'interest on loan');

  const supplierReturnExpense = scopedEntries.reduce((sum, entry) => sum + getSupplierReturnExpense(entry), 0);
  const financial = financialPeriod(allEntries,start,periodEnd);
  const operatingExpenses = operatingExpenseEntries.reduce((s, e) => s + e.amount, 0) + supplierReturnExpense + financial.depreciation + working.expense;
  const cashOperatingExpenses = operatingExpenseEntries.filter(isCashExpenseEntry).reduce((s, e) => s + e.amount, 0);
  const nonCashOperatingExpenses = operatingExpenses - cashOperatingExpenses;
  const interestOnLoan = interestEntries.reduce((s, e) => s + e.amount, 0) + working.interest;

  const itemizedMap = new Map<string, number>();
  for (const e of operatingExpenseEntries) {
    const label = formatDirectExpenseDescription(e);
    itemizedMap.set(label, (itemizedMap.get(label) ?? 0) + e.amount);
  }
  if (supplierReturnExpense > 0) itemizedMap.set('Supplier return expense', supplierReturnExpense);
  if(financial.depreciation) itemizedMap.set('Registered asset depreciation',financial.depreciation);
  if(working.expense) itemizedMap.set('Prepayment and accrued-expense recognition',working.expense);
  const itemizedOperatingExpenses = Array.from(itemizedMap.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  const operatingProfit = grossProfit - operatingExpenses + financial.disposalProfit;
  const profitBeforeTax = operatingProfit - interestOnLoan;
  let taxBasisProfitBeforeTax = profitBeforeTax;
  let taxBasisPreviousTax = 0;
  const yearStart = `${periodEnd.slice(0, 4)}-01-01`;
  if (periodStart && periodStart > yearStart && periodStart <= periodEnd && periodStart.slice(0, 4) === periodEnd.slice(0, 4)) {
    const previousDay = new Date(`${periodStart}T12:00:00`);
    previousDay.setDate(previousDay.getDate() - 1);
    const previousCutoff = `${previousDay.getFullYear()}-${String(previousDay.getMonth() + 1).padStart(2, '0')}-${String(previousDay.getDate()).padStart(2, '0')}`;
    const yearEntries = allEntries.filter(entry => entry.date >= yearStart && entry.date <= periodEnd);
    const previousEntries = allEntries.filter(entry => entry.date >= yearStart && entry.date <= previousCutoff);
    taxBasisProfitBeforeTax = buildPnLReport(allEntries, yearEntries, products, periodEnd,yearStart).profitBeforeTax;
    taxBasisPreviousTax = calcNigerianPIT(buildPnLReport(allEntries, previousEntries, products, previousCutoff,yearStart).profitBeforeTax);
  }
  const estimatedTax = Math.max(0, calcNigerianPIT(taxBasisProfitBeforeTax) - taxBasisPreviousTax);
  const tax = financial.incomeTaxExpense;
  const profitAfterTax = profitBeforeTax - tax;

  return {
    revenue,
    estimatedTax,
    assetDisposalProfit:financial.disposalProfit,
    inventoryIntroductions,
    vatPassThrough,
    statementRevenue,
    openingStock,
    purchases,
    closingStock,
    cost,
    grossProfit,
    operatingExpenses,
    cashOperatingExpenses,
    nonCashOperatingExpenses,
    operatingProfit,
    interestOnLoan,
    profitBeforeTax,
    taxBasisProfitBeforeTax,
    taxBasisPreviousTax,
    tax,
    profitAfterTax,
    itemizedOperatingExpenses,
  };
}

/**
 * Stock Value = total cost of all units currently available in the store.
 *
 * Product documents are normally the live source of truth. The inventory
 * ledger is a required fallback because a purchase entry can be saved before
 * its separately-created product document reaches Firestore.
 */
export function calcStockValue(products: Product[], entries: Entry[] = []): number {
  const productValue = getStockValueBreakdown(products, entries)
    .reduce((sum, row) => sum + row.totalCost, 0);

  // Live product balances include purchases, sales, corrections, revaluations,
  // and product archival. The entry ledger is only a fallback while no product
  // documents are available (for example during a legacy/offline migration).
  if (products.length > 0) return productValue;

  const hasPurchaseLedger = entries.some(
    entry => entry.type === 'purchase' || entry.type === 'credit_purchase' || entry.type === 'opening_stock',
  );
  if (!hasPurchaseLedger) return productValue;

  const ledgerValue = entries.reduce((value, entry) => {
    if (entry.type === 'opening_stock') return value + entry.amount;
      if (entry.type === 'purchase' || entry.type === 'credit_purchase') {
        return value + getInventoryPurchaseCost(entry);
    }
    if (entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_outward') {
      return value - getInventoryBaseMovementCost(entry, products);
    }
    if (entry.type === 'return_inward') {
      return value + getInventoryMovementCost(entry, products);
    }
    return value;
  }, 0);

  return Math.max(0, ledgerValue + getLegacyAncillaryStockValue(entries));
}

export interface StockValueLine {
  productId: string;
  name: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}

/** Product-level on-hand valuation, reconciling exactly to the Stock Value card. */
export function getStockValueBreakdown(products: Product[], entries: Entry[] = [], cutoffDate?: string): StockValueLine[] {
  return products.map(product => {
    const futureEntries = cutoffDate
      ? entries.filter(entry => entry.productId === product.id && entry.date > cutoffDate)
      : [];
    const liveQuantity = Math.max(0, product.stockQty);
    const quantity = Math.max(0, liveQuantity - futureEntries.reduce((sum, entry) => sum + inventoryStockEffect(entry), 0));
    let baseValue = Math.max(0, product.stockCost ?? liveQuantity * product.costPrice);
    for (const entry of futureEntries) {
      if (entry.type === 'purchase' || entry.type === 'credit_purchase') {
        baseValue -= getInventoryPurchaseCost(entry);
      } else if (entry.type === 'opening_stock') {
        baseValue -= entry.amount;
      } else if (entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_outward') {
        baseValue += getInventoryBaseMovementCost(entry, products);
      } else if (entry.type === 'return_inward') {
        baseValue -= getInventoryMovementCost(entry, products);
      }
    }
    baseValue = quantity > 0
      ? Math.max(0, baseValue)
      : 0;
    const ancillaryValue = quantity > 0
      ? getProductAncillaryStockValue(product, entries, cutoffDate)
      : 0;
    const totalCost = baseValue + ancillaryValue;
    return {
      productId: product.id,
      name: product.name || 'Unnamed product',
      quantity,
      unitCost: quantity > 0 ? totalCost / quantity : 0,
      totalCost,
    };
  });
}

/**
 * Inventory value at a date, anchored to the live product balance.
 *
 * Product quantities are the source of truth for stock currently on hand.
 * Historical balances are obtained by reversing movements after the cutoff.
 * This keeps today's P&L Closing Stock identical to the Stock Value card,
 * includes goods received on credit, and reduces stock when goods are sold.
 */
export function calcInventoryValueAsOf(products: Product[], entries: Entry[], cutoffDate: string): number {
  if (products.length === 0) {
    return Math.max(0, calcLegacyInventoryValueAsOf(entries, cutoffDate));
  }
  return getStockValueBreakdown(products, entries, cutoffDate)
    .reduce((sum, row) => sum + row.totalCost, 0);
}

function purchaseAncillaryCost(entry: Entry): number {
  return (entry.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0)
    + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0);
}

function getProductAncillaryStockValue(product: Product, entries: Entry[], cutoffDate?: string): number {
  const history = entries
    .filter(entry => entry.productId === product.id && (!cutoffDate || entry.date <= cutoffDate))
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
  let remainingUnits = 0;
  let ancillaryValue = 0;
  let lastKnownAncillaryPerUnit = 0;

  for (const entry of history) {
    const quantity = Math.max(0, entry.unitsPurchased ?? entry.unitsSold ?? 0);
    if (entry.type === 'purchase' || entry.type === 'credit_purchase') {
      remainingUnits += quantity;
      ancillaryValue += purchaseAncillaryCost(entry);
      if (remainingUnits > 0) lastKnownAncillaryPerUnit = ancillaryValue / remainingUnits;
    } else if (
      (entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_outward') &&
      quantity > 0 && remainingUnits > 0
    ) {
      const removedUnits = Math.min(quantity, remainingUnits);
      const averageAncillary = ancillaryValue / remainingUnits;
      lastKnownAncillaryPerUnit = averageAncillary;
      remainingUnits -= removedUnits;
      ancillaryValue = Math.max(0, ancillaryValue - averageAncillary * removedUnits);
    } else if (entry.type === 'return_inward' && quantity > 0) {
      const averageAncillary = remainingUnits > 0 ? ancillaryValue / remainingUnits : lastKnownAncillaryPerUnit;
      remainingUnits += quantity;
      ancillaryValue += averageAncillary * quantity;
      lastKnownAncillaryPerUnit = ancillaryValue / remainingUnits;
    }
  }

  if (remainingUnits <= 0 || ancillaryValue <= 0) return 0;
  const averageAncillaryPerUnit = ancillaryValue / remainingUnits;
  let quantityAtCutoff = Math.max(0, product.stockQty);
  if (cutoffDate) {
    for (const entry of entries) {
      if (entry.productId !== product.id || entry.date <= cutoffDate) continue;
      quantityAtCutoff -= inventoryStockEffect(entry);
    }
  }
  // Opening stock and untracked adjustments keep their live base value but
  // cannot inflate the ancillary premium beyond recorded purchased units.
  return Math.max(0, Math.min(quantityAtCutoff, remainingUnits)) * averageAncillaryPerUnit;
}

function inventoryStockEffect(entry: Entry): number {
  if (typeof entry.stockDelta === 'number') return entry.stockDelta;
  const quantity = entry.unitsPurchased ?? entry.unitsSold ?? 0;
  if (entry.type === 'purchase' || entry.type === 'credit_purchase' || entry.type === 'return_inward') return quantity;
  if (entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_outward') return -quantity;
  return 0;
}

function calcLegacyInventoryValueAsOf(entries: Entry[], cutoffDate: string): number {
  const historicalEntries = entries.filter(entry => entry.date <= cutoffDate);
  const baseValue = historicalEntries.reduce((value, entry) => {
    if (entry.type === 'opening_stock') return value + entry.amount;
    if (entry.type === 'purchase' || entry.type === 'credit_purchase') return value + getInventoryPurchaseCost(entry);
    if (entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_outward') return value - getInventoryBaseMovementCost(entry, []);
    if (entry.type === 'return_inward') return value + getInventoryMovementCost(entry, []);
    return value;
  }, 0);
  return baseValue + getLegacyAncillaryStockValue(historicalEntries);
}

function getLegacyAncillaryStockValue(entries: Entry[]): number {
  const trackedUnits = new Map<string, { units: number; ancillary: number; lastRate: number }>();
  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)) {
    if (entry.type !== 'purchase' && entry.type !== 'credit_purchase' &&
        entry.type !== 'sale' && entry.type !== 'credit_sale' &&
        entry.type !== 'return_outward' && entry.type !== 'return_inward') continue;
    const key = entry.productId ?? '__legacy_inventory__';
    const current = trackedUnits.get(key) ?? { units: 0, ancillary: 0, lastRate: 0 };
    const quantity = Math.max(0, entry.unitsPurchased ?? entry.unitsSold ?? 0);
    if (entry.type === 'purchase' || entry.type === 'credit_purchase') {
      current.units += quantity;
      current.ancillary += purchaseAncillaryCost(entry);
      if (current.units > 0) current.lastRate = current.ancillary / current.units;
    } else if (entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_outward') {
      const reduced = Math.min(quantity, current.units);
      const rate = current.units > 0 ? current.ancillary / current.units : 0;
      if (current.units > 0) current.lastRate = rate;
      current.units -= reduced;
      current.ancillary = Math.max(0, current.ancillary - reduced * rate);
    } else if (entry.type === 'return_inward' && quantity > 0) {
      const rate = current.units > 0 ? current.ancillary / current.units : current.lastRate;
      current.units += quantity;
      current.ancillary += quantity * rate;
      current.lastRate = current.ancillary / current.units;
    }
    trackedUnits.set(key, current);
  }
  return [...trackedUnits.values()].reduce((total, inventory) => total + inventory.ancillary, 0);
}

// ── Nigerian Personal Income Tax (Nigeria Tax Act 2025) ──────────────────────

/**
 * Annual individual PIT bands effective from 1 January 2026 under the
 * Nigeria Tax Act 2025.
 *
 * | Band (annual ₦)        | Rate |
 * |------------------------|------|
 * | First     800,000      |  0%  |
 * | Next    2,200,000      | 15%  |
 * | Next    9,000,000      | 18%  |
 * | Next   13,000,000      | 21%  |
 * | Next   25,000,000      | 23%  |
 * | Above 50,000,000       | 25%  |
 *
 * Pass the period profit; the function returns the tax liability for that amount.
 * Returns 0 for zero or negative profit.
 */
export const NIGERIA_PIT_BANDS: { limit: number; rate: number }[] = [
  { limit: 800_000, rate: 0 },
  { limit: 2_200_000, rate: 0.15 },
  { limit: 9_000_000, rate: 0.18 },
  { limit: 13_000_000, rate: 0.21 },
  { limit: 25_000_000, rate: 0.23 },
  { limit: Infinity, rate: 0.25 },
];

export function calcNigerianPIT(profit: number): number {
  if (profit <= 0) return 0;
  let remaining = profit;
  let tax = 0;
  for (const { limit, rate } of NIGERIA_PIT_BANDS) {
    if (remaining <= 0) break;
    const taxable = Math.min(remaining, limit);
    tax += taxable * rate;
    remaining -= taxable;
  }
  return Math.round(tax);
}

/** Effective tax rate as a percentage string, e.g. "18.5%" */
export function nigeriaPITEffectiveRate(profit: number): string {
  if (profit <= 0) return '0%';
  return `${((calcNigerianPIT(profit) / profit) * 100).toFixed(1)}%`;
}

// ── VAT ───────────────────────────────────────────────────────────────────────

export const VAT_RATE = 0.075; // Nigerian VAT 7.5%

export type VATLedgerKind = 'cash_sale' | 'credit_sale' | 'return_inward' | 'credit_sale_payment';
export interface VATLedgerRow {
  entry: Entry;
  kind: VATLedgerKind;
  baseAmount: number;
  vatRate?: number;
  vatAmount: number;
  direction: 'addition' | 'deduction' | 'allocation';
}

/**
 * Derive VAT from entered unit price and quantity whenever they are available.
 * Saved snapshots are retained only for legacy entries that cannot be rebuilt.
 */
export function getEntryVAT(entry: Pick<Entry, 'amount' | 'vatPaid' | 'returnVat' | 'unitsSold' | 'unitSalesPrice' | 'vatExclusive'>, productVAT = 0): number {
  if (typeof entry.unitsSold === 'number' && typeof entry.unitSalesPrice === 'number') {
    const vat = Math.max(0, entry.unitsSold * entry.unitSalesPrice * VAT_RATE);
    return Math.round(vat * 100) / 100;
  }
  if (typeof entry.returnVat === 'number') return Math.round(Math.max(0, entry.returnVat) * 100) / 100;
  if (typeof entry.vatPaid === 'number') return Math.round(Math.max(0, entry.vatPaid) * 100) / 100;
  if (productVAT > 0) return Math.max(0, productVAT * (entry.unitsSold ?? 1));
  return 0;
}

/**
 * Rebuild payment VAT allocations from the linked sale and payment history.
 * Persisted allocations are only a fallback when their original sale is absent.
 */
export function getCreditSalePaymentVATAllocations(entries: Entry[]): Map<string, number> {
  const originals = new Map(
    entries.filter(entry => entry.type === 'credit_sale').map(entry => [entry.id, entry]),
  );
  const paymentsByOriginal = new Map<string, Entry[]>();
  for (const payment of entries) {
    if (payment.type !== 'credit_sale_payment' || !payment.linkedCreditEntryId) continue;
    const linkedPayments = paymentsByOriginal.get(payment.linkedCreditEntryId) ?? [];
    linkedPayments.push(payment);
    paymentsByOriginal.set(payment.linkedCreditEntryId, linkedPayments);
  }

  const allocations = new Map<string, number>();
  for (const [originalId, payments] of paymentsByOriginal) {
    const original = originals.get(originalId);
    if (!original) {
      payments.forEach(payment => allocations.set(payment.id, Math.max(0, payment.allocatedVat ?? 0)));
      continue;
    }
    const gross = getGrossSaleValue(original);
    const vat = getEntryVAT(original);
    let paidBefore = 0;
    let vatAllocated = 0;
    const orderedPayments = payments.sort((a, b) =>
      a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    for (const payment of orderedPayments) {
      const paidAfter = Math.min(gross, paidBefore + Math.max(0, payment.amount));
      const allocated = gross > 0
        ? vat * ((paidAfter / gross) - (paidBefore / gross))
        : 0;
      allocations.set(payment.id, Math.max(0, allocated));
      paidBefore = paidAfter;
      vatAllocated += allocated;
    }
    if (orderedPayments.length > 0 && paidBefore >= gross && gross > 0) {
      const lastPayment = orderedPayments[orderedPayments.length - 1];
      allocations.set(
        lastPayment.id,
        Math.max(0, (allocations.get(lastPayment.id) ?? 0) + vat - vatAllocated),
      );
    }
  }
  return allocations;
}

/**
 * Build the complete VAT ledger. Payment allocations are references only:
 * they explain when credit-sale VAT was collected, but never add VAT again.
 * Unlinked historical payments remain visible as allocation rows with zero VAT.
 */
export function buildVATLedger(
  entries: Entry[],
  products: Array<Pick<Product, 'id' | 'vat'>> = [],
  allocationEntries: Entry[] = entries,
): VATLedgerRow[] {
  const vatByProduct = new Map(products.map(product => [product.id, product.vat ?? 0]));
  const paymentAllocations = getCreditSalePaymentVATAllocations(allocationEntries);
  return entries
    .filter(entry => entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_inward' || entry.type === 'credit_sale_payment')
    .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)
    .map(entry => {
      if (entry.type === 'credit_sale_payment') {
        const allocation = paymentAllocations.get(entry.id) ?? Math.max(0, entry.allocatedVat ?? 0);
        return {
          entry, kind: entry.type, baseAmount: Math.max(0, entry.amount - allocation),
          vatAmount: allocation, direction: 'allocation',
        };
      }
      const vat = getEntryVAT(entry, vatByProduct.get(entry.productId ?? '') ?? 0);
      const gross = getGrossSaleValue(entry);
      return {
        entry,
        kind: entry.type === 'return_inward' ? 'return_inward' : entry.type === 'credit_sale' ? 'credit_sale' : 'cash_sale',
        baseAmount: Math.max(0, gross - vat),
        vatRate: gross > 0 ? vat / gross : undefined,
        vatAmount: vat,
        direction: entry.type === 'return_inward' ? 'deduction' : 'addition',
      };
    });
}

export function getReturnBaseCost(entry: Pick<Entry, 'baseCostSnapshot' | 'cogsAmount' | 'unitsSold'>, productCost = 0): number {
  return typeof entry.baseCostSnapshot === 'number'
    ? entry.baseCostSnapshot
    : typeof entry.cogsAmount === 'number' && (entry.unitsSold ?? 0) > 0
      ? entry.cogsAmount / (entry.unitsSold ?? 1)
      : productCost;
}

/**
 * Suggested Selling Price = Cost × (1 + markup%), excluding VAT.
 */
export function calcSuggestedPrice(costPrice: number, markupPercent: number): number {
  return costPrice * (1 + markupPercent / 100);
}

/**
 * Format a VAT-exclusive price.
 */
export function fmtVATPrice(price: number): string {
  return `₦${price.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} excl. VAT`;
}

/**
 * Returns true when `enteredPrice` is below the VAT-inclusive suggested price.
 */
export function isBelowVATPrice(enteredPrice: number, costPrice: number, markupPercent: number): boolean {
  return enteredPrice < calcSuggestedPrice(costPrice, markupPercent);
}

export interface OutstandingCredit {
  originalEntry: Entry;
  grossAmount: number;
  paidToDate: number;
  returnCredits: number;
  remainingBalance: number;
  vatPaidToDate: number;
}

function getCreditPurchaseGrossAmount(entry: Entry): number {
  return supplierPurchasePayable(entry);
}

export function getOutstandingCredits(
  entries: Entry[],
  type: 'sale' | 'purchase',
  excludeEntryId?: string,
  includeFullyPaid = false,
): OutstandingCredit[] {
  const originalType = type === 'sale' ? 'credit_sale' : 'credit_purchase';
  const paymentType = type === 'sale' ? 'credit_sale_payment' : 'credit_purchase_payment';
  const payments = entries.filter(e => e.type === paymentType && e.linkedCreditEntryId && e.id !== excludeEntryId);
  const sums = new Map<string, { paid: number; vat: number }>();
  const vatAllocations = type === 'sale'
    ? getCreditSalePaymentVATAllocations(entries.filter(entry => entry.id !== excludeEntryId))
    : undefined;
  payments.forEach(p => {
    const key = `${p.linkedCreditKind === 'expense' ? 'expense' : 'credit'}:${p.linkedCreditEntryId}`;
    const old = sums.get(key) ?? { paid: 0, vat: 0 };
    sums.set(key, {
      paid: old.paid + p.amount,
      vat: old.vat + (vatAllocations?.get(p.id) ?? p.allocatedVat ?? 0),
    });
  });
  return entries.filter(e => e.type === originalType || (type === 'purchase' && e.type === 'expense'
    && e.paymentMode === 'credit' && e.category?.trim().toLowerCase() !== 'depreciation')).map(originalEntry => {
    const key = `${originalEntry.type === 'expense' ? 'expense' : 'credit'}:${originalEntry.id}`;
    const paid = sums.get(key) ?? { paid: 0, vat: 0 };
    const grossAmount = type === 'sale'
      ? getGrossSaleValue(originalEntry)
      : originalEntry.type === 'expense' ? originalEntry.amount : getCreditPurchaseGrossAmount(originalEntry);
    const returnCredits = creditReturnTotal(entries, originalEntry.id, originalEntry.type === 'expense' ? 'expense' : type);
    return { originalEntry, grossAmount, paidToDate: paid.paid, vatPaidToDate: paid.vat, returnCredits,
      remainingBalance: Math.max(0, grossAmount - paid.paid - returnCredits) };
  }).filter(item => includeFullyPaid || item.remainingBalance > 0);
}
