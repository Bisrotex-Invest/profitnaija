import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertCashLedgerSnapshotCurrent,
  cashPurchaseFundingError,
  cashPurchaseFundingErrorAtBalance,
  hasMoneyOutflow,
  isInventorySale,
  getFundingAlternatives,
  spendingFundingErrorAtSnapshot,
} from './moneyAccounts.ts';
import type { Entry } from '@/context/EntriesContext';

const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const purchase = {
  type: 'purchase',
  paymentMode: 'cash',
  date: today,
  amount: 100,
  unitsPurchased: 1,
  unitPurchasePrice: 100,
  totalLandedCost: 100,
  purchaseVAT: 0,
  withholdingTax: 0,
} as Partial<Entry>;

test('cash purchase is blocked when the ledger has no cash balance', () => {
  assert.match(cashPurchaseFundingError([], purchase) ?? '', /Add additional cash to the business/);
});

test('cash purchase is allowed when recorded cash covers its landed cost', () => {
  const cashSale = {
    id: 'cash-sale',
    userId: 'user-1',
    type: 'sale',
    paymentMode: 'cash',
    amount: 500,
    unitSalesPrice: 500,
    unitsSold: 1,
    vatExclusive: true,
    vatPaid: 0,
    category: 'Product Sale',
    notes: '',
    date: today,
    createdAt: 1,
  } as Entry;
  assert.equal(cashPurchaseFundingError([cashSale], purchase), null);
});

test('transaction-time purchase validation uses the balance captured for the ledger revision', () => {
  assert.match(cashPurchaseFundingErrorAtBalance(99.99, purchase) ?? '', /Add additional cash to the business/);
  assert.equal(cashPurchaseFundingErrorAtBalance(100, purchase), null);
});

test('a cash snapshot cannot be used after another device changes the ledger revision', () => {
  const control = { ref: {} as any, revision: 8 };
  assert.throws(() => assertCashLedgerSnapshotCurrent(control, { revision: 7 }), /Cash balance changed/);
  assert.doesNotThrow(() => assertCashLedgerSnapshotCurrent(control, { revision: 8 }));
});

test('credit purchases are not checked against cash on hand', () => {
  assert.equal(cashPurchaseFundingError([], { ...purchase, type: 'credit_purchase', paymentMode: 'credit' }), null);
});

test('all cash and bank outflows are checked against the account they use', () => {
  const snapshot = {
    balance: 100,
    bankBalance: 900,
    bankAccounts: [{ name: 'GTBank · Current', balance: 200 }],
  };
  const cashExpense = { type: 'expense', amount: 101, date: today, paymentMode: 'cash' } as Partial<Entry>;
  const bankExpense = { type: 'expense', amount: 201, date: today, paymentMode: 'bank', bankAccountName: 'GTBank · Current' } as Partial<Entry>;
  assert.equal(hasMoneyOutflow(cashExpense), true);
  assert.match(spendingFundingErrorAtSnapshot(snapshot, cashExpense) ?? '', /^Insufficient funds:/);
  assert.match(spendingFundingErrorAtSnapshot(snapshot, bankExpense) ?? '', /^Insufficient funds: Bank account/);
});

test('income and credit purchases do not trigger a cash or bank spending check', () => {
  const snapshot = { balance: 0, bankBalance: 0, bankAccounts: [] };
  assert.equal(hasMoneyOutflow({ type: 'sale', amount: 50, date: today, paymentMode: 'cash' } as Partial<Entry>), false);
  assert.equal(hasMoneyOutflow({ type: 'credit_purchase', amount: 50, date: today, paymentMode: 'credit' } as Partial<Entry>), false);
  assert.equal(spendingFundingErrorAtSnapshot(snapshot, { type: 'sale', amount: 50, date: today } as Partial<Entry>), null);
});

test('inventory sales require stock but service sales do not', () => {
  assert.equal(isInventorySale({ type: 'sale', category: 'Product Sale' }), true);
  assert.equal(isInventorySale({ type: 'credit_sale', category: 'Service (Credit)' }), false);
});

test('a future date on a financial record cannot bypass spending protection', () => {
  const entry = {
    type: 'financial_record',
    finance: { kind: 'bank_transfer', date: '2099-01-01', fromAccount: 'cash', toAccount: 'bank', amount: 101 },
  } as Partial<Entry>;
  assert.equal(hasMoneyOutflow(entry), true);
  assert.match(spendingFundingErrorAtSnapshot({ balance: 100, bankBalance: 0, bankAccounts: [] }, entry) ?? '', /^Insufficient funds:/);
});

test('saved, sufficiently funded accounts are suggested but the current account is excluded', () => {
  const entries = [
    { id: 'cash-funds', type: 'owner_contribution', date: today, amount: 400, paymentMode: 'cash', createdAt: 1 },
    { id: 'other-bank', type: 'owner_contribution', date: today, amount: 300, paymentMode: 'bank', bankAccountName: 'Other Bank · Current', createdAt: 2 },
    { id: 'selected-bank', type: 'owner_contribution', date: today, amount: 100, paymentMode: 'bank', bankAccountName: 'Selected Bank · Current', createdAt: 3 },
  ] as Entry[];
  const alternatives = getFundingAlternatives(entries, {
    type: 'expense', date: today, amount: 250, paymentMode: 'bank', bankAccountName: 'Selected Bank · Current',
  } as Partial<Entry>);
  assert.deepEqual(alternatives.map(account => account.account === 'cash' ? 'Cash' : account.bankAccountName), [
    'Cash', 'Other Bank · Current',
  ]);
  assert.equal(getFundingAlternatives(entries, {
    type: 'expense', date: today, amount: 350, paymentMode: 'bank', bankAccountName: 'Selected Bank · Current',
  } as Partial<Entry>).length, 1);
});

test('fixed-asset purchases and bank transfers can suggest another saved account', () => {
  const entries = [
    { id: 'cash-funds', type: 'owner_contribution', date: today, amount: 400, paymentMode: 'cash', createdAt: 1 },
    { id: 'other-bank', type: 'owner_contribution', date: today, amount: 300, paymentMode: 'bank', bankAccountName: 'Other Bank · Current', createdAt: 2 },
    { id: 'selected-bank', type: 'owner_contribution', date: today, amount: 100, paymentMode: 'bank', bankAccountName: 'Selected Bank · Current', createdAt: 3 },
  ] as Entry[];
  const asset = {
    type: 'financial_record',
    finance: { kind: 'asset', cost: 250, date: today, paymentMode: 'bank', bankAccountName: 'Selected Bank · Current' },
  } as Partial<Entry>;
  assert.equal(getFundingAlternatives(entries, asset)[0]?.account, 'cash');
  const transfer = {
    type: 'financial_record',
    finance: {
      kind: 'bank_transfer', date: today, fromAccount: 'bank', fromBankAccountName: 'Selected Bank · Current',
      toAccount: 'cash', amount: 250,
    },
  } as Partial<Entry>;
  assert.equal(getFundingAlternatives(entries, transfer)[0]?.bankAccountName, 'Other Bank · Current');
});
