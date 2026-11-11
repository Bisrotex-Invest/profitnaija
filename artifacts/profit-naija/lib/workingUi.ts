import { validateFinanceRecord, workingBalance, workingMode, workingRecords, leasePresentValue, leasePaymentSplit, nextLeaseInstallment, WORKING_ACCOUNTS, cents, type WorkingAccount, type WorkingCapitalRecord, type WorkingEntry, type OpeningBalances } from '@workspace/accounting-core';

export type WorkingAction = WorkingCapitalRecord['action'];
export interface WorkingForm {
  account: WorkingAccount; action: WorkingAction; amount: string; date: string; mode: 'cash' | 'bank'; bankAccountName: string;
  linked: string; party: string; term: 'current' | 'non_current'; leaseTermMonths: string; leasePaymentAmount: string;
  leaseAnnualRate: string; leasePaymentNumber: string; reference: string; notes: string; confirmed: boolean;
}
const todayStr = () => new Date().toISOString().slice(0, 10);
export const emptyWorking = (): WorkingForm => ({ account: 'loan', action: 'increase', amount: '', date: todayStr(), mode: 'bank', bankAccountName: '', linked: '', party: '', term: 'current', leaseTermMonths: '60', leasePaymentAmount: '', leaseAnnualRate: '', leasePaymentNumber: '', reference: '', notes: '', confirmed: false });
export const ACCOUNT_OPTIONS = Object.entries(WORKING_ACCOUNTS) as [WorkingAccount, string][];

export function actionOptions(account: WorkingAccount): [WorkingAction, string][] {
  const base: Record<WorkingAccount, [WorkingAction, string][]> = {
    prepayment: [['opening', 'Opening balance'], ['increase', 'Paid in advance'], ['release', 'Expense used up']],
    accrual: [['opening', 'Opening balance'], ['increase', 'Expense owed'], ['release', 'Accrual paid']],
    unearned_revenue: [['opening', 'Opening balance'], ['increase', 'Customer advance received'], ['release', 'Revenue earned']],
    loan: [['opening', 'Opening balance'], ['increase', 'Loan received'], ['release', 'Principal repaid'], ['interest', 'Interest paid']],
    lease: [['increase', 'Recognize lease'], ['release', 'Record payment']],
  };
  return base[account];
}
export const actionLabel = (a: WorkingAccount, x: WorkingAction) => actionOptions(a).find(o => o[0] === x)?.[1] ?? x;

export function effectText(account: WorkingAccount, action: WorkingAction): string {
  if (action === 'opening') return 'Classifies part of your confirmed opening aggregate on the opening date. No Cash or Bank moves and no profit is affected.';
  if (action === 'interest') return 'Interest actually paid on this loan. Reduces Cash/Bank and is a finance cost. Principal is unchanged.';
  const m: Record<WorkingAccount, Record<'increase' | 'release', string>> = {
    prepayment: { increase: 'Money leaves Cash/Bank and becomes a prepayment asset. No expense yet.', release: 'Non-cash. Moves the used-up part of the original prepayment into expenses.' },
    accrual: { increase: 'Non-cash. Records an expense you owe but have not paid yet.', release: 'Pays the original accrual from Cash/Bank. No new expense.' },
    unearned_revenue: { increase: 'Money comes into Cash/Bank as a liability. Not income yet.', release: 'Non-cash. Recognises the earned part of the original advance as revenue.' },
    loan: { increase: 'Loan principal received into Cash/Bank. Never income.', release: 'Principal repaid from Cash/Bank. Never an expense.' },
    lease: { increase: 'Recognizes a right-of-use asset and lease liability at the present value of fixed monthly payments. The app calculates the interest/principal split, current portion and straight-line depreciation. Initial recognition does not move Cash/Bank.', release: 'Records the scheduled monthly payment. The app splits interest from principal and updates the liability.' },
  };
  return m[account][action];
}
export const needsOriginal = (a: WorkingAction) => a === 'release' || a === 'interest';
export const isMoney = (f: Pick<WorkingForm, 'account' | 'action'>) => workingMode(f) === 'money';

export function openingInfo(entries: { type?: string; date?: string; ledgerStatus?: string; openingBalances?: OpeningBalances }[]) {
  const o = entries.filter(e => e.type === 'opening_balance' && e.ledgerStatus !== 'void' && e.openingBalances).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  return o ? { date: String(o.date), balances: o.openingBalances! } : null;
}
/** Remaining room in each confirmed opening aggregate, excluding the record being edited. */
export function openingRoom(entries: WorkingEntry[], balances: OpeningBalances, editId: string) {
  const used = { prepayment: 0, accrual: 0, unearned_revenue: 0, loan: 0, lease: 0 };
  for (const { id, record } of workingRecords(entries)) if (record.action === 'opening' && id !== editId) used[record.account] += cents(record.amount);
  return {
    prepayment: (cents(balances.otherCurrentAssets) - used.prepayment) / 100,
    accrualOrUnearned: (cents(balances.otherCurrentLiabilities) - used.accrual - used.unearned_revenue) / 100,
    loan: (cents(balances.loans) - used.loan) / 100,
  };
}
export function originals(entries: WorkingEntry[], account: WorkingAccount, editId: string) {
  return workingRecords(entries).filter(r => r.id !== editId && r.record.account === account && (r.record.action === 'opening' || r.record.action === 'increase'))
    .map(r => {
      const own = workingRecords(entries).find(x => x.id === editId && x.record.linkedRecordId === r.id && x.record.action === 'release');
      const ownAmount = own ? (own.record.account === 'lease' ? leasePaymentSplit(entries, own.id)?.principal ?? 0 : own.record.amount) : 0;
      return { ...r, remaining: workingBalance(entries, r.id) + ownAmount };
    });
}
export function buildWorking(f: WorkingForm, entries: WorkingEntry[], opening: { date: string } | null, editId: string): WorkingCapitalRecord {
  if (!opening) throw new Error('Confirm opening balances before managing these accounts.');
  if (!f.reference.trim()) throw new Error('Enter a supporting reference (agreement, invoice or receipt).');
  if (!f.confirmed) throw new Error('Confirm you checked this against the supporting document before saving.');
  const amountText = f.amount.replace(/,/g, '').trim();
  if (f.account !== 'lease' && !/^\d+(\.\d{1,2})?$/.test(amountText)) throw new Error('Enter a positive amount with at most two decimals.');
  if (f.account === 'lease' && f.action === 'increase' &&
    (!/^\d+(\.\d{1,2})?$/.test(f.leasePaymentAmount) ||
      !/^\d+(\.\d{1,2})?$/.test(f.leaseAnnualRate) ||
      !/^\d+$/.test(f.leaseTermMonths))) throw new Error('Enter a monthly payment, annual discount rate and lease term.');
  const date = f.action === 'opening' ? opening.date : f.date;
  if (f.action !== 'opening' && date <= opening.date) throw new Error(`New movements must be dated after your opening date (${opening.date}).`);
  if (f.action === 'interest' && f.account !== 'loan') throw new Error('Interest payments must belong to a loan.');
  let term = f.account === 'loan' ? f.term : 'non_current' as const;
  let amount = Number(amountText);
  let paymentNumber: number | undefined;
  let leasePaymentAmount: number | undefined;
  let leaseAnnualRate: number | undefined;
  const leaseTermMonths = f.account === 'lease' && f.action === 'increase' ? Number(f.leaseTermMonths) : undefined;
  if (f.account === 'lease' && f.action === 'increase') {
    leasePaymentAmount = Number(f.leasePaymentAmount);
    leaseAnnualRate = Number(f.leaseAnnualRate);
    amount = leasePresentValue(leasePaymentAmount, leaseTermMonths!, leaseAnnualRate);
  }
  if (needsOriginal(f.action)) {
    const src = originals(entries, f.account, editId).find(o => o.id === f.linked);
    if (!src) throw new Error('Choose the original active record this movement settles.');
    if (date < src.record.date) throw new Error('This movement cannot be dated before its original.');
    if (f.action === 'release' && f.account === 'lease') {
      const installment = nextLeaseInstallment(entries, f.linked, editId);
      if (!installment || Number(f.leasePaymentNumber) !== installment.number || date !== installment.dueDate)
        throw new Error('Use the next scheduled installment and its due date.');
      paymentNumber = installment.number;
      amount = installment.payment;
    } else if (f.action === 'release' && cents(Number(amountText)) > cents(src.remaining)) throw new Error(`Amount exceeds the original remaining balance of ${src.remaining.toFixed(2)}.`);
    term = src.record.loanTerm;
  }
  const rec: WorkingCapitalRecord = {
    kind: 'working_capital', account: f.account, action: f.action, amount, date,
    paymentMode: workingMode(f) === 'non_cash' ? 'non_cash' : f.mode, linkedRecordId: needsOriginal(f.action) ? f.linked : '',
    ...(workingMode(f) !== 'non_cash' && f.mode === 'bank' ? { bankAccountName: f.bankAccountName.trim() } : {}),
    partyName: f.party.trim(), loanTerm: term,
    ...(f.account === 'lease' && f.action === 'increase' ? { leaseTermMonths, leasePaymentAmount, leaseAnnualRate } : {}),
    ...(paymentNumber ? { leasePaymentNumber: paymentNumber } : {}),
    reference: f.reference.trim(), notes: f.notes.trim(),
  };
  validateFinanceRecord(rec);
  return rec;
}
export function formFromRecord(r: WorkingCapitalRecord): WorkingForm {
  return { account: r.account, action: r.action, amount: String(r.amount), date: r.date, mode: r.paymentMode === 'cash' ? 'cash' : 'bank', bankAccountName: r.bankAccountName ?? '', linked: r.linkedRecordId, party: r.partyName, term: r.loanTerm, leaseTermMonths: String(r.leaseTermMonths ?? 60), leasePaymentAmount: String(r.leasePaymentAmount ?? ''), leaseAnnualRate: String(r.leaseAnnualRate ?? ''), leasePaymentNumber: String(r.leasePaymentNumber ?? ''), reference: r.reference, notes: r.notes, confirmed: false };
}
