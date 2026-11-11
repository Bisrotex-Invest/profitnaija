import { cents, validAccountingDate, type OpeningBalances } from './index.ts';
import { getAgeingDays } from './ageing.ts';
import type { FinanceBase, FinanceRecord } from './finance.ts';

export const WORKING_ACCOUNTS = {
  prepayment: 'Prepayments',
  accrual: 'Accrued expenses',
  unearned_revenue: 'Unearned revenue',
  loan: 'Loans',
  lease: 'Lease liabilities',
} as const;
export type WorkingAccount = keyof typeof WORKING_ACCOUNTS;
export type WorkingAgeBand = '0-30' | '31-60' | '61-90' | 'over-90';
export interface WorkingAgeingSummary {
  total: number;
  buckets: Record<WorkingAgeBand, number>;
}
export type WorkingAgeingByAccount = Record<WorkingAccount, WorkingAgeingSummary>;
export const WORKING_AGE_BANDS: { key: WorkingAgeBand; label: string }[] = [
  { key: '0-30', label: '0–30 days' },
  { key: '31-60', label: '31–60 days' },
  { key: '61-90', label: '61–90 days' },
  { key: 'over-90', label: 'Over 90 days' },
];
export type WorkingRegisterFilter = 'all' | WorkingAccount;
export const WORKING_REGISTER_FILTERS: [WorkingRegisterFilter, string][] = [
  ['all', 'All'],
  ['prepayment', 'Prepayments'],
  ['accrual', 'Accrued expenses'],
  ['unearned_revenue', 'Customer advances'],
  ['loan', 'Loans'],
  ['lease', 'Leases'],
];
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
  /** Required only for a newly recognized right-of-use asset. */
  leaseTermMonths?: number;
  /** Fixed-payment lease terms used to calculate the initial present value and amortization. */
  leasePaymentAmount?: number;
  leaseAnnualRate?: number;
  /** One-based scheduled monthly installment, only on a lease payment. */
  leasePaymentNumber?: number;
}
export interface WorkingEntry {
  id?: string; date?: string; finance?: FinanceRecord; ledgerStatus?: string;
}
export function workingMode(record: Pick<WorkingCapitalRecord, 'account' | 'action'>): 'money' | 'non_cash' {
  if (record.action === 'opening') return 'non_cash';
  if (record.action === 'interest') return 'money';
  return (record.account === 'accrual' ? record.action === 'increase'
    : record.account === 'prepayment' || record.account === 'unearned_revenue' ? record.action === 'release'
      : record.account === 'lease' ? record.action === 'increase' : false)
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
  if (r.account === 'lease') {
    if (r.action === 'opening') throw new Error('Lease openings must be included in the confirmed opening balances.');
    if (r.action === 'increase') {
      if (!Number.isSafeInteger(r.leaseTermMonths) || r.leaseTermMonths! < 1 || r.leaseTermMonths! > 1200)
        throw new Error('Enter a lease term of 1–1200 months.');
      if (typeof r.leasePaymentAmount !== 'number' || r.leasePaymentAmount <= 0 ||
        typeof r.leaseAnnualRate !== 'number' || !Number.isFinite(r.leaseAnnualRate) || r.leaseAnnualRate < 0 || r.leaseAnnualRate > 100)
        throw new Error('Enter a positive monthly payment and an annual discount rate from 0% to 100%.');
      if (cents(leasePresentValue(r.leasePaymentAmount, r.leaseTermMonths!, r.leaseAnnualRate)) !== cents(r.amount))
        throw new Error('The initial liability must equal the present value of the fixed monthly lease payments.');
    } else if (r.leaseTermMonths !== undefined || r.leasePaymentAmount !== undefined || r.leaseAnnualRate !== undefined) {
      throw new Error('Lease terms can only be entered at commencement.');
    }
    if (r.action === 'release' && (!Number.isSafeInteger(r.leasePaymentNumber) || r.leasePaymentNumber! < 1 || r.leasePaymentNumber! > 1200))
      throw new Error('Choose a valid scheduled lease payment.');
    if (r.action !== 'release' && r.leasePaymentNumber !== undefined)
      throw new Error('Only a lease payment can have an installment number.');
  }
  if (workingMode(r) === 'non_cash' ? r.paymentMode !== 'non_cash' : r.paymentMode === 'non_cash')
    throw new Error('This action must use its actual Cash/Bank or non-cash treatment.');
  if (r.action === 'interest' && r.account !== 'loan') throw new Error('Interest payments must belong to a loan. Lease interest is calculated from its payment schedule.');
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
function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d.toISOString().slice(0, 10);
}
export function leaseMonthlyRate(annualRate: number) {
  return Math.pow(1 + annualRate / 100, 1 / 12) - 1;
}
export function leasePresentValue(payment: number, months: number, annualRate: number) {
  if (annualRate === 0) return cents(payment * months) / 100;
  const rate = leaseMonthlyRate(annualRate);
  return cents(payment * (1 - Math.pow(1 + rate, -months)) / rate) / 100;
}
export interface LeaseInstallment {
  number: number; dueDate: string; payment: number; interest: number; principal: number; closingBalance: number;
}
export function leaseSchedule(record: WorkingCapitalRecord): LeaseInstallment[] {
  if (record.account !== 'lease' || record.action !== 'increase' || !record.leaseTermMonths ||
    typeof record.leasePaymentAmount !== 'number' || typeof record.leaseAnnualRate !== 'number') return [];
  const rate = leaseMonthlyRate(record.leaseAnnualRate);
  let balance = cents(record.amount) / 100;
  const schedule: LeaseInstallment[] = [];
  for (let n = 1; n <= record.leaseTermMonths; n++) {
    const interest = cents(balance * rate) / 100;
    const principal = n === record.leaseTermMonths
      ? balance
      : Math.min(balance, cents(record.leasePaymentAmount - interest) / 100);
    const payment = cents(principal + interest) / 100;
    balance = Math.max(0, cents(balance - principal) / 100);
    schedule.push({ number: n, dueDate: addMonths(record.date, n), payment, interest, principal, closingBalance: balance });
  }
  return schedule;
}
export function leasePaymentSplit(entries: WorkingEntry[], paymentId: string) {
  const payment = workingRecords(entries).find(item => item.id === paymentId)?.record;
  if (!payment || payment.account !== 'lease' || payment.action !== 'release') return null;
  const root = workingRecords(entries).find(item => item.id === payment.linkedRecordId)?.record;
  const installment = root && leaseSchedule(root).find(row => row.number === payment.leasePaymentNumber);
  return installment ? { principal: installment.principal, interest: installment.interest, installment } : null;
}
export function nextLeaseInstallment(entries: WorkingEntry[], leaseId: string, excludePaymentId = '') {
  const root = workingRecords(entries).find(item => item.id === leaseId)?.record;
  if (!root || root.account !== 'lease' || root.action !== 'increase') return null;
  const used = new Set(workingRecords(entries).filter(item => item.id !== excludePaymentId && item.record.account === 'lease'
    && item.record.action === 'release' && item.record.linkedRecordId === leaseId)
    .map(item => item.record.leasePaymentNumber));
  return leaseSchedule(root).find(item => !used.has(item.number)) ?? null;
}
export function leaseLiabilitySplit(entries: WorkingEntry[], leaseId: string, cutoff: string) {
  const root = workingRecords(entries).find(item => item.id === leaseId)?.record;
  if (!root || root.account !== 'lease' || root.action !== 'increase' || root.date > cutoff)
    return { current: 0, nonCurrent: 0 };
  const balance = workingBalance(entries, leaseId, cutoff);
  const paid = new Set(workingRecords(entries).filter(item => item.record.account === 'lease'
    && item.record.action === 'release' && item.record.linkedRecordId === leaseId && item.record.date <= cutoff)
    .map(item => item.record.leasePaymentNumber));
  const nonCurrent = leaseSchedule(root).filter(item => item.dueDate > addMonths(cutoff, 12) && !paid.has(item.number))
    .reduce((sum, item) => sum + item.principal, 0);
  return { current: Math.max(0, cents(balance - nonCurrent) / 100), nonCurrent: cents(nonCurrent) / 100 };
}
/** Validate the entire prospective subledger, inside the server's transaction. */
export function validateWorkingLedger(entries: WorkingEntry[], opening?: { date: string; openingBalances?: OpeningBalances }) {
  const records = workingRecords(entries);
  if (!records.length) return;
  if (!opening?.openingBalances) throw new Error('Confirm opening balances before managing these accounts.');
  const openingAmounts = { prepayment: 0, accrual: 0, unearned_revenue: 0, loan: 0, lease: 0 };
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
      if (r.account === 'lease' && r.action === 'release') {
        const schedule = leaseSchedule(source.record);
        const due = schedule.find(item => item.number === r.leasePaymentNumber);
        if (!due || r.date !== due.dueDate || cents(r.amount) !== cents(due.payment))
          throw new Error('Record the scheduled lease payment amount on its due date.');
        if (records.some(item => item.id !== id && item.record.account === 'lease' && item.record.action === 'release'
          && item.record.linkedRecordId === r.linkedRecordId && item.record.leasePaymentNumber === r.leasePaymentNumber))
          throw new Error('That lease installment has already been recorded.');
        if (schedule.slice(0, r.leasePaymentNumber! - 1).some(item => !records.some(payment =>
          payment.record.account === 'lease' && payment.record.action === 'release' &&
          payment.record.linkedRecordId === r.linkedRecordId && payment.record.leasePaymentNumber === item.number)))
          throw new Error('Record lease installments in order without skipping a scheduled payment.');
      }
    }
  }
  const b = opening.openingBalances;
  if (openingAmounts.prepayment > cents(b.otherCurrentAssets) ||
    openingAmounts.accrual + openingAmounts.unearned_revenue > cents(b.otherCurrentLiabilities) ||
    openingAmounts.loan > cents(b.loans))
    throw new Error('Opening classifications exceed the confirmed opening aggregate. Review supporting records; do not create another opening balance.');
  for (const { id, record } of records.filter(s => ['opening','increase'].includes(s.record.action))) {
    const released = records.filter(s => s.record.action === 'release' && s.record.linkedRecordId === id)
      .reduce((sum, s) => sum + cents(s.record.account === 'lease'
        ? leasePaymentSplit(entries, s.id)?.principal ?? 0 : s.record.amount), 0);
    if (released > cents(record.amount)) throw new Error('Recognition or settlement exceeds the original remaining balance.');
  }
}
export function workingBalance(entries: WorkingEntry[], id: string, cutoff = '9999-12-31') {
  const records = workingRecords(entries).filter(e => e.record.date <= cutoff);
  const root = records.find(e => e.id === id);
  return root ? (cents(root.record.amount) - records.filter(e => e.record.action === 'release' && e.record.linkedRecordId === id)
    .reduce((sum,e) => sum + cents(root.record.account === 'lease'
      ? leasePaymentSplit(entries, e.id)?.principal ?? 0 : e.record.amount), 0)) / 100 : 0;
}
export function workingMoney(r: WorkingCapitalRecord): number {
  if (r.paymentMode === 'non_cash') return 0;
  const incoming = r.action === 'increase' && ['unearned_revenue','loan'].includes(r.account);
  return (incoming ? 1 : -1) * r.amount;
}
export function workingPeriod(entries: WorkingEntry[], start: string, end: string) {
  let revenue = 0, expense = 0, interest = 0, prepayments = 0, accruedPayments = 0,
    advancesReceived = 0, loanReceipts = 0, loanRepayments = 0, leaseRepayments = 0, interestPaid = 0;
  for (const { id, record: r } of workingRecords(entries)) {
    if (r.date < start || r.date > end || r.action === 'opening') continue;
    if (r.account === 'unearned_revenue' && r.action === 'release') revenue += r.amount;
    if ((r.account === 'prepayment' && r.action === 'release') || (r.account === 'accrual' && r.action === 'increase')) expense += r.amount;
    if (r.action === 'interest') { interest += r.amount; interestPaid += r.amount; }
    if (r.account === 'prepayment' && r.action === 'increase') prepayments += r.amount;
    if (r.account === 'accrual' && r.action === 'release') accruedPayments += r.amount;
    if (r.account === 'unearned_revenue' && r.action === 'increase') advancesReceived += r.amount;
    if (r.account === 'loan' && r.action === 'increase') loanReceipts += r.amount;
    if (r.account === 'loan' && r.action === 'release') loanRepayments += r.amount;
    if (r.account === 'lease' && r.action === 'release') {
      const split = leasePaymentSplit(entries, id);
      if (split) { leaseRepayments += split.principal; interest += split.interest; interestPaid += split.interest; }
    }
  }
  const round = (n: number) => cents(n) / 100;
  return { revenue:round(revenue), expense:round(expense), interest:round(interest),
    prepayments:round(prepayments), accruedPayments:round(accruedPayments), advancesReceived:round(advancesReceived),
     loanReceipts:round(loanReceipts), loanRepayments:round(loanRepayments), leaseRepayments:round(leaseRepayments), interestPaid:round(interestPaid),
    operating:round(advancesReceived-prepayments-accruedPayments-interestPaid),
     financing:round(loanReceipts-loanRepayments-leaseRepayments) };
}
export function workingPosition(entries: WorkingEntry[], cutoff: string) {
  const result = { prepayment:0, accrual:0, unearned_revenue:0, currentLoans:0, nonCurrentLoans:0,
    currentLeases:0, nonCurrentLeases:0,
    openingPrepayment:0, openingAccrual:0, openingUnearned:0, openingLoans:0 };
  for (const { id, record:r } of workingRecords(entries)) {
    if (r.date > cutoff || !['opening','increase'].includes(r.action)) continue;
    const balance = workingBalance(entries,id,cutoff);
    if (r.account === 'loan') result[r.loanTerm === 'current' ? 'currentLoans' : 'nonCurrentLoans'] += balance;
    else if (r.account === 'lease') {
      const split = leaseLiabilitySplit(entries, id, cutoff);
      result.currentLeases += split.current;
      result.nonCurrentLeases += split.nonCurrent;
    }
    else result[r.account] += balance;
    if (r.action === 'opening') result[r.account === 'prepayment' ? 'openingPrepayment'
      : r.account === 'accrual' ? 'openingAccrual' : r.account === 'loan' ? 'openingLoans' : 'openingUnearned'] += r.amount;
  }
  return Object.fromEntries(Object.entries(result).map(([k,v])=>[k,cents(v)/100])) as typeof result;
}

/** Ages each outstanding original balance from its record date, without netting different account types. */
export function workingAgeing(entries: WorkingEntry[], asOfDate: string): WorkingAgeingByAccount {
  const result = Object.fromEntries(Object.keys(WORKING_ACCOUNTS).map(account => [account, {
    total: 0,
    buckets: { '0-30': 0, '31-60': 0, '61-90': 0, 'over-90': 0 },
  }])) as WorkingAgeingByAccount;
  for (const { id, record } of workingRecords(entries)) {
    if (!['opening', 'increase'].includes(record.action) || record.date > asOfDate) continue;
    const remaining = workingBalance(entries, id, asOfDate);
    if (remaining <= 0) continue;
    const age = getAgeingDays(record.date, asOfDate);
    if (age === null) continue;
    const band: WorkingAgeBand = age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : 'over-90';
    const summary = result[record.account];
    summary.total = cents(summary.total + remaining) / 100;
    summary.buckets[band] = cents(summary.buckets[band] + remaining) / 100;
  }
  return result;
}
