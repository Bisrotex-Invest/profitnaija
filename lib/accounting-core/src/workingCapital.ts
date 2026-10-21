import { cents, validAccountingDate, type OpeningBalances } from './index.ts';
import type { FinanceBase, FinanceRecord } from './finance.ts';

export const WORKING_ACCOUNTS = {
  prepayment: 'Prepayments',
  accrual: 'Accrued expenses',
  unearned_revenue: 'Unearned revenue',
  loan: 'Loans',
} as const;
export type WorkingAccount = keyof typeof WORKING_ACCOUNTS;
export interface WorkingCapitalRecord extends FinanceBase {
  kind: 'working_capital';
  account: WorkingAccount;
  action: 'opening' | 'increase' | 'release' | 'interest';
  amount: number;
  date: string;
  paymentMode: 'cash' | 'bank' | 'non_cash';
  linkedRecordId: string;
  partyName: string;
  loanTerm: 'current' | 'non_current';
}
export interface WorkingEntry {
  id?: string; date?: string; finance?: FinanceRecord; ledgerStatus?: string;
}
export function workingMode(record: Pick<WorkingCapitalRecord, 'account' | 'action'>): 'money' | 'non_cash' {
  if (record.action === 'opening') return 'non_cash';
  if (record.action === 'interest') return 'money';
  return (record.account === 'accrual' ? record.action === 'increase'
    : record.account === 'prepayment' || record.account === 'unearned_revenue' ? record.action === 'release' : false)
    ? 'non_cash' : 'money';
}
export function validateWorkingRecord(r: WorkingCapitalRecord): void {
  if (!(r.account in WORKING_ACCOUNTS) || !['opening','increase','release','interest'].includes(r.action))
    throw new Error('Choose a supported account and action.');
  if (!Number.isFinite(r.amount) || r.amount <= 0 || r.amount > 1e12 || Math.abs(r.amount * 100 - cents(r.amount)) > .001)
    throw new Error('Enter a positive amount with at most two decimals.');
  if (!validAccountingDate(r.date)) throw new Error('Enter a real accounting date.');
  if (!['current','non_current'].includes(r.loanTerm) || !['cash','bank','non_cash'].includes(r.paymentMode))
    throw new Error('Choose a valid term and payment account.');
  if (workingMode(r) === 'non_cash' ? r.paymentMode !== 'non_cash' : r.paymentMode === 'non_cash')
    throw new Error('This action must use its actual Cash/Bank or non-cash treatment.');
  if (r.action === 'interest' && r.account !== 'loan') throw new Error('Interest payments must belong to a loan.');
  if (typeof r.partyName !== 'string' || !r.partyName.trim() || r.partyName.length > 160)
    throw new Error('Enter the counterparty or account description.');
  if (typeof r.linkedRecordId !== 'string' || r.linkedRecordId.length > 160 ||
    (['release','interest'].includes(r.action) ? !r.linkedRecordId : !!r.linkedRecordId))
    throw new Error('Settlements and interest require their original record; new balances cannot link another record.');
}
export function workingRecords(entries: WorkingEntry[]) {
  return entries.filter(e => e.ledgerStatus !== 'void' && e.finance?.kind === 'working_capital')
    .map(e => ({ id: e.id ?? '', record: e.finance as WorkingCapitalRecord }));
}
/** Validate the entire prospective subledger, inside the server's transaction. */
export function validateWorkingLedger(entries: WorkingEntry[], opening?: { date: string; openingBalances?: OpeningBalances }) {
  const records = workingRecords(entries);
  if (!records.length) return;
  if (!opening?.openingBalances) throw new Error('Confirm opening balances before managing these accounts.');
  const openingAmounts = { prepayment: 0, accrual: 0, unearned_revenue: 0, loan: 0 };
  for (const { id, record: r } of records) {
    validateWorkingRecord(r);
    if (r.action === 'opening') {
      if (r.date !== opening.date) throw new Error('An opening classification must use the confirmed opening date.');
      openingAmounts[r.account] += cents(r.amount);
    } else if (r.date <= opening.date) throw new Error('New movements must be after the confirmed opening date.');
    if (r.linkedRecordId) {
      const source = records.find(s => s.id === r.linkedRecordId);
      if (!source || source.id === id || source.record.account !== r.account ||
        !['opening','increase'].includes(source.record.action) || r.date < source.record.date ||
        r.loanTerm !== source.record.loanTerm)
        throw new Error('Choose an active original for the same account and term, dated on or before this movement.');
    }
  }
  const b = opening.openingBalances;
  if (openingAmounts.prepayment > cents(b.otherCurrentAssets) ||
    openingAmounts.accrual + openingAmounts.unearned_revenue > cents(b.otherCurrentLiabilities) ||
    openingAmounts.loan > cents(b.loans))
    throw new Error('Opening classifications exceed the confirmed opening aggregate. Review supporting records; do not create another opening balance.');
  for (const { id, record } of records.filter(s => ['opening','increase'].includes(s.record.action))) {
    const released = records.filter(s => s.record.action === 'release' && s.record.linkedRecordId === id)
      .reduce((sum, s) => sum + cents(s.record.amount), 0);
    if (released > cents(record.amount)) throw new Error('Recognition or settlement exceeds the original remaining balance.');
  }
}
export function workingBalance(entries: WorkingEntry[], id: string, cutoff = '9999-12-31') {
  const records = workingRecords(entries).filter(e => e.record.date <= cutoff);
  const root = records.find(e => e.id === id);
  return root ? (cents(root.record.amount) - records.filter(e => e.record.action === 'release' && e.record.linkedRecordId === id)
    .reduce((sum,e) => sum + cents(e.record.amount), 0)) / 100 : 0;
}
export function workingMoney(r: WorkingCapitalRecord): number {
  if (r.paymentMode === 'non_cash') return 0;
  const incoming = r.action === 'increase' && ['unearned_revenue','loan'].includes(r.account);
  return (incoming ? 1 : -1) * r.amount;
}
export function workingPeriod(entries: WorkingEntry[], start: string, end: string) {
  let revenue = 0, expense = 0, interest = 0, prepayments = 0, accruedPayments = 0,
    advancesReceived = 0, loanReceipts = 0, loanRepayments = 0, interestPaid = 0;
  for (const { record: r } of workingRecords(entries)) {
    if (r.date < start || r.date > end || r.action === 'opening') continue;
    if (r.account === 'unearned_revenue' && r.action === 'release') revenue += r.amount;
    if ((r.account === 'prepayment' && r.action === 'release') || (r.account === 'accrual' && r.action === 'increase')) expense += r.amount;
    if (r.action === 'interest') { interest += r.amount; interestPaid += r.amount; }
    if (r.account === 'prepayment' && r.action === 'increase') prepayments += r.amount;
    if (r.account === 'accrual' && r.action === 'release') accruedPayments += r.amount;
    if (r.account === 'unearned_revenue' && r.action === 'increase') advancesReceived += r.amount;
    if (r.account === 'loan' && r.action === 'increase') loanReceipts += r.amount;
    if (r.account === 'loan' && r.action === 'release') loanRepayments += r.amount;
  }
  const round = (n: number) => cents(n) / 100;
  return { revenue:round(revenue), expense:round(expense), interest:round(interest),
    prepayments:round(prepayments), accruedPayments:round(accruedPayments), advancesReceived:round(advancesReceived),
    loanReceipts:round(loanReceipts), loanRepayments:round(loanRepayments), interestPaid:round(interestPaid),
    operating:round(advancesReceived-prepayments-accruedPayments-interestPaid),
    financing:round(loanReceipts-loanRepayments) };
}
export function workingPosition(entries: WorkingEntry[], cutoff: string) {
  const result = { prepayment:0, accrual:0, unearned_revenue:0, currentLoans:0, nonCurrentLoans:0,
    openingPrepayment:0, openingAccrual:0, openingUnearned:0, openingLoans:0 };
  for (const { id, record:r } of workingRecords(entries)) {
    if (r.date > cutoff || !['opening','increase'].includes(r.action)) continue;
    const balance = workingBalance(entries,id,cutoff);
    if (r.account === 'loan') result[r.loanTerm === 'current' ? 'currentLoans' : 'nonCurrentLoans'] += balance;
    else result[r.account] += balance;
    if (r.action === 'opening') result[r.account === 'prepayment' ? 'openingPrepayment'
      : r.account === 'accrual' ? 'openingAccrual' : r.account === 'loan' ? 'openingLoans' : 'openingUnearned'] += r.amount;
  }
  return Object.fromEntries(Object.entries(result).map(([k,v])=>[k,cents(v)/100])) as typeof result;
}
