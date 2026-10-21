import type { Entry, Product } from '@/context/EntriesContext';
import { balanceSheetLayout } from '@workspace/accounting-core';
import { calcInventoryValueAsOf, getOutstandingCredits, buildPnLReport, getEntryVAT } from './formulas.ts';
import { calcMoneyAccountBalances } from './moneyAccounts.ts';
import { applyOpeningPosition, getOpeningRecord, closingSupport, dayAfter } from '@workspace/accounting-core';

export interface BalanceSheetRow {
  key: string;
  label: string;
  value: number | null;
  section?: boolean;
  total?: boolean;
  grandTotal?: boolean;
}

export interface BalanceSheetData {
  asOfDate: string;
  cash: number;
  bank: number;
  inventory: number;
  debtors: number;
  creditors: number;
  recordedAssets: number;
  recordedLiabilities: number;
  netRecordedAssets: number;
  rows: BalanceSheetRow[];
  warnings: string[];
}

function money(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error('The Balance Sheet contains an invalid recorded amount. Review the source transactions.');
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Read-only, cumulative position; never invent missing balances or equity. */
export function buildBalanceSheet(entries: Entry[], products: Product[], asOfDate: string): BalanceSheetData {
  const parsedDate = new Date(`${asOfDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !Number.isFinite(parsedDate.getTime())
    || parsedDate.toISOString().slice(0, 10) !== asOfDate) {
    throw new Error('Choose a valid Balance Sheet date.');
  }

  const historical = entries.filter(entry => entry.date <= asOfDate);
  if (historical.some(entry => typeof entry.amount !== 'number' || !Number.isFinite(entry.amount))) {
    throw new Error('The Balance Sheet contains an invalid recorded amount. Review the source transactions.');
  }
  const accounts = calcMoneyAccountBalances(entries, asOfDate);
  const cash = money(accounts.cash);
  const bank = money(accounts.bank);
  // Include later movements so historical valuation reverses the live stock.
  const inventory = money(calcInventoryValueAsOf(products, entries, asOfDate));
  const debtors = money(getOutstandingCredits(historical, 'sale')
    .reduce((sum, credit) => sum + credit.remainingBalance, 0));
  const creditors = money(getOutstandingCredits(historical, 'purchase')
    .reduce((sum, credit) => sum + credit.remainingBalance, 0));
  const recordedAssets = money(cash + bank + inventory + debtors);
  const recordedLiabilities = creditors;
  const netRecordedAssets = money(recordedAssets - recordedLiabilities);

  const warnings = [
    'Provisional statement of financial position from recorded merchant data only; not a complete, reconciled or IFRS-compliant balance sheet.',
    'Cash and Bank are recorded movements from a zero starting point, not verified bank balances. Missing historical payment modes are assumed Cash, except credit and non-cash entries.',
    'Opening balances, equipment carrying values, other assets, loans and equity have not been established. Not available means unknown, not zero.',
    'VAT, withholding tax and income-tax liabilities cannot be established from accrual totals alone: input tax, remittances and taxpayer records are incomplete. They are excluded from recorded-liability totals, not assumed absent.',
    'Inventory uses the current recorded valuation method. Historical stock adjustments, net-realisable-value write-downs and customer credit-loss allowances are not fully represented.',
    'Unreviewed returns retain money-settlement treatment. Reviewed return credits reduce the linked Debtors or Creditors without moving Cash/Bank.',
    'Net recorded assets is known recorded assets less known recorded liabilities. It is not verified owner capital, retained earnings or total equity.',
    'ProfitNaija subscriptions and partner/platform earnings are not included in these merchant balances.',
  ];
  if (cash < 0 || bank < 0) {
    warnings.push('A recorded money balance is negative. It is preserved, not hidden or converted into an assumed loan; reconcile opening balances and assess overdraft classification.');
  }

  const rows: BalanceSheetRow[] = [
    { key: 'assets', label: 'Assets', value: null, section: true },
    { key: 'cash', label: 'Cash in hand — recorded', value: cash },
    { key: 'bank', label: 'Bank — recorded', value: bank },
    { key: 'inventory', label: 'Inventory — recorded carrying value', value: inventory },
    { key: 'debtors', label: 'Trade receivables (Debtors) — recorded', value: debtors },
    { key: 'other-current-assets', label: 'Other current assets', value: null },
    { key: 'property-plant-equipment', label: 'Property, plant and equipment — net carrying value', value: null },
    { key: 'other-non-current-assets', label: 'Other non-current assets', value: null },
    { key: 'recorded-assets', label: 'Total recorded assets (known items only)', value: recordedAssets, total: true },
    { key: 'liabilities', label: 'Liabilities', value: null, section: true },
    { key: 'creditors', label: 'Supplier and expense creditors — recorded', value: creditors },
    { key: 'vat', label: 'VAT liability', value: null },
    { key: 'withholding-tax', label: 'Withholding tax liability', value: null },
    { key: 'income-tax', label: 'Income tax liability', value: null },
    { key: 'other-current-liabilities', label: 'Other creditors / current payables', value: null },
    { key: 'loans', label: 'Loans / other non-current obligations', value: null },
    { key: 'total-creditors', label: 'Total creditors and borrowings (excluding tax)', value: null, total: true },
    { key: 'recorded-liabilities', label: 'Total recorded liabilities (known items only)', value: recordedLiabilities, total: true },
    { key: 'net-recorded-assets', label: 'Net recorded assets before missing balances (not equity)', value: netRecordedAssets, total: true },
    { key: 'equity', label: 'Equity', value: null, section: true },
    { key: 'capital', label: 'Owner capital / contributed equity', value: null },
    { key: 'retained-earnings', label: 'Retained earnings / accumulated losses', value: null },
    { key: 'other-equity', label: 'Drawings and other equity movements', value: null },
    { key: 'total-equity', label: 'Total equity', value: null, total: true },
    { key: 'total-liabilities-equity', label: 'Total liabilities and equity — not yet verifiable', value: null, grandTotal: true },
  ];

  const base = { asOfDate, cash, bank, inventory, debtors, creditors, recordedAssets, recordedLiabilities, netRecordedAssets, rows, warnings };
  const opening = getOpeningRecord(entries, asOfDate);
  if (!opening) return { ...base, rows: balanceSheetLayout(base.rows) };
  const openingHistory = entries.filter(entry => entry.date <= opening.date);
  const later=entries.filter(e=>e.ledgerStatus!=='void'&&e.date>opening.date&&e.date<=asOfDate);
  const pnl=buildPnLReport(entries,later,products,asOfDate,dayAfter(opening.date));
  const salesVAT=later.reduce((sum,e)=>sum+(['sale','credit_sale'].includes(e.type)?getEntryVAT(e):e.type==='return_inward'?-getEntryVAT(e):0),0);
  const result = applyOpeningPosition(base, entries, asOfDate, {
    inventory: money(calcInventoryValueAsOf(products, entries, opening.date)),
    debtors: money(getOutstandingCredits(openingHistory, 'sale').reduce((sum, credit) => sum + credit.remainingBalance, 0)),
    creditors: money(getOutstandingCredits(openingHistory, 'purchase').reduce((sum, credit) => sum + credit.remainingBalance, 0)),
  },closingSupport(entries,opening,asOfDate,pnl.profitAfterTax,salesVAT));
  return { ...result, rows: balanceSheetLayout(result.rows) };
}
