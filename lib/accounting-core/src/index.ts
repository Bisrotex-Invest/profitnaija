/** Protocol and arithmetic shared by server, native and web. No storage side effects. */
import { workingPosition } from './workingCapital.ts';
export * from './finance.ts';
export * from './statements.ts';
export * from './position.ts';
export * from './taxLedger.ts';
export * from './creditReturns.ts';
export * from './statementLayout.ts';
export * from './workingCapital.ts';
export * from './supplierPurchase.ts';
export * from './accountingYear.ts';
export * from './statementExport.ts';
export const OPENING_FIELDS = [
  'cash', 'bank', 'inventory', 'debtors', 'otherCurrentAssets', 'fixedAssets',
  'otherNonCurrentAssets', 'creditors', 'vatLiability', 'whtLiability',
  'incomeTaxLiability', 'otherCurrentLiabilities', 'loans', 'capital',
  'retainedEarnings', 'drawings', 'otherEquity',
] as const;
export type OpeningField = typeof OPENING_FIELDS[number];
export type OpeningBalances = Record<OpeningField, number>;
export type AccountingType = 'opening_balance' | 'owner_contribution' | 'owner_drawings' | 'financial_record';
export interface OpeningPayload {
  date: string;
  balances: OpeningBalances;
  reference: string;
  notes: string;
  confirmed: true;
  expectedRevision: number;
}
export interface OwnerPayload {
  kind: 'contribution' | 'drawings';
  account: 'cash' | 'bank';
  amount: number;
  date: string;
  ownerName: string;
  reference: string;
  notes: string;
  requestId: string;
  expectedRevision?: number;
}
export interface AccountingRecord {
  id: string;
  type: AccountingType;
  amount: number;
  date: string;
  category: string;
  notes: string;
  createdAt: number;
  openingBalances?: OpeningBalances;
  paymentMode?: 'cash' | 'bank' | 'non_cash';
  ownerName?: string;
  reference: string;
  ledgerRevision: number;
  ledgerStatus: 'active' | 'void';
  confirmed?: boolean;
  history?: unknown[];
  finance?: import('./finance').FinanceRecord;
}
export function cents(value: number): number { return Math.round(value * 100); }
export function validAccountingDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function openingTotals(b: OpeningBalances) {
  const sum = (keys: OpeningField[]) => keys.reduce((n, key) => n + cents(b[key]), 0);
  const assets = sum(['cash', 'bank', 'inventory', 'debtors', 'otherCurrentAssets', 'fixedAssets', 'otherNonCurrentAssets']);
  const liabilities = sum(['creditors', 'vatLiability', 'whtLiability', 'incomeTaxLiability', 'otherCurrentLiabilities', 'loans']);
  const equity = sum(['capital', 'retainedEarnings', 'otherEquity']) - cents(b.drawings);
  return { assets: assets / 100, liabilities: liabilities / 100, equity: equity / 100, difference: (assets - liabilities - equity) / 100 };
}
function text(value: unknown, label: string, required = false, max = 1000) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new Error(`${label} ${required ? 'is required and' : ''} must be text up to ${max} characters.`);
  }
}
function monetary(value: unknown, label: string, signed = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000
    || (!signed && value < 0) || Math.abs(value * 100 - Math.round(value * 100)) > 0.001) {
    throw new Error(`${label} must be a ${signed ? 'finite' : 'non-negative'} amount with at most two decimals.`);
  }
}
export function validateOpeningPayload(p: OpeningPayload): void {
  if (!p || !validAccountingDate(p.date)) throw new Error('Choose a valid opening date.');
  if (!p.balances || typeof p.balances !== 'object') throw new Error('Enter all opening balances, including confirmed zeros.');
  for (const field of OPENING_FIELDS) monetary(p.balances[field], field, ['bank', 'retainedEarnings', 'otherEquity'].includes(field));
  if (openingTotals(p.balances).difference !== 0) throw new Error('Opening assets must equal liabilities plus equity. Check supporting records; do not invent capital to balance.');
  if (p.confirmed !== true) throw new Error('Confirm that all opening balances were checked against supporting records.');
  text(p.reference, 'Supporting reference', true, 200);
  text(p.notes, 'Notes');
  if (!Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 0) throw new Error('Invalid opening revision. Refresh and retry.');
}
export function validateOwnerPayload(p: OwnerPayload, openingDate?: string): void {
  if (!p || !['contribution', 'drawings'].includes(p.kind)) throw new Error('Choose owner contribution or drawings.');
  if (!['cash', 'bank'].includes(p.account)) throw new Error('Choose Cash or Bank.');
  monetary(p.amount, 'Amount');
  if (p.amount <= 0) throw new Error('Enter an amount greater than zero.');
  if (!validAccountingDate(p.date)) throw new Error('Choose a valid movement date.');
  if (openingDate && p.date <= openingDate) throw new Error('Owner movements must be after the opening date; include earlier movements in the opening balances.');
  text(p.ownerName, 'Owner name', true, 120);
  text(p.reference, 'Supporting reference', true, 200);
  text(p.notes, 'Notes');
  if (typeof p.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(p.requestId)) throw new Error('Invalid request identifier.');
  if (p.expectedRevision !== undefined && (!Number.isSafeInteger(p.expectedRevision) || p.expectedRevision < 1)) throw new Error('Invalid movement revision. Refresh and retry.');
}
export function isAccountingEntry(entry: { type: string }): boolean {
  return ['opening_balance', 'owner_contribution', 'owner_drawings', 'financial_record'].includes(entry.type);
}
/** An opening snapshot closes that date, so subsequent activity starts next day. */
export function getOpeningRecord<T extends { type: string; date: string; openingBalances?: OpeningBalances; ledgerStatus?: string; reference?: string; confirmed?: boolean }>(entries: T[], cutoff?: string): T | undefined {
  const records = entries.filter(e => e.type === 'opening_balance' && e.ledgerStatus !== 'void' && (!cutoff || e.date <= cutoff));
  if (records.length > 1) throw new Error('Multiple opening snapshots are active. Review the accounting ledger.');
  const record = records[0];
  if (record) validateOpeningPayload({
    date: record.date, balances: record.openingBalances!, reference: record.reference ?? '',
    notes: '', confirmed: record.confirmed as true, expectedRevision: 0,
  });
  return record;
}

export interface PositionRow {
  key: string; label: string; value: number | null;
  section?: boolean; total?: boolean; grandTotal?: boolean;
}
/** Opening equity is documented, not inferred from a residual in legacy data. */
export function applyOpeningPosition<T extends {
  rows: PositionRow[]; warnings: string[]; cash: number; bank: number;
  inventory: number; debtors: number; creditors: number;
  recordedAssets: number; recordedLiabilities: number; netRecordedAssets: number;
}>(base: T, entries: Array<{
  id?: string;
  type: string; date: string; amount: number; category?: string;
  openingBalances?: OpeningBalances; ledgerStatus?: string; reference?: string; confirmed?: boolean;
  finance?: import('./finance').FinanceRecord;
}>, cutoff: string, subledgerAtOpening: { inventory: number; debtors: number; creditors: number },
closing?: { profit: number; vat: number; wht: number; incomeTax: number; fixedAssets: number | null; assetsSupported: boolean }): T {
  const opening = getOpeningRecord(entries, cutoff);
  if (!opening?.openingBalances) return base;
  const b = opening.openingBalances;
  const working = workingPosition(entries, cutoff);
  const otherAssets = b.otherCurrentAssets - working.openingPrepayment;
  validateOpeningPayload({ date: opening.date, balances: b, reference: opening.reference ?? '', notes: '', confirmed: true, expectedRevision: 0 });
  const later = entries.filter(e => e.ledgerStatus !== 'void' && e.date > opening.date && e.date <= cutoff);
  const contributions = later.filter(e => e.type === 'owner_contribution').reduce((n, e) => n + cents(e.amount), 0) / 100;
  const drawings = b.drawings + later.filter(e => e.type === 'owner_drawings').reduce((n, e) => n + cents(e.amount), 0) / 100;
  const capital = b.capital + contributions;
  const commerce = later.some(e => !isAccountingEntry(e));
  const assetMovement = later.some(e => e.category?.trim().toLowerCase() === 'equipment' || e.category?.trim().toLowerCase() === 'depreciation');
  const matches = (['inventory', 'debtors', 'creditors'] as const)
    .every(key => cents(subledgerAtOpening[key]) === cents(b[key]));
  const retainedEarnings = closing ? (matches && closing.assetsSupported ? Math.round((b.retainedEarnings+closing.profit)*100)/100 : null) : !commerce && matches ? b.retainedEarnings : null;
  const fixedAssets = closing ? closing.fixedAssets : assetMovement ? null : b.fixedAssets;
  const vat = closing ? Math.max(0,closing.vat) : commerce ? null : b.vatLiability;
  const wht = closing ? Math.max(0,closing.wht) : commerce ? null : b.whtLiability;
  const incomeTax = closing ? Math.max(0,closing.incomeTax) : commerce ? null : b.incomeTaxLiability;
  const taxReceivables = closing ? Math.max(0,-closing.vat)+Math.max(0,-closing.wht)+Math.max(0,-closing.incomeTax) : 0;
  const totalEquity = retainedEarnings === null ? null : Math.round((capital + retainedEarnings + b.otherEquity - drawings) * 100) / 100;
  const recordedAssets = Math.round((base.cash + base.bank + base.inventory + base.debtors
    + otherAssets + working.prepayment + taxReceivables + (fixedAssets ?? 0) + b.otherNonCurrentAssets) * 100) / 100;
  const otherLiabilities = b.otherCurrentLiabilities - working.openingAccrual - working.openingUnearned;
  const unclassifiedLoans = b.loans - working.openingLoans;
  const loans = unclassifiedLoans + working.currentLoans + working.nonCurrentLoans;
  const recordedLiabilities = Math.round((base.creditors + (vat ?? 0) + (wht ?? 0) + (incomeTax ?? 0)
    + otherLiabilities + working.accrual + working.unearned_revenue + loans) * 100) / 100;
  const values: Record<string, number | null> = {
    'other-current-assets': otherAssets+taxReceivables, 'property-plant-equipment': fixedAssets,
    'other-non-current-assets': b.otherNonCurrentAssets, 'recorded-assets': recordedAssets,
    vat, 'withholding-tax': wht, 'income-tax': incomeTax,
    'other-current-liabilities': otherLiabilities, loans: working.nonCurrentLoans,
    'total-creditors': Math.round((base.creditors + otherLiabilities + working.accrual + working.unearned_revenue + loans) * 100) / 100,
    'recorded-liabilities': recordedLiabilities, 'net-recorded-assets': recordedAssets - recordedLiabilities,
    capital, 'retained-earnings': retainedEarnings, 'other-equity': b.otherEquity,
    'total-equity': totalEquity,
    'total-liabilities-equity': totalEquity === null || !matches ? null : recordedLiabilities + totalEquity,
  };
  const rows = base.rows.map(row => ({
    ...row,
    ...(Object.prototype.hasOwnProperty.call(values, row.key) ? { value: values[row.key] } : {}),
    ...(row.key === 'other-equity' ? { label: 'Other equity — confirmed opening' } : {}),
    ...(row.key === 'total-liabilities-equity' && values[row.key] !== null ? { label: 'Total recorded liabilities and equity' } : {}),
  }));
  rows.splice(rows.findIndex(row=>row.key==='other-current-assets'),0,
    {key:'prepayments',label:'Prepayments — recorded',value:working.prepayment});
  rows.splice(rows.findIndex(row=>row.key==='other-current-liabilities'),0,
    {key:'accrued-expenses',label:'Accrued expenses — recorded',value:working.accrual},
    {key:'unearned-revenue',label:'Unearned revenue — recorded',value:working.unearned_revenue},
    {key:'current-loans',label:'Current loan principal — recorded',value:working.currentLoans},
    {key:'unclassified-loans',label:'Loans — unclassified opening balance',value:unclassifiedLoans});
  rows.splice(rows.findIndex(row=>row.key==='retained-earnings') + 1, 0,
    { key: 'opening-retained-earnings', label: 'Confirmed opening retained earnings / losses (reference only)', value: b.retainedEarnings },
    { key: 'owner-drawings', label: 'Less: owner drawings', value: -drawings });
  const warnings = base.warnings.filter((_, i) => ![1, 2, 3].includes(i));
  warnings.push(`Opening balances were confirmed by the account owner as at ${opening.date} (reference: ${opening.reference}). Cash and Bank start from those amounts; earlier transactions remain stored but are not counted again in money balances. This is not independent bank reconciliation.`);
  warnings.push('Owner contributions increase Cash/Bank and contributed capital; drawings reduce Cash/Bank and equity. Neither is revenue, an expense or a VAT transaction. Owner loans and company dividends are not posted by this feature.');
  warnings.push('Prepayments, accrued expenses, unearned revenue and loan principal use their source registers. Unclassified opening balances remain separate; no historical split or missing movement is inferred.');
  if(closing) {
    warnings.push('Retained earnings rolls forward recorded profit, registered depreciation and confirmed tax charges/credits; estimated PIT is excluded. Tax balances are recorded control-account balances, not proof that every statutory assessment has been posted.');
    warnings.push('Recorded supplier VAT is carried in the input-VAT control account. Confirm legal recoverability and record any assessed adjustments; these figures are not a tax filing or a statutory certification.');
    if(!closing.assetsSupported)warnings.push('Register existing equipment acquisitions and reconcile registered opening assets before closing retained earnings and asset carrying values can be confirmed.');
    if(totalEquity!==null && Math.round((recordedAssets-recordedLiabilities-totalEquity)*100)!==0)warnings.push(`Recorded assets and liabilities/equity differ by ₦${((recordedAssets-recordedLiabilities-totalEquity)).toFixed(2)}. Review missing movements or classifications; no balancing adjustment was invented.`);
  } else if (commerce) warnings.push('Business activity exists after the opening date. Closing retained earnings and tax liabilities remain Not available until recognized profit, tax settlements and closing adjustments are established; opening retained earnings is shown separately, not treated as closing profit.');
  if (!matches) warnings.push('The opening Inventory, Debtors or Creditors no longer matches its source register at that date. Review historical corrections and reconfirm the opening snapshot; total liabilities and equity is not presented as reconciled.');
  return { ...base, rows, warnings, recordedAssets, recordedLiabilities, netRecordedAssets: Math.round((recordedAssets - recordedLiabilities) * 100) / 100 };
}
