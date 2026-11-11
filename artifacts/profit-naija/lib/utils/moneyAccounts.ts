import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  serverTimestamp,
  type Firestore,
  type Transaction,
} from 'firebase/firestore';
import type { Entry } from '@/context/EntriesContext';
import { getGrossSaleValue, getPurchaseBaseCost, isDirectExpenseEntry } from './formulas.ts';
import { getOpeningRecord, financialMoneyMovements, dayBefore, isCreditReturn, bankAccountDisplayName, bankAccountKey, cents } from '@workspace/accounting-core';

export type PaymentMode = 'cash' | 'bank' | 'credit' | 'non_cash';
export type MoneyAccount = 'cash' | 'bank';
export interface MoneyAccountMovement {
  entry: Entry;
  account: MoneyAccount;
  bankAccountName?: string;
  /** Signed amount: receipts are positive and payments are negative. */
  amount: number;
}

export function getEntryPaymentMode(entry: Entry): PaymentMode {
  if (isCreditReturn(entry)) return 'credit';
  if (entry.type === 'opening_balance') return 'non_cash';
  if (entry.type === 'credit_sale' || entry.type === 'credit_purchase') return 'credit';
  if (entry.type === 'expense' && !isDirectExpenseEntry(entry)) return 'non_cash';
  if (entry.type === 'expense' && entry.category?.trim().toLowerCase() === 'depreciation') return 'non_cash';
  return entry.paymentMode ?? 'cash';
}

export function getPaymentModeLabel(entry: Entry): string {
  const mode = getEntryPaymentMode(entry);
  return mode === 'non_cash' ? 'Non-cash' : mode === 'credit' ? 'Credit' : mode === 'bank' ? 'Bank' : 'Cash';
}

/** Derive balances from source records, so edits/deletes cannot leave a second ledger stale. */
export function getMoneyAccountMovements(entries: Entry[], cutoffDate?: string): MoneyAccountMovement[] {
  const opening = getOpeningRecord(entries, cutoffDate);
  const financial = entries.flatMap(entry=>financialMoneyMovements(entry).filter(m=>
    (!cutoffDate||m.date<=cutoffDate)&&(!opening||m.date>opening.date)).map(m=>({
      entry:{...entry,id:m.id,date:m.date,paymentMode:m.account,bankAccountName:m.bankAccountName},account:m.account,amount:m.amount,bankAccountName:m.bankAccountName
    })));
  return entries.filter(entry => entry.ledgerStatus !== 'void'
    && (!cutoffDate || entry.date <= cutoffDate)
    && (!opening || entry.date > opening.date)).flatMap(entry => {
    const mode = getEntryPaymentMode(entry);
    if (mode === 'credit' || mode === 'non_cash') return [];
    let amount = 0;
    switch (entry.type) {
      case 'sale': amount = getGrossSaleValue(entry); break;
      case 'credit_sale_payment':
      case 'owner_contribution':
      case 'return_outward': amount = entry.amount; break;
      case 'owner_drawings': amount = -entry.amount; break;
      case 'purchase':
        amount = -(typeof entry.totalLandedCost === 'number'
          ? entry.totalLandedCost + (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0)
          : getPurchaseBaseCost(entry)
            + (entry.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0)
            + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0)
            + (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0));
        break;
      case 'credit_purchase_payment': amount = -entry.amount; break;
      case 'return_inward': amount = -getGrossSaleValue(entry); break;
      case 'expense':
        if (isDirectExpenseEntry(entry)) amount = -entry.amount;
        break;
    }
    if (!Number.isFinite(amount) || amount === 0) return [];
    return [{ entry, account: mode, amount, bankAccountName: mode === 'bank' ? entry.bankAccountName?.trim() : undefined }];
  }).concat(financial).sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.createdAt - b.entry.createdAt);
}

export interface BankAccountBalance { name: string; opening: number; movement: number; balance: number }
export interface BankAccountBalances { accounts: BankAccountBalance[]; unassigned: number; unassignedOpening: number; unassignedMovement: number; unassignedMovementCount: number; total: number }
export interface MoneyAccountFundingSnapshot {
  /** Cash balance is retained under the old field name for existing callers. */
  balance: number;
  bankBalance: number;
  bankAccounts: Array<{ name: string; balance: number }>;
  revision: number;
}
export interface FundingAlternative {
  account: MoneyAccount;
  bankAccountName?: string;
  available: number;
  required: number;
}

export function getBankAccountNames(entries: Entry[]): string[] {
  const names = new Map<string, string>();
  const add = (value?: string) => {
    const name = value?.trim();
    if (name) names.set(bankAccountKey(name), names.get(bankAccountKey(name)) ?? name);
  };
  const opening = getOpeningRecord(entries);
  for (const evidence of opening?.bankEvidence ?? []) add(bankAccountDisplayName(evidence.bankName, evidence.accountLabel));
  for (const entry of entries) {
    if (entry.ledgerStatus === 'void') continue;
    add(entry.bankAccountName);
    const finance = entry.finance;
    if (!finance) continue;
    if (finance.kind === 'statement') add(bankAccountDisplayName(finance.bankName, finance.accountLabel));
    else {
      add(finance.bankAccountName);
      if (finance.kind === 'asset') add(finance.disposalBankAccountName);
      if (finance.kind === 'bank_transfer') {
        add(finance.fromBankAccountName);
        add(finance.toBankAccountName);
      }
    }
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

export function calcBankAccountBalances(entries: Entry[], cutoffDate?: string): BankAccountBalances {
  const opening = getOpeningRecord(entries, cutoffDate);
  const accounts = new Map<string, BankAccountBalance>();
  const ensure = (name: string) => {
    const key = bankAccountKey(name);
    if (!accounts.has(key)) accounts.set(key, { name: name.trim(), opening: 0, movement: 0, balance: 0 });
    return accounts.get(key)!;
  };
  for (const name of getBankAccountNames(entries)) ensure(name);
  let unassignedOpening = opening?.openingBalances?.bank ?? 0;
  let unassignedMovement = 0;
  let unassignedMovementCount = 0;
  for (const evidence of opening?.bankEvidence ?? []) {
    const name = bankAccountDisplayName(evidence.bankName, evidence.accountLabel);
    const account = ensure(name);
    account.opening += evidence.closingBalance;
    unassignedOpening -= evidence.closingBalance;
  }
  for (const movement of getMoneyAccountMovements(entries, cutoffDate)) {
    if (movement.account !== 'bank') continue;
    if (!movement.bankAccountName?.trim()) {
      unassignedMovement += movement.amount;
      unassignedMovementCount++;
      continue;
    }
    ensure(movement.bankAccountName).movement += movement.amount;
  }
  for (const account of accounts.values()) {
    account.opening = cents(account.opening) / 100;
    account.movement = cents(account.movement) / 100;
    account.balance = cents(account.opening + account.movement) / 100;
  }
  return {
    accounts: [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name)),
    unassigned: cents(unassignedOpening + unassignedMovement) / 100,
    unassignedOpening: cents(unassignedOpening) / 100,
    unassignedMovement: cents(unassignedMovement) / 100,
    unassignedMovementCount,
    total: calcMoneyAccountBalances(entries, cutoffDate).bank,
  };
}

export function calcMoneyAccountBalances(entries: Entry[], cutoffDate?: string): { cash: number; bank: number } {
  const opening = getOpeningRecord(entries, cutoffDate)?.openingBalances;
  return getMoneyAccountMovements(entries, cutoffDate).reduce((balances, movement) => {
    balances[movement.account] += movement.amount;
    return balances;
  }, { cash: opening?.cash ?? 0, bank: opening?.bank ?? 0 });
}

export function isInventorySale(entry: Pick<Entry, 'type' | 'category'>): boolean {
  return (entry.type === 'sale' || entry.type === 'credit_sale')
    && !/service/i.test(String(entry.category ?? ''));
}

export function cashPurchaseFundingError(entries: Entry[], purchase: Partial<Entry>): string | null {
  if (purchase.type !== 'purchase' || getEntryPaymentMode(purchase as Entry) !== 'cash') return null;
  return cashPurchaseFundingErrorAtBalance(calcMoneyAccountBalances(entries, localDateKey()).cash, purchase);
}

export function cashPurchaseFundingErrorAtBalance(available: number, purchase: Partial<Entry>): string | null {
  if (purchase.type !== 'purchase' || getEntryPaymentMode(purchase as Entry) !== 'cash') return null;
  const draft = { ...purchase, id: '__cash_purchase_check__', createdAt: Date.now() } as Entry;
  const required = getMoneyAccountMovements([draft]).reduce(
    (sum, movement) => movement.account === 'cash' && movement.amount < 0 ? sum - movement.amount : sum,
    0,
  );
  if (!Number.isFinite(available) || !Number.isFinite(required)) {
    return 'Cash balance could not be confirmed. Wait for it to load, then try again.';
  }
  if (available + 0.005 < required) {
    const formattedAvailable = Math.max(0, available).toLocaleString('en-NG', { maximumFractionDigits: 2 });
    return `Not enough cash to pay for this purchase. Available cash: ₦${formattedAvailable}. Add additional cash to the business first.`;
  }
  return null;
}

/** True when the record would reduce Cash or Bank, regardless of transaction type. */
export function hasMoneyOutflow(entry: Partial<Entry>): boolean {
  const draft = { ...entry, id: '__funding_check__', date: localDateKey(), createdAt: Date.now() } as Entry;
  return getMoneyAccountMovements([draft]).some(movement => movement.amount < 0);
}

/**
 * Verify every account a record spends from against the stable pre-write
 * snapshot. Named bank accounts stay separate; unassigned funds are not
 * silently treated as available in a different account.
 */
export function spendingFundingErrorAtSnapshot(
  snapshot: Pick<MoneyAccountFundingSnapshot, 'balance' | 'bankBalance' | 'bankAccounts'>,
  entry: Partial<Entry>,
): string | null {
  const today = localDateKey();
  // Use today for the funding calculation so historical entry dates cannot
  // bypass the balance check by predating the opening-balance record.
  const draft = { ...entry, id: '__funding_check__', date: today, createdAt: Date.now() } as Entry;
  const requiredByAccount = new Map<string, { account: MoneyAccount; name?: string; required: number }>();
  for (const movement of getMoneyAccountMovements([draft])) {
    if (movement.amount >= 0) continue;
    const name = movement.account === 'bank' ? movement.bankAccountName?.trim() : undefined;
    const key = movement.account === 'cash' ? 'cash' : name ? `bank:${bankAccountKey(name)}` : 'bank';
    const item = requiredByAccount.get(key) ?? { account: movement.account, name, required: 0 };
    item.required += -movement.amount;
    requiredByAccount.set(key, item);
  }
  for (const [key, requirement] of requiredByAccount) {
    const available = requirement.account === 'cash'
      ? snapshot.balance
      : key.startsWith('bank:')
        ? snapshot.bankAccounts.find(account => bankAccountKey(account.name) === key.slice(5))?.balance ?? 0
        : snapshot.bankBalance;
    if (!Number.isFinite(available) || !Number.isFinite(requirement.required)) {
      return `${requirement.account === 'cash' ? 'Cash' : 'Bank'} balance could not be confirmed. Wait for it to load, then try again.`;
    }
    if (available + 0.005 < requirement.required) {
      const accountLabel = requirement.account === 'cash'
        ? 'Cash'
        : requirement.name ? `Bank account ${requirement.name}` : 'Bank';
      const money = (value: number) => `₦${value.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return `Insufficient funds: ${accountLabel} has ${money(available)} available, but this transaction needs ${money(requirement.required)}.`;
    }
  }
  return null;
}

/** Existing saved accounts that can cover the full outflow instead. */
export function getFundingAlternatives(
  entries: Entry[],
  entry: Partial<Entry>,
  excludeId?: string,
): FundingAlternative[] {
  const today = localDateKey();
  const draft = {
    ...entry,
    id: '__funding_alternative__',
    date: today,
    ...(entry.finance ? { finance: { ...entry.finance, date: today } } : {}),
    createdAt: Date.now(),
  } as Entry;
  const outflows = getMoneyAccountMovements([draft]).filter(movement => movement.amount < 0);
  if (outflows.length !== 1) return [];

  const current = outflows[0]!;
  const required = Math.abs(current.amount);
  const currentKey = current.account === 'cash'
    ? 'cash'
    : current.bankAccountName?.trim()
      ? `bank:${bankAccountKey(current.bankAccountName)}`
      : 'bank';
  const transferDestinationKey = entry.finance?.kind === 'bank_transfer'
    ? entry.finance.toAccount === 'cash'
      ? 'cash'
      : `bank:${bankAccountKey(entry.finance.toBankAccountName ?? '')}`
    : null;
  const ledger = entries.filter(item => item.id !== excludeId);
  const cash = calcMoneyAccountBalances(ledger, today).cash;
  const bankAccounts = calcBankAccountBalances(ledger, today).accounts;
  const candidates: FundingAlternative[] = [
    { account: 'cash', available: cash, required },
    ...bankAccounts.map(account => ({
      account: 'bank' as const,
      bankAccountName: account.name,
      available: account.balance,
      required,
    })),
  ];

  return candidates
    .filter(candidate => {
      const key = candidate.account === 'cash'
        ? 'cash'
        : `bank:${bankAccountKey(candidate.bankAccountName ?? '')}`;
      return key !== currentKey && key !== transferDestinationKey
        && Number.isFinite(candidate.available) && candidate.available + 0.005 >= required;
    })
    .sort((a, b) => b.available - a.available);
}

function localDateKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const CASH_LEDGER_COLLECTIONS = ['sales', 'purchases', 'expenses', 'returns', 'accountingLedger'] as const;

/** Load a stable ledger snapshot before a transaction; the root revision is rechecked inside it. */
export async function getCashLedgerSnapshot(
  firestore: Firestore,
  userId: string,
  excludePath?: string,
): Promise<MoneyAccountFundingSnapshot> {
  const rootRef = doc(firestore, 'users', userId);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await getDocFromServer(rootRef);
    if (before.data()?.restoreOperation?.status === 'running') {
      throw new Error('Business data is being restored. Wait for the restore to finish, then try again.');
    }
    const revision = Number(before.data()?.cashLedgerRevision ?? 0);
    const snapshots = await Promise.all(CASH_LEDGER_COLLECTIONS.map((name) =>
      getDocsFromServer(collection(firestore, 'users', userId, name)),
    ));
    const after = await getDocFromServer(rootRef);
    if (after.data()?.restoreOperation?.status === 'running') {
      throw new Error('Business data is being restored. Wait for the restore to finish, then try again.');
    }
    if (Number(after.data()?.cashLedgerRevision ?? 0) !== revision) continue;
    const entries = snapshots.flatMap((snapshot) => snapshot.docs
      .filter((entryDoc) => entryDoc.ref.path !== excludePath)
      .map((entryDoc) => ({ ...entryDoc.data(), id: entryDoc.id }) as Entry));
    const balances = calcMoneyAccountBalances(entries, localDateKey());
    const bankAccounts = calcBankAccountBalances(entries, localDateKey());
    return {
      balance: balances.cash,
      bankBalance: balances.bank,
      bankAccounts: bankAccounts.accounts.map(({ name, balance }) => ({ name, balance })),
      revision,
    };
  }
  throw new Error('Cash balance changed while it was being checked. Refresh and try the purchase again.');
}

export async function readCashLedgerControl(
  tx: Transaction,
  firestore: Firestore,
  userId: string,
) {
  const ref = doc(firestore, 'users', userId);
  const snapshot = await tx.get(ref);
  if (snapshot.data()?.restoreOperation?.status === 'running') {
    throw new Error('Business data is being restored. Wait for the restore to finish, then try again.');
  }
  return { ref, revision: Number(snapshot.data()?.cashLedgerRevision ?? 0) };
}

export function advanceCashLedgerControl(
  tx: Transaction,
  control: Awaited<ReturnType<typeof readCashLedgerControl>>,
): void {
  tx.set(control.ref, {
    cashLedgerRevision: control.revision + 1,
    cashLedgerUpdatedAt: serverTimestamp(),
  }, { merge: true });
}

export function assertCashLedgerSnapshotCurrent(
  control: Awaited<ReturnType<typeof readCashLedgerControl>>,
  snapshot: { revision: number },
): void {
  if (control.revision !== snapshot.revision) {
    throw new Error('Cash balance changed while this purchase was saving. Refresh and try again.');
  }
}

export function getMoneyReportingWindow(entries: Entry[], scoped: Entry[], start?: string, end?: string) {
  const available = end ? entries.filter(e => e.date <= end)
    : [...entries.filter(e => start && e.date < start), ...scoped];
  const opening = getOpeningRecord(available);
  const balances = opening && (!start || start <= opening.date)
    ? { cash: opening.openingBalances!.cash, bank: opening.openingBalances!.bank }
    : start ? calcMoneyAccountBalances(entries,dayBefore(start)) : {cash:0,bank:0};
  return {
    entries: scoped.filter(e => e.ledgerStatus !== 'void' && (!opening || e.date > opening.date)),
    openingCash: balances.cash + balances.bank,
    openingDate: opening && (!start || start <= opening.date) ? opening.date : undefined,
  };
}
