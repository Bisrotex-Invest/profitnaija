import { getMoneyAccountMovements, getEntryPaymentMode } from '@/lib/utils/moneyAccounts';
import type { Entry } from '@/context/EntriesContext';
import {
  validateFinanceRecord, mapStatementRows, reconcileStatements, getOpeningRecord, cents,
  type AssetRecord, type TaxRecord, type StatementRecord, type StatementRow, type StatementColumns, type BankMovement,
} from '@workspace/accounting-core';
import type { SavedFinance } from '@/lib/financeApi';
import { isDirectExpenseEntry } from '@/lib/utils/formulas';

export const today = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
export const fmt = (n: number) => `${n < 0 ? '−' : ''}₦${Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const newFinanceId = () => `financial_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
export const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : 'Something went wrong';
  return /revision|conflict|stale/i.test(m) ? `${m} Reload the latest records and re-check before saving again.` : m;
};
export const num = (v: string) => (v.trim() === '' || !/^-?\d*\.?\d*$/.test(v.trim()) ? NaN : Number(v));

export interface AssetForm { name: string; cost: string; residual: string; life: string; date: string; depStart: string; mode: 'cash' | 'bank' | 'non_cash'; source: string; reference: string; notes: string; dispose: boolean; dDate: string; dProceeds: string; dAccount: 'cash' | 'bank' }
export const emptyAsset = (): AssetForm => ({ name: '', cost: '', residual: '0', life: '60', date: today(), depStart: today(), mode: 'cash', source: '', reference: '', notes: '', dispose: false, dDate: today(), dProceeds: '', dAccount: 'bank' });
export interface TaxForm { taxType: TaxRecord['taxType']; action: TaxRecord['action']; amount: string; date: string; mode: 'cash' | 'bank'; confirmed: boolean; reference: string; notes: string; source: string }
export const emptyTax = (): TaxForm => ({ taxType: 'vat', action: 'charge', amount: '', date: today(), mode: 'bank', confirmed: false, reference: '', notes: '', source: '' });
export interface StatementForm { bankName: string; accountLabel: string; start: string; end: string; opening: string; closing: string; reference: string; notes: string; coverage: boolean }
export const emptyStatement = (): StatementForm => ({ bankName: '', accountLabel: '', start: '', end: '', opening: '', closing: '', reference: '', notes: '', coverage: false });
export interface DraftRow { id: string; date: string; description: string; amount: string; reference: string; matchedEntryId: string }

export function openingDate(entries: Entry[]): string | undefined {
  try { return (getOpeningRecord(entries as any) as { date: string } | undefined)?.date; } catch { return undefined; }
}

export function buildAsset(f: AssetForm, entries: Entry[]): AssetRecord {
  const t = today();
  if (f.date > t) throw new Error('Acquisition date cannot be in the future.');
  if (f.dispose && f.dDate > t) throw new Error('Disposal date cannot be in the future.');
  const open = openingDate(entries);
  if (!f.source && f.mode === 'non_cash' && (!open || f.date > open))
    throw new Error('A non-cash asset acquired after the opening date needs a linked equipment expense. Record the real funding (purchase, owner contribution or loan) first, or choose Cash/Bank.');
  const a: AssetRecord = {
    kind: 'asset', name: f.name.trim(), cost: num(f.cost), residualValue: num(f.residual), usefulLifeMonths: Number(f.life),
    date: f.date, depreciationStart: f.depStart, paymentMode: f.source ? 'non_cash' : f.mode, sourceEntryId: f.source,
    reference: f.reference.trim(), notes: f.notes.trim(),
  };
  if (f.dispose) { a.disposalDate = f.dDate; a.disposalProceeds = num(f.dProceeds); a.disposalAccount = f.dAccount; }
  validateFinanceRecord(a);
  return a;
}
export function buildTax(f: TaxForm): TaxRecord {
  if (f.date > today()) throw new Error('Tax record date cannot be in the future.');
  const linked = f.action === 'payment' && !!f.source;
  const r: TaxRecord = { kind: 'tax', taxType: f.taxType, action: f.action, amount: num(f.amount), date: f.date,
    paymentMode: f.action === 'payment' && !linked ? f.mode : 'non_cash', confirmed: f.confirmed, reference: f.reference.trim(), notes: f.notes.trim() };
  if (linked) r.sourceEntryId = f.source;
  validateFinanceRecord(r);
  return r;
}
export function rowsToRecordRows(rows: DraftRow[]): StatementRow[] {
  return rows.map(r => {
    const out: StatementRow = { id: r.id, date: r.date.trim(), description: r.description, amount: num(r.amount), reference: r.reference };
    if (r.matchedEntryId) out.matchedEntryId = r.matchedEntryId;
    return out;
  });
}
export function buildStatement(f: StatementForm, rows: DraftRow[], outstanding: string[]): StatementRecord {
  const r: StatementRecord = { kind: 'statement', bankName: f.bankName.trim(), accountLabel: f.accountLabel.trim(), startDate: f.start, endDate: f.end,
    openingBalance: num(f.opening), closingBalance: num(f.closing), rows: rowsToRecordRows(rows), outstandingEntryIds: outstanding,
    completeBankCoverage: f.coverage, reference: f.reference.trim(), notes: f.notes.trim() };
  validateFinanceRecord(r);
  return r;
}
export function statementDiff(f: StatementForm, rows: DraftRow[]) {
  const o = num(f.opening), c = num(f.closing);
  if (Number.isNaN(o) || Number.isNaN(c) || rows.some(r => Number.isNaN(num(r.amount)))) return NaN;
  return (cents(o) + rows.reduce((s, r) => s + cents(num(r.amount)), 0) - cents(c)) / 100;
}
export function bankMovements(entries: Entry[]): BankMovement[] {
  return getMoneyAccountMovements(entries).filter(m => m.account === 'bank').map(m => ({
    id: m.entry.id, date: m.entry.date, amount: m.amount,
    description: String((m.entry as { description?: string; productName?: string; category?: string }).description ?? (m.entry as { productName?: string }).productName ?? m.entry.category ?? m.entry.type) + (String(m.entry.id).endsWith(':disposal') ? ' (asset disposal)' : ''),
  }));
}
export { getEntryPaymentMode };
export function mapTable(table: string[][], excluded: Set<number>, cols: StatementColumns) {
  const rows: DraftRow[] = []; const errors: { index: number; message: string }[] = [];
  table.forEach((cells, i) => {
    if (excluded.has(i)) return;
    const res = mapStatementRows([cells], cols);
    if (res.errors.length) errors.push({ index: i, message: res.errors[0]!.replace(/^Row 1: /, '') });
    else { const r = res.rows[0]!; rows.push({ id: `row_${i + 1}`, date: r.date, description: r.description, amount: String(r.amount), reference: r.reference, matchedEntryId: '' }); }
  });
  return { rows, errors };
}
export function groupKey(s: StatementRecord) { return `${s.startDate}|${s.endDate}`; }
export function activeStatements(records: SavedFinance[]) { return records.filter(r => r.ledgerStatus !== 'void' && r.finance.kind === 'statement'); }
export function reconcileGroup(group: StatementRecord[], movements: BankMovement[], bookClosing: number) { return reconcileStatements(group, movements, bookClosing); }
export function fileToBase64(buf: ArrayBuffer) {
  let s = ''; const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function taxSourceCandidates(entries: Entry[], records: SavedFinance[], currentSource = ''): Entry[] {
  const used = new Set<string>();
  records.filter(r => r.ledgerStatus !== 'void').forEach(r => { const id = (r.finance as { sourceEntryId?: string }).sourceEntryId; if (id) used.add(id); });
  return entries.filter(e => {
    if (e.id !== currentSource && used.has(e.id)) return false;
    if (e.type !== 'expense' || e.ledgerStatus === 'void' || !isDirectExpenseEntry(e)) return false;
    if (/depreciation/i.test(`${e.category ?? ''} ${e.itemName ?? ''}`)) return false;
    const m = getEntryPaymentMode(e) as string;
    return m === 'cash' || m === 'bank';
  });
}
