import type { Entry } from '@/context/EntriesContext';
import { getGrossSaleValue, getPurchaseBaseCost, isDirectExpenseEntry } from './formulas.ts';
import { getOpeningRecord, financialMoneyMovements, dayBefore, isCreditReturn } from '@workspace/accounting-core';

export type PaymentMode = 'cash' | 'bank' | 'credit' | 'non_cash';
export type MoneyAccount = 'cash' | 'bank';
export interface MoneyAccountMovement {
  entry: Entry;
  account: MoneyAccount;
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
      entry:{...entry,id:m.id,date:m.date,paymentMode:m.account},account:m.account,amount:m.amount
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
    return [{ entry, account: mode, amount }];
  }).concat(financial).sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.entry.createdAt - b.entry.createdAt);
}

export function calcMoneyAccountBalances(entries: Entry[], cutoffDate?: string): { cash: number; bank: number } {
  const opening = getOpeningRecord(entries, cutoffDate)?.openingBalances;
  return getMoneyAccountMovements(entries, cutoffDate).reduce((balances, movement) => {
    balances[movement.account] += movement.amount;
    return balances;
  }, { cash: opening?.cash ?? 0, bank: opening?.bank ?? 0 });
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
