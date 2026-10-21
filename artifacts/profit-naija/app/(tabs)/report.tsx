import { supplierPurchasePayable } from '@workspace/accounting-core';
import React, { useEffect, useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useEntries, Entry } from '@/context/EntriesContext';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useProfile } from '@/context/ProfileContext';
import { getAccountingYearToDate, getPreviousAccountingYear, profitStatementYearLabel, isCreditReturn } from '@workspace/accounting-core';
import { useBilling } from '@/context/BillingContext';
import { getPaymentModeLabel } from '@/lib/utils/moneyAccounts';
import { buildDirectCashFlow, buildVATLedger, buildPnLReport, calcCostBalance, calcInventoryPurchasesForEntries, calcInventoryValueAsOf, calcNigerianPIT, formatDirectExpenseDescription, formatEntryDescription, getEntryVAT, getGrossSaleValue, getInventoryMovementCost, getOutstandingCredits, getPurchaseBaseCost, getSaleValue, getSupplierReturnExpense, isDirectExpenseEntry, isCashExpenseEntry, type DirectCashFlowData } from '@/lib/utils/formulas';
import { BalanceSheetStatement, buildBalanceSheetHTML } from '@/components/BalanceSheetStatement';
import { normalizeNigerianPhone, normalizePartyName } from '@/lib/utils/party';
import { buildTaxControlLedger, taxControlRows, type TaxType } from '@workspace/accounting-core';
import { TaxControlSummary } from '@/components/TaxControlSummary';

// ── Types & constants ─────────────────────────────────────────────────────────

const NAIRA = '₦';

type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
type ReportView = 'pnl' | 'cash_flow' | 'credit_sales' | 'credit_purchases' | 'vat' | 'tax' | 'returns_inward' | 'returns_outward' | 'wht' | 'balance_sheet';
type CashFlowReportData = DirectCashFlowData;

const REPORT_VIEWS: { key: ReportView; label: string; description: string }[] = [
  { key: 'pnl', label: 'Profit or Loss', description: 'Profit or Loss Statement' },
  { key: 'cash_flow', label: 'Statement of Cash Flow', description: 'Direct-method operating, investing and financing cash flows' },
  { key: 'balance_sheet', label: 'Balance Sheet', description: 'Statement of Financial Position' },
  { key: 'credit_sales', label: 'Debtors', description: 'People that are owing me' },
  { key: 'credit_purchases', label: 'Creditors', description: 'people that I am owing' },
  { key: 'vat', label: 'VAT', description: 'VAT on products sold' },
  { key: 'tax', label: 'PIT', description: 'Estimated personal income tax' },
  { key: 'returns_inward', label: 'Returns Inward', description: 'Customer returns and VAT reversals' },
  { key: 'returns_outward', label: 'Returns Outward', description: 'Supplier credits and returned inventory cost' },
  { key: 'wht', label: 'Withholding Tax', description: 'Tax withheld from supplier payments' },
];

const PERIOD_TABS: { key: ReportPeriod; label: string }[] = [
  { key: 'daily',   label: 'Daily'   },
  { key: 'weekly',  label: 'Weekly'  },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly',  label: 'Yearly'  },
  { key: 'custom',  label: 'Custom'  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return NAIRA + Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPnlNaira(n: number): string {
  return NAIRA + Math.round(Math.abs(n)).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

const isCreditExpenseEntry = (e: Entry) => e.type === 'expense' && e.paymentMode === 'credit';
const creditorAmount = (e: Entry) => e.type === 'expense' ? e.amount : supplierPurchasePayable(e);
const MODE_TYPES = ['sale', 'credit_sale', 'purchase', 'credit_purchase', 'expense', 'credit_sale_payment', 'credit_purchase_payment'];

function getEntryDetailRows(entry: Entry, formatAmount: (value: number) => string = fmt): Array<{ label: string; value: string }> {
  if(entry.finance?.kind==='working_capital'){
    const r=entry.finance;
    const account={prepayment:'Prepayment',accrual:'Accrued expense',unearned_revenue:'Customer advance',loan:'Loan'}[r.account];
    const action={opening:'Opening classification',increase:'Balance increase',release:'Settlement / recognition',interest:'Interest payment'}[r.action];
    return [
      {label:'Account and action',value:`${account} · ${action}`},
      {label:'Amount',value:formatAmount(r.amount)},
      {label:'Counterparty',value:r.partyName},
      {label:'Supporting reference',value:r.reference},
      {label:'Settlement',value:r.paymentMode==='non_cash'?'Non-cash':r.paymentMode==='cash'?'Cash':'Bank'},
      ...(r.linkedRecordId?[{label:'Original balance ID',value:r.linkedRecordId}]:[]),
      ...(r.account==='loan'?[{label:'Loan term',value:r.loanTerm==='current'?'Due within 12 months':'Due after 12 months'}]:[]),
      ...(r.notes?[{label:'Notes',value:r.notes}]:[]),
    ];
  }
  const isSale = entry.type === 'sale' || entry.type === 'credit_sale';
  const rows: Array<{ label: string; value: string }> = [
    { label: isSale ? 'Customer total (base sale + VAT)' : entry.type === 'return_outward' ? 'Supplier credit (current base-cost credit)' : 'Transaction amount',
      value: formatAmount(isSale && typeof entry.unitsSold === 'number' && typeof entry.unitSalesPrice === 'number'
        ? entry.unitsSold * entry.unitSalesPrice : entry.amount) },
  ];
  if (entry.type === 'return_inward' || entry.type === 'return_outward') {
    rows.unshift(
      { label: 'Quantity returned', value: typeof entry.unitsSold === 'number' ? String(entry.unitsSold) : 'Not recorded' },
      { label: entry.type === 'return_outward' ? 'Current supplier credit per unit' : 'Unit return price', value: typeof entry.unitSalesPrice === 'number' ? formatAmount(entry.unitSalesPrice) : 'Not recorded' },
    );
    if (entry.type === 'return_inward') rows.push(
      { label: 'VAT reversed', value: formatAmount(getEntryVAT(entry)) },
      { label: 'Gross return amount (P&L basis)', value: formatAmount(getGrossSaleValue(entry)) },
    );
    if (entry.type === 'return_outward') {
      rows.push(
        { label: 'Base-cost snapshot per unit', value: typeof entry.baseCostSnapshot === 'number' ? formatAmount(entry.baseCostSnapshot) : 'Not recorded' },
        { label: 'Returned inventory at landed cost', value: typeof entry.returnLandedCost === 'number' ? formatAmount(entry.returnLandedCost) : 'Not recorded' },
        { label: 'Supplier return expense', value: typeof entry.returnLandedCost === 'number' ? formatAmount(getSupplierReturnExpense(entry)) : 'Not calculated — landed cost not recorded' },
      );
      if (typeof entry.supplierCreditOriginalAmount === 'number') {
        rows.push({ label: 'Credit recorded before base-cost correction', value: formatAmount(entry.supplierCreditOriginalAmount) });
      }
    }
  } else if (entry.type === 'sale' || entry.type === 'credit_sale') {
    rows.unshift(
      { label: 'Quantity sold', value: String(entry.unitsSold ?? 0) },
      { label: 'Unit sale price', value: typeof entry.unitSalesPrice === 'number' ? formatAmount(entry.unitSalesPrice) : 'Not recorded' },
    );
    if (typeof entry.vatPaid === 'number' || (typeof entry.unitsSold === 'number' && typeof entry.unitSalesPrice === 'number')) {
      rows.push(
        { label: 'VAT (7.5% of base sale)', value: formatAmount(getEntryVAT(entry)) },
         { label: 'Customer total (base sale + VAT)', value: formatAmount(getGrossSaleValue(entry)) },
      );
    }
  } else if (entry.type === 'purchase' || entry.type === 'credit_purchase') {
    rows.unshift(
      { label: 'Quantity purchased', value: String(entry.unitsPurchased ?? 0) },
      { label: 'Unit purchase price', value: typeof entry.unitPurchasePrice === 'number' ? formatAmount(entry.unitPurchasePrice) : 'Not recorded' },
    );
    const pn = (k: string) => Number((entry as any)[k] ?? 0) || 0;
    rows.push(
      { label: 'Base purchase cost', value: formatAmount(getPurchaseBaseCost(entry)) },
      { label: 'Purchase VAT (7.5%)', value: formatAmount(pn('purchaseVAT')) },
      { label: 'Withholding tax (5%)', value: formatAmount(pn('withholdingTax')) },
      { label: 'Supplier payable', value: formatAmount(supplierPurchasePayable(entry)) },
    );
    if (entry.materialCosts?.length) rows.push({ label: 'Material / other costs', value: formatAmount(entry.materialCosts.reduce((sum, cost) => sum + cost, 0)) });
    if (typeof entry.carriageInward === 'number') rows.push({ label: 'Carriage', value: formatAmount(entry.carriageInward) });
    if (typeof entry.handlingCost === 'number') rows.push({ label: 'Handling', value: formatAmount(entry.handlingCost) });
  }
  if (MODE_TYPES.includes(entry.type)) rows.push({ label: 'Mode of Payment', value: getPaymentModeLabel(entry) });
  if (entry.partyName) rows.push({ label: 'Party', value: `${entry.partyName}${entry.partyPhone ? ` · ${entry.partyPhone}` : ''}` });
  if (entry.notes) rows.push({ label: 'Notes', value: entry.notes });
  return rows;
}

function safeBusinessName(value: string): string {
  return (value || 'Business').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Business';
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}

function pad(n: number) { return String(n).padStart(2, '0'); }
function dateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function previousDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() - 1);
  return dateStr(date);
}

function getDateBounds(period: ReportPeriod, custom?: { start: string; end: string }, accountingYearEnd = '12-31'): { start: string; end: string } {
  const now = new Date();
  const today = dateStr(now);
  if (period === 'custom' && custom) return custom;
  if (period === 'daily') return { start: today, end: today };
  if (period === 'weekly') {
    const start = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return { start: dateStr(start), end: today };
  }
  if (period === 'monthly') {
    return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: today };
  }
  return getAccountingYearToDate(today, accountingYearEnd);
}

function parseDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fmtRangeDate(s: string): string {
  return parseDateStr(s).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getReportEndDate(period: ReportPeriod, custom?: { start: string; end: string }): string {
  const d = period === 'custom' && custom ? parseDateStr(custom.end) : new Date();
  return d.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function filterEntries(entries: Entry[], period: ReportPeriod, custom?: { start: string; end: string }, accountingYearEnd = '12-31'): Entry[] {
  const { start, end } = getDateBounds(period, custom, accountingYearEnd);
  return entries.filter(e => e.date >= start && e.date <= end);
}

// ── PDF generator ─────────────────────────────────────────────────────────────

function buildPDF(
  reportView: ReportView,
  reportEndDate: string,
  businessName: string,
  businessAddress: string,
  businessPhone: string,
  statementRevenue: number,
  costOfGoodsSold: number, expenses: number, operatingProfit: number, interestOnLoan: number,
  grossProfit: number, profitBeforeTax: number,
  taxLabel: string, incomeTax: number, profitAfterTax: number,
  creditSalesTotal: number,
  creditSalePaymentsTotal: number,
  creditPurchasesTotal: number,
  creditPurchasePaymentsTotal: number,
  cashFlowData: CashFlowReportData,
  vatCashSalesTotal: number,
  vatCreditSalesTotal: number,
  vatReturnsTotal: number,
  vatPaymentsTotal: number,
  totalVat: number,
  outstandingSales: number,
  outstandingPurchases: number,
  latestCreditDateStr: string,
  returnInwardEntries: Entry[],
  returnOutwardEntries: Entry[],
  whtEntries: Entry[] = [],
  taxBasis: { profit: number; previousTax: number } = { profit: profitBeforeTax, previousTax: 0 },
  statementPeriod = '',
  assetDisposalProfit = 0,
  estimatedTax = 0,
  pnlYearLabel = '',
  breakdown?: ReturnType<typeof buildPnLReport>,
): string {
  const isProfit = reportView === 'returns_inward' || reportView === 'returns_outward' || (reportView === 'cash_flow'
    ? cashFlowData.netOperatingCashFlow >= 0
    : profitAfterTax >= 0);
  const green = '#15803D';
  const red = '#B91C1C';
  const n = (v: number) => `₦${Math.abs(v).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const amount = (v: number, sign = '') => `${sign}${n(v)}`;
  const pnlAmount = (v: number, sign = '') => `${sign}${fmtPnlNaira(v)}`;
  const generated = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
  const esc = (value: unknown): string => String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const statementTitle = reportView === 'pnl' ? 'Profit or Loss Statement'
    : reportView === 'cash_flow' ? 'Statement of Cash Flow'
    : reportView === 'credit_sales' ? 'Debtors Statement'
    : reportView === 'credit_purchases' ? 'Creditors Statement'
    : reportView === 'returns_inward' ? 'Returns Inward Report'
    : reportView === 'returns_outward' ? 'Returns Outward Report'
    : reportView === 'wht' ? 'Withholding Tax Statement'
    : reportView === 'vat' ? 'VAT Statement' : 'PIT Statement';
  const inwardGross = returnInwardEntries.reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
  const inwardVat = returnInwardEntries.reduce((sum, entry) => sum + getEntryVAT(entry), 0);
  const outwardCredit = returnOutwardEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const outwardRecordedCost = returnOutwardEntries.reduce((sum, entry) => sum + (entry.returnLandedCost ?? 0), 0);
  const outwardExpense = returnOutwardEntries.reduce((sum, entry) => sum + getSupplierReturnExpense(entry), 0);
  const outwardMissingCost = returnOutwardEntries.filter(entry => typeof entry.returnLandedCost !== 'number').length;
  const whtNum = (e: Entry, k: 'withholdingTax' | 'purchaseVAT' | 'supplierPayable') => k === 'supplierPayable' ? supplierPurchasePayable(e) : Number((e as any)[k] ?? 0) || 0;
  const whtTotal = whtEntries.reduce((sum, e) => sum + whtNum(e, 'withholdingTax'), 0);
  const summaryRows = reportView === 'wht'
      ? `<tr><td>Purchases in period</td><td>${whtEntries.length}</td></tr>
         <tr class="total"><td>Total withholding tax withheld</td><td>${n(whtTotal)}</td></tr>`
      : reportView === 'returns_inward'
      ? `<tr><td>Returns inward count</td><td>${returnInwardEntries.length}</td></tr>
         <tr class="negative"><td>Gross returned to customers</td><td>−${n(inwardGross)}</td></tr>
         <tr><td>VAT reversal</td><td>−${n(inwardVat)}</td></tr>`
      : reportView === 'returns_outward'
        ? `<tr><td>Returns outward count</td><td>${returnOutwardEntries.length}</td></tr>
           <tr><td>Supplier credit / refund recorded</td><td>${n(outwardCredit)}</td></tr>
           <tr><td>Returned inventory at recorded landed cost</td><td>${n(outwardRecordedCost)}</td></tr>
           <tr class="negative"><td>Supplier return expenses</td><td>${n(outwardExpense)}</td></tr>
           <tr><td>Returns missing recorded landed cost</td><td>${outwardMissingCost}</td></tr>`
      : reportView === 'pnl'
         ? `<tr class="revenue"><td>Revenue</td><td>${fmtPnlNaira(statementRevenue)}</td></tr>
        ${breakdown ? `<tr><td>Opening stock</td><td>${fmtPnlNaira(breakdown.openingStock)}</td></tr><tr><td>Purchases (net of supplier returns)</td><td>${fmtPnlNaira(breakdown.purchases)}</td></tr>${breakdown.inventoryIntroductions ? `<tr><td>Stock introductions</td><td>${fmtPnlNaira(breakdown.inventoryIntroductions)}</td></tr>` : ''}<tr><td>Less closing stock</td><td>(${fmtPnlNaira(breakdown.closingStock)})</td></tr>` : ''}
         <tr><td>Cost of Sales</td><td>${costOfGoodsSold < 0 ? `+${fmtPnlNaira(costOfGoodsSold)}` : `(${fmtPnlNaira(costOfGoodsSold)})`}</td></tr>
          <tr class="subtotal ${grossProfit < 0 ? 'negative' : ''}"><td>${grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss'}</td><td>${pnlAmount(grossProfit)}</td></tr>
        <tr class="negative"><td>Operating Expenses</td><td>(${fmtPnlNaira(Math.abs(expenses))})</td></tr>
        ${breakdown ? `<tr><td>Cash / bank operating expenses</td><td>${fmtPnlNaira(breakdown.cashOperatingExpenses)}</td></tr><tr><td>Non-cash / unpaid operating expenses</td><td>${fmtPnlNaira(breakdown.nonCashOperatingExpenses)}</td></tr>` : ''}
         <tr><td>Gain/(loss) on asset disposals</td><td>${assetDisposalProfit < 0 ? '(' : ''}${fmtPnlNaira(assetDisposalProfit)}${assetDisposalProfit < 0 ? ')' : ''}</td></tr>
         <tr class="subtotal ${operatingProfit < 0 ? 'negative' : ''}"><td>${operatingProfit >= 0 ? 'Operating Profit' : 'Operating Loss'}</td><td>${pnlAmount(operatingProfit)}</td></tr>
         <tr><td>Finance Costs</td><td>(${fmtPnlNaira(Math.abs(interestOnLoan))})</td></tr>
         <tr class="subtotal ${profitBeforeTax < 0 ? 'negative' : ''}"><td>${profitBeforeTax >= 0 ? 'Profit Before Tax' : 'Loss Before Tax'}</td><td>${pnlAmount(profitBeforeTax)}</td></tr>
         <tr><td>Recorded income tax — ${esc(taxLabel)}</td><td>${incomeTax < 0 ? `+${fmtPnlNaira(-incomeTax)}` : `(${fmtPnlNaira(incomeTax)})`}</td></tr>
           <tr class="total ${profitAfterTax < 0 ? 'negative' : ''}"><td>${profitAfterTax >= 0 ? 'Profit' : 'Loss'} for the period (after recorded income tax)</td><td>${pnlAmount(profitAfterTax, profitAfterTax >= 0 ? '+' : '−')}</td></tr>`
      : reportView === 'cash_flow'
        ? `<tr><td>Opening cash balance (derived)</td><td>${n(cashFlowData.openingCash)}</td></tr>
           <tr class="positive"><td>Cash sales received (gross, including VAT)</td><td>+${n(cashFlowData.cashSales)}</td></tr>
           <tr class="positive"><td>Debtor payments received</td><td>+${n(cashFlowData.debtorPayments)}</td></tr>
           <tr class="positive"><td>Supplier return settlements received</td><td>+${n(cashFlowData.supplierReturnSettlements)}</td></tr>
           <tr class="positive"><td>Customer advances received</td><td>+${n(cashFlowData.workingCapital.advancesReceived)}</td></tr>
           <tr class="subtotal"><td>Total operating cash receipts</td><td>${n(cashFlowData.totalOperatingReceipts)}</td></tr>
           <tr class="negative"><td>Cash purchases (recorded landed cost)</td><td>(${n(cashFlowData.cashPurchases)})</td></tr>
           <tr class="negative"><td>Creditor payments</td><td>(${n(cashFlowData.creditorPayments)})</td></tr>
           <tr class="negative"><td>Customer return refunds</td><td>(${n(cashFlowData.customerReturnRefunds)})</td></tr>
           <tr class="negative"><td>Manual operating expenses</td><td>(${n(cashFlowData.manualExpenses)})</td></tr>
           <tr class="negative"><td>Recorded tax payments</td><td>(${n(cashFlowData.taxPayments)})</td></tr>
           <tr class="negative"><td>Prepayments paid</td><td>(${n(cashFlowData.workingCapital.prepayments)})</td></tr>
           <tr class="negative"><td>Accrued expenses paid</td><td>(${n(cashFlowData.workingCapital.accruedPayments)})</td></tr>
           <tr class="negative"><td>Loan interest paid</td><td>(${n(cashFlowData.workingCapital.interestPaid)})</td></tr>
           <tr class="subtotal"><td>Total operating cash payments</td><td>(${n(cashFlowData.totalOperatingPayments)})</td></tr>
           <tr class="subtotal"><td>Net cash from operating activities</td><td>${amount(cashFlowData.netOperatingCashFlow, cashFlowData.netOperatingCashFlow >= 0 ? '+' : '−')}</td></tr>
           <tr class="negative"><td>Asset acquisitions (investing)</td><td>(${n(cashFlowData.assetAcquisitions)})</td></tr>
            <tr class="positive"><td>Asset disposal proceeds (investing)</td><td>+${n(cashFlowData.assetDisposalProceeds)}</td></tr>
            <tr class="subtotal"><td>Net cash from investing activities</td><td>${amount(cashFlowData.investingCashFlow, cashFlowData.investingCashFlow >= 0 ? '+' : '−')}</td></tr>
           <tr><td>Owner contributions (financing)</td><td>+${n(cashFlowData.ownerContributions)}</td></tr>
           <tr><td>Loan proceeds (financing)</td><td>+${n(cashFlowData.workingCapital.loanReceipts)}</td></tr>
           <tr><td>Owner drawings (financing)</td><td>(${n(cashFlowData.ownerDrawings)})</td></tr>
           <tr><td>Loan principal repaid (financing)</td><td>(${n(cashFlowData.workingCapital.loanRepayments)})</td></tr>
           <tr><td>Net cash from financing activities</td><td>${amount(cashFlowData.financingCashFlow, cashFlowData.financingCashFlow >= 0 ? '+' : '−')}</td></tr>
           <tr class="subtotal"><td>Net change in cash</td><td>${amount(cashFlowData.netChangeInCash, cashFlowData.netChangeInCash >= 0 ? '+' : '−')}</td></tr>
           <tr class="total ${cashFlowData.closingCash < 0 ? 'negative' : ''}"><td>Closing Cash and Bank (recorded)</td><td>${amount(cashFlowData.closingCash, cashFlowData.closingCash < 0 ? '−' : '')}</td></tr>
           <tr><td>Cash-flow reconciliation difference (should be zero)</td><td>${amount(cashFlowData.reconciliationDifference, cashFlowData.reconciliationDifference < 0 ? '−' : '')}</td></tr>`
     : reportView === 'credit_sales'
      ? `<tr class="positive"><td>Debtors (this period)</td><td>+${n(creditSalesTotal)}</td></tr>
         <tr class="positive"><td>Debtors Payment (this period)</td><td>+${n(creditSalePaymentsTotal)}</td></tr>
         <tr class="total"><td>Outstanding Balance (through ${esc(latestCreditDateStr || 'report end')})</td><td>${n(outstandingSales)}</td></tr>`
      : reportView === 'credit_purchases'
        ? `<tr class="positive"><td>Creditors (this period)</td><td>+${n(creditPurchasesTotal)}</td></tr>
           <tr class="positive"><td>Creditors Payment (this period)</td><td>+${n(creditPurchasePaymentsTotal)}</td></tr>
           <tr class="total"><td>Outstanding Balance (through ${esc(latestCreditDateStr || 'report end')})</td><td>${n(outstandingPurchases)}</td></tr>`
        : reportView === 'vat'
           ? `<tr class="positive"><td>Cash-sale VAT additions</td><td>+${n(vatCashSalesTotal)}</td></tr>
               <tr class="positive"><td>Debtors VAT additions</td><td>+${n(vatCreditSalesTotal)}</td></tr>
              <tr class="negative"><td>Return-inward VAT reversals</td><td>−${n(vatReturnsTotal)}</td></tr>
               <tr><td>Debtors payment allocations (reference)</td><td>${n(vatPaymentsTotal)}</td></tr>
              <tr class="total positive"><td>Net sales VAT (before input VAT and remittances)</td><td>+${n(totalVat)}</td></tr>`
          : `<tr><td>Year-to-date profit before tax</td><td>${taxBasis.profit < 0 ? '−' : ''}${pnlAmount(taxBasis.profit)}</td></tr>
             <tr><td>Year-to-date PIT estimate</td><td>${n(calcNigerianPIT(taxBasis.profit))}</td></tr>
             <tr><td>Less tax attributable before this period</td><td>−${n(taxBasis.previousTax)}</td></tr>
             <tr class="total"><td>Estimated PIT for this period</td><td>${n(incomeTax)}</td></tr>`;
  const summaryHeading = reportView === 'cash_flow' ? 'Direct-method statement of cash flows' : 'Statement summary';
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #17221b; margin: 0; font-size: 13px; line-height: 1.6; }
  .brand { color: #13733a; font-size: 26px; font-weight: 800; letter-spacing: -0.4px; margin-bottom: 4px; }
  .brand-mark { color: #13733a; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 8px; }
  .header { border-bottom: 3px solid #13733a; padding-bottom: 24px; margin-bottom: 32px; }
  .header-grid { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .statement { text-align: right; max-width: 60%; }
  .statement h1 { color: #17221b; font-size: 24px; line-height: 1.2; margin: 0 0 12px; }
  .meta { color: #5f6b63; font-size: 12px; margin-bottom: 4px; }
  .business { color: #5f6b63; font-size: 12px; margin-top: 12px; line-height: 1.5; }
  h2 { color: #385044; font-size: 14px; text-transform: uppercase; letter-spacing: 1px; margin: 0 0 16px; border-bottom: 1px solid #d9e2db; padding-bottom: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 32px; }
  tr { page-break-inside: avoid; break-inside: avoid; }
   .summary td { padding: 14px 16px; border-bottom: 1px solid #e8ede9; font-size: 13px; font-weight: 700; }
  .summary td:last-child { text-align: right; font-weight: 700; white-space: nowrap; }
  .summary .subtotal td { background: #f1f6f2; font-weight: 700; border-top: 1px solid #cddbd0; border-bottom: 1px solid #cddbd0; }
  .summary .total td { background: ${isProfit ? '#e8f5e9' : '#ffebee'}; font-size: 15px; font-weight: 800; border-top: 2px solid ${isProfit ? green : red}; }
  .revenue td { color: #13733a; font-weight: 800; }
  .positive td:last-child { color: ${green}; }
  .negative td { color: ${red}; }
  .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #d9e2db; color: #7b887e; font-size: 11px; text-align: center; }
</style></head><body>
  <header class="header"><div class="header-grid">
     <div>
      <div class="brand">${esc(businessName || 'Business')}</div>
      <div class="brand-mark">Powered by ProfitNaija</div>
      <div class="business">${esc(businessName || 'Business')}<br/>${businessAddress ? esc(businessAddress) + '<br/>' : ''}${businessPhone ? esc(businessPhone) : ''}</div>
    </div>
     <div class="statement">
       <h1>${statementTitle}${reportView === 'pnl' ? `, for ${esc(pnlYearLabel)}` : ''}</h1>
      <div class="meta">Generated: ${esc(generated)}</div>
    </div>
  </div></header>
   <h2>${summaryHeading}</h2><table class="summary"><tbody>${summaryRows}</tbody></table>
    ${statementPeriod ? `<p class="meta">${esc(statementPeriod)}</p>` : ''}
   <footer class="footer">Powered by ProfitNaija · ${esc(statementTitle.replace('&amp;', '&'))} · Generated ${esc(generated)}</footer>
</body></html>`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PLRow({
  label, value, sign, color, labelColor, bold = true, separator, indent, onPress,
}: {
  label: string; value: number; sign: '+' | '−' | ''; color: string;
  labelColor?: string;
  bold?: boolean; separator?: boolean; indent?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const content = (
    <View style={[plStyles.row, separator && plStyles.rowSep, { borderColor: colors.border }]}>
      <Text style={[
        plStyles.rowLabel,
        { color: labelColor ?? (indent ? colors.mutedForeground : colors.foreground) },
        bold && plStyles.rowBold,
      ]}>
        {indent ? '  ' : ''}{label}
      </Text>
      <Text style={[plStyles.rowValue, { color }, bold && plStyles.rowBold]}>
        {sign}{fmtPnlNaira(value)}
      </Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{content}</Pressable> : content;
}

function ReportMetricRow({
  label,
  value,
  helperText,
  valueColor,
  bold = false,
  stacked = false,
  onPress,
}: {
  label: string;
  value: string;
  helperText?: string;
  valueColor?: string;
  bold?: boolean;
  stacked?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const labelContent = (
    <View style={plStyles.rowLabelGroup}>
      <Text style={[
        plStyles.rowLabel,
        stacked && plStyles.stackedLabel,
        { color: colors.mutedForeground },
        bold && plStyles.rowBold,
      ]}>
        {label}
      </Text>
    </View>
  );
  const row = (
    <View style={[plStyles.row, stacked && plStyles.stackedRow, { borderColor: colors.border }]}>
      {labelContent}
      <Text style={[
        plStyles.rowValue,
        stacked && plStyles.stackedValue,
        { color: valueColor ?? colors.foreground },
        bold && plStyles.rowBold,
      ]}>
        {value}
      </Text>
    </View>
  );
  return onPress ? <Pressable onPress={onPress} accessibilityRole="button">{row}</Pressable> : row;
}

const plStyles = StyleSheet.create({
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13 },
  rowLabelGroup: { flex: 1, minWidth: 0, paddingRight: 12 },
  stackedRow: { flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  rowSep:   { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4, paddingTop: 14 },
  rowLabel: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  rowHelper: { fontSize: 10, lineHeight: 14, fontFamily: 'Inter_400Regular', marginTop: 2 },
  rowValue: { flexShrink: 0, maxWidth: '45%', textAlign: 'right', fontSize: 15, lineHeight: 21, fontFamily: 'Inter_600SemiBold' },
  stackedLabel: { width: '100%', paddingRight: 0 },
  stackedValue: { maxWidth: '100%', width: '100%', textAlign: 'left' },
  rowBold:  { fontFamily: 'Inter_700Bold', fontSize: 15 },
});

// ── Custom range picker ──────────────────────────────────────────────────────

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAYS = ['S','M','T','W','T','F','S'];

function MiniCalendar({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const colors = useColors();
  const sel = parseDateStr(value);
  const [viewYear, setViewYear]   = useState(sel.getFullYear());
  const [viewMonth, setViewMonth] = useState(sel.getMonth());

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const prevMonth = () => {
    Haptics.selectionAsync();
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    Haptics.selectionAsync();
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  return (
    <View>
      <View style={calStyles.header}>
        <Pressable onPress={prevMonth} hitSlop={8} style={[calStyles.navBtn, { backgroundColor: colors.secondary }]}>
          <Feather name="chevron-left" size={18} color={colors.primary} />
        </Pressable>
        <Text style={[calStyles.headerTxt, { color: colors.foreground }]}>
          {MONTH_NAMES[viewMonth]} {viewYear}
        </Text>
        <Pressable onPress={nextMonth} hitSlop={8} style={[calStyles.navBtn, { backgroundColor: colors.secondary }]}>
          <Feather name="chevron-right" size={18} color={colors.primary} />
        </Pressable>
      </View>
      <View style={calStyles.weekRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={[calStyles.weekday, { color: colors.mutedForeground }]}>{w}</Text>
        ))}
      </View>
      <View style={calStyles.grid}>
        {cells.map((day, i) => {
          if (day === null) return <View key={i} style={calStyles.cell} />;
          const cellStr = `${viewYear}-${pad(viewMonth + 1)}-${pad(day)}`;
          const isSelected = cellStr === value;
          return (
            <Pressable
              key={i}
              onPress={() => { Haptics.selectionAsync(); onChange(cellStr); }}
              style={[calStyles.cell, isSelected && { backgroundColor: colors.primary, borderRadius: 999 }]}
            >
              <Text style={[
                calStyles.cellTxt,
                { color: isSelected ? '#fff' : colors.foreground },
                isSelected && { fontFamily: 'Inter_700Bold' },
              ]}>
                {day}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const calStyles = StyleSheet.create({
  header:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  headerTxt: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  navBtn:    { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  weekRow:   { flexDirection: 'row', marginBottom: 4 },
  weekday:   { flex: 1, textAlign: 'center', fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  grid:      { flexDirection: 'row', flexWrap: 'wrap' },
  cell:      { width: `${100 / 7}%`, aspectRatio: 1.15, alignItems: 'center', justifyContent: 'center' },
  cellTxt:   { fontSize: 13, fontFamily: 'Inter_400Regular' },
});

function lastQuarterRange(): { start: string; end: string } {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3); // current quarter 0..3
  const startMonth = (q - 1) * 3;
  const s = new Date(now.getFullYear(), startMonth, 1);
  const e = new Date(now.getFullYear(), startMonth + 3, 0);
  return { start: dateStr(s), end: dateStr(e) };
}

const rangePresets = (accountingYearEnd: string): { label: string; get: () => { start: string; end: string } }[] => [
  {
    label: 'Last month',
    get: () => {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: dateStr(s), end: dateStr(e) };
    },
  },
  { label: 'Last quarter', get: lastQuarterRange },
  {
    label: 'Previous year',
    get: () => {
      return getPreviousAccountingYear(dateStr(new Date()), accountingYearEnd);
    },
  },
  {
    label: 'Year to date',
    get: () => {
      return getAccountingYearToDate(dateStr(new Date()), accountingYearEnd);
    },
  },
];

function CustomRangeModal({
  visible, initialStart, initialEnd, onApply, onClose, accountingYearEnd = '12-31',
}: {
  visible: boolean;
  initialStart: string;
  initialEnd: string;
  onApply: (start: string, end: string) => void;
  onClose: () => void;
  accountingYearEnd?: string;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [start, setStart] = useState(initialStart);
  const [end, setEnd]     = useState(initialEnd);
  const [editing, setEditing] = useState<'start' | 'end'>('start');

  // Re-sync local state whenever the modal is (re)opened
  const [wasVisible, setWasVisible] = useState(false);
  if (visible && !wasVisible) {
    setWasVisible(true);
    setStart(initialStart);
    setEnd(initialEnd);
    setEditing('start');
  } else if (!visible && wasVisible) {
    setWasVisible(false);
  }

  const invalid = start > end;

  const applyPreset = (p: { start: string; end: string }) => {
    Haptics.selectionAsync();
    setStart(p.start);
    setEnd(p.end);
  };

  const handlePick = (v: string) => {
    if (editing === 'start') {
      setStart(v);
      if (v > end) setEnd(v);
      setEditing('end');
    } else {
      setEnd(v);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={rangeStyles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[rangeStyles.sheet, { backgroundColor: colors.card, paddingBottom: (Platform.OS === 'web' ? 24 : insets.bottom) + 16 }]}>
          <View style={[rangeStyles.handle, { backgroundColor: colors.border }]} />
          <Text style={[rangeStyles.title, { color: colors.foreground }]}>Custom date range</Text>

          {/* Quick presets */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={rangeStyles.presetRow}>
            {rangePresets(accountingYearEnd).map(p => (
              <Pressable
                key={p.label}
                onPress={() => applyPreset(p.get())}
                style={[rangeStyles.presetChip, { backgroundColor: colors.secondary }]}
              >
                <Text style={[rangeStyles.presetTxt, { color: colors.primary }]}>{p.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Start / End toggle */}
          <View style={[rangeStyles.toggleRow, { backgroundColor: colors.secondary }]}>
            {(['start', 'end'] as const).map(k => {
              const active = editing === k;
              const val = k === 'start' ? start : end;
              return (
                <Pressable
                  key={k}
                  onPress={() => { Haptics.selectionAsync(); setEditing(k); }}
                  style={[rangeStyles.toggleBtn, active && { backgroundColor: colors.card }]}
                >
                  <Text style={[rangeStyles.toggleLabel, { color: colors.mutedForeground }]}>
                    {k === 'start' ? 'From' : 'To'}
                  </Text>
                  <Text style={[
                    rangeStyles.toggleValue,
                    { color: active ? colors.primary : colors.foreground },
                  ]}>
                    {fmtRangeDate(val)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <MiniCalendar
            key={editing + (editing === 'start' ? start : end)}
            value={editing === 'start' ? start : end}
            onChange={handlePick}
          />

          {invalid && (
            <Text style={[rangeStyles.errorTxt, { color: colors.expense }]}>
              Start date must be on or before the end date
            </Text>
          )}

          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onApply(start, end); }}
            disabled={invalid}
            style={({ pressed }) => [
              rangeStyles.applyBtn,
              { backgroundColor: colors.primary, opacity: invalid ? 0.4 : pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={rangeStyles.applyTxt}>Apply range</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const rangeStyles = StyleSheet.create({
  backdrop:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:     { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10 },
  handle:    { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  title:     { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 12 },
  presetRow: { gap: 8, paddingBottom: 14 },
  presetChip:{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999 },
  presetTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  toggleRow: { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4, marginBottom: 14 },
  toggleBtn: { flex: 1, borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  toggleLabel:{ fontSize: 11, fontFamily: 'Inter_500Medium' },
  toggleValue:{ fontSize: 13, fontFamily: 'Inter_600SemiBold', marginTop: 2 },
  errorTxt:  { fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center', marginTop: 6 },
  applyBtn:  { borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginTop: 12 },
  applyTxt:  { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
});

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ReportScreen({ taxCenter = false }: { taxCenter?: boolean } = {}) {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const { entries, products, loading, correctSupplierReturnLandedCost } = useEntries();
  const { profile } = useProfile();
  const { hasProAccess } = useBilling();

  const { period: paramPeriod, view: paramView } = useLocalSearchParams<{ period?: string; view?: string }>();
  const router = useRouter();
  const visibleViews = REPORT_VIEWS.filter(item => taxCenter === ['vat', 'wht', 'tax'].includes(item.key));
  const defaultView: ReportView = taxCenter ? 'vat' : 'pnl';
  const [period, setPeriod]     = useState<ReportPeriod>(
    (['daily','weekly','monthly','yearly'].includes(paramPeriod ?? '')
      ? paramPeriod as ReportPeriod : 'monthly')
  );
  const [reportView, setReportView] = useState<ReportView>(
    (visibleViews.some(item => item.key === paramView) ? paramView as ReportView : defaultView),
  );
  useEffect(() => {
    if (!taxCenter && ['vat', 'wht', 'tax'].includes(paramView ?? '')) {
      router.replace({ pathname: '/(tabs)/tax-center', params: { view: paramView!, ...(paramPeriod ? { period: paramPeriod } : {}) } });
      return;
    }
    setReportView(visibleViews.some(item => item.key === paramView) ? paramView as ReportView : defaultView);
  }, [paramView, taxCenter]);
  const [generating, setGenerating] = useState(false);
  const [sharing, setSharing]       = useState(false);
  const [selectedParty, setSelectedParty] = useState<Entry | null>(null);
  const [selectedPnlDetail, setSelectedPnlDetail] = useState<{ title: string; entries: Entry[]; note?: string; details?: Array<{ label: string; value: string }> } | null>(null);
  const [returnCostDrafts, setReturnCostDrafts] = useState<Record<string, string>>({});
  const [returnCostErrors, setReturnCostErrors] = useState<Record<string, string>>({});
  const [savingReturnCostId, setSavingReturnCostId] = useState<string | null>(null);

  // Custom date range (defaults to current month so far)
  const [customRange, setCustomRange] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    return { start: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, end: dateStr(now) };
  });
  const [rangeModalVisible, setRangeModalVisible] = useState(false);

  const topInset    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  // ── Filtered data ────────────────────────────────────────────────────────
  const accountingYearEnd = taxCenter ? '12-31' : profile.accountingYearEnd;
  const filtered   = useMemo(() => filterEntries(entries, period, customRange, accountingYearEnd), [entries, period, customRange, accountingYearEnd]);
  const pnlEntries = useMemo(
    () => filtered.filter(e =>
      e.type === 'sale' ||
      e.type === 'credit_sale' ||
      e.type === 'credit_sale_payment' ||
      e.type === 'purchase' ||
      e.type === 'credit_purchase' ||
      e.type === 'credit_purchase_payment' ||
      e.type === 'return_inward' ||
      e.type === 'return_outward' ||
      isDirectExpenseEntry(e),
    ),
    [filtered],
  );
  const reportEndDate = useMemo(() => getReportEndDate(period, customRange), [period, customRange]);
  const creditSales = useMemo(() => filtered.filter(e => e.type === 'credit_sale'), [filtered]);
  const creditSalePayments = useMemo(() => filtered.filter(e => e.type === 'credit_sale_payment'), [filtered]);
  const creditPurchases = useMemo(() => filtered.filter(e => e.type === 'credit_purchase' || isCreditExpenseEntry(e)), [filtered]);
  const creditPurchasePayments = useMemo(() => filtered.filter(e => e.type === 'credit_purchase_payment'), [filtered]);
  const { start: reportStart, end: reportEnd } = getDateBounds(period, customRange, accountingYearEnd);
  const taxControls = buildTaxControlLedger(entries.map(e => ({ ...e, outputVAT: getEntryVAT(e) })), reportStart, reportEnd);
  const selectedTaxType: TaxType = reportView === 'wht' ? 'wht' : reportView === 'tax' ? 'income_tax' : 'vat';
  const selectedTaxControl = taxControls.find(c => c.taxType === selectedTaxType)!;
  const partySummary = useMemo(() => {
    if (!selectedParty) return null;
    const isCustomer = selectedParty.type === 'credit_sale' || selectedParty.type === 'credit_sale_payment';
    const kind = isCustomer ? 'customer' : 'supplier';
    const phone = normalizeNigerianPhone(selectedParty.partyPhone);
    const name = normalizePartyName(selectedParty.partyName);
    const matches = (entry: Entry) => {
      if (entry.date > reportEnd) return false;
      const entryPhone = normalizeNigerianPhone(entry.partyPhone);
      return (entry.type === (isCustomer ? 'credit_sale' : 'credit_purchase') || (!isCustomer && isCreditExpenseEntry(entry))) && (
        phone ? entryPhone === phone : (!entryPhone && normalizePartyName(entry.partyName) === name)
      );
    };
    const originals = entries.filter(matches);
    const originalKeys = new Set(originals.map(e => `${e.type === 'expense' ? 'expense' : isCustomer ? 'sale' : 'purchase'}:${e.id}`));
    const payments = entries.filter(e => e.date <= reportEnd &&
      e.type === (isCustomer ? 'credit_sale_payment' : 'credit_purchase_payment') &&
      !!e.linkedCreditEntryId && originalKeys.has(`${e.linkedCreditKind ?? (isCustomer ? 'sale' : 'purchase')}:${e.linkedCreditEntryId}`));
    const bought = originals.reduce((sum, e) => sum + (isCustomer ? getSaleValue(e) : creditorAmount(e)), 0);
    const paid = payments.reduce((sum, e) => sum + e.amount, 0);
    return { kind, name: selectedParty.partyName || (isCustomer ? 'Customer' : 'Supplier'), phone: selectedParty.partyPhone || '', bought, paid, remaining: Math.max(0, bought - paid) };
  }, [selectedParty, entries, reportEnd]);
  const vatLedger = useMemo(() => buildVATLedger(filtered, products, entries), [filtered, products, entries]);
  const totalCreditSales = creditSales.reduce((sum, entry) => sum + getSaleValue(entry), 0);
  const totalCreditSalePayments = creditSalePayments.reduce((sum, entry) => sum + entry.amount, 0);
  const totalCreditPurchases = creditPurchases.reduce((sum, entry) => sum + creditorAmount(entry), 0);
  const totalCreditPurchasePayments = creditPurchasePayments.reduce((sum, entry) => sum + entry.amount, 0);
  const totalVat = vatLedger.reduce((sum, row) => sum + (row.direction === 'deduction' ? -row.vatAmount : row.direction === 'addition' ? row.vatAmount : 0), 0);
  const reportTitle = REPORT_VIEWS.find(item => item.key === reportView)?.label ?? 'Report';
  const isProReport = reportView !== 'pnl' && reportView !== 'cash_flow';

  // Keep gross ledger revenue for the reconciliation, and use dashboard-basis
  // revenue for the P&L and all profit calculations.
  const creditBalanceEntries = entries.filter(entry => entry.date <= reportEnd);
  const outstandingCreditSales = getOutstandingCredits(creditBalanceEntries, 'sale', undefined, true)
    .reduce((sum, credit) => sum + credit.remainingBalance, 0);
  const outstandingCreditPurchases = getOutstandingCredits(creditBalanceEntries, 'purchase', undefined, true)
    .reduce((sum, credit) => sum + credit.remainingBalance, 0);
  const pnlReport = useMemo(() => buildPnLReport(entries, filtered, products, reportEnd, reportStart), [entries, filtered, products, reportEnd, reportStart]);
  const statementRevenue = pnlReport.statementRevenue;
  const costOfGoodsSold = pnlReport.cost;
  const expenses = pnlReport.operatingExpenses;
  const operatingProfit = pnlReport.operatingProfit;
  const interestOnLoan = pnlReport.interestOnLoan;
  const grossProfit = pnlReport.grossProfit;
  const profitBeforeTax = pnlReport.profitBeforeTax;
  // Income tax — Nigeria Tax Act 2025 PIT bands effective 1 January 2026
  const incomeTax = pnlReport.tax;
  const effectiveRate = profitBeforeTax > 0 ? ((incomeTax / profitBeforeTax) * 100).toFixed(1) : '0';
  const taxLabel = `Nigeria Tax Act — ${effectiveRate}% effective`;
  const profitAfterTax = pnlReport.profitAfterTax;
  const isProfit  = profitAfterTax >= 0;
  const isRevenueEntry = (entry: Entry) =>
    entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_inward'
    || entry.finance?.kind==='working_capital'&&entry.finance.account==='unearned_revenue'&&entry.finance.action==='release';
  const isCostEntry = (entry: Entry) =>
    entry.type === 'purchase' || entry.type === 'credit_purchase' || entry.type === 'return_outward';
  const isOperatingExpenseEntry = (entry: Entry) =>
    (isDirectExpenseEntry(entry) && entry.category?.toLowerCase() !== 'interest on loan') || getSupplierReturnExpense(entry) > 0
    || entry.finance?.kind==='working_capital'&&(entry.finance.account==='prepayment'&&entry.finance.action==='release'||entry.finance.account==='accrual'&&entry.finance.action==='increase');
  const isFinanceCostEntry = (entry: Entry) =>
    isDirectExpenseEntry(entry) && entry.category?.toLowerCase() === 'interest on loan'
    || entry.finance?.kind==='working_capital'&&entry.finance.action==='interest';
  const purchasesTotal = calcCostBalance(filtered, products);
  const closingStock = calcInventoryValueAsOf(products, entries, reportEnd);
  const periodPurchaseEntries = filtered.filter(entry => entry.type === 'purchase' || entry.type === 'credit_purchase');
  const cashPurchaseBase = filtered.filter(entry => entry.type === 'purchase').reduce((sum, entry) => sum + getPurchaseBaseCost(entry), 0);
  const creditPurchaseBase = filtered.filter(entry => entry.type === 'credit_purchase').reduce((sum, entry) => sum + getPurchaseBaseCost(entry), 0);
  const materialOtherCosts = periodPurchaseEntries.reduce((sum, entry) => sum + (entry.materialCosts?.reduce((subtotal, value) => subtotal + value, 0) ?? 0), 0);
  const carriageCosts = periodPurchaseEntries.reduce((sum, entry) => sum + (entry.carriageInward ?? 0), 0);
  const handlingCosts = periodPurchaseEntries.reduce((sum, entry) => sum + (entry.handlingCost ?? 0), 0);
  const returnsOutwardCost = filtered.filter(entry => entry.type === 'return_outward')
    .reduce((sum, entry) => sum + getInventoryMovementCost(entry, products), 0);
  const whtEntries = filtered.filter(entry => entry.type === 'purchase' || entry.type === 'credit_purchase');
  const returnInwardEntries = filtered.filter(entry => entry.type === 'return_inward');
  const returnOutwardEntries = filtered.filter(entry => entry.type === 'return_outward');
  const returnedGrossTotal = returnInwardEntries.reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
  const returnVatReversalTotal = returnInwardEntries.reduce((sum, entry) => sum + getEntryVAT(entry), 0);
  const supplierReturnCreditTotal = returnOutwardEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const recordedReturnLandedCostTotal = returnOutwardEntries.reduce(
    (sum, entry) => sum + (typeof entry.returnLandedCost === 'number' ? entry.returnLandedCost : 0), 0,
  );
  const supplierReturnExpenseTotal = returnOutwardEntries.reduce((sum, entry) => sum + getSupplierReturnExpense(entry), 0);
  const missingReturnLandedCostCount = returnOutwardEntries.filter(entry => typeof entry.returnLandedCost !== 'number').length;
  const grossSaleValue = getGrossSaleValue;
  const cashFlowData: CashFlowReportData = buildDirectCashFlow(entries, filtered, reportStart,reportEnd);
  const cashFlowEntries = filtered.filter(entry => entry.ledgerStatus !== 'void' && (!cashFlowData.openingDate || entry.date > cashFlowData.openingDate));
  const ownerFinancingEntries = cashFlowEntries.filter(entry => entry.type === 'owner_contribution' || entry.type === 'owner_drawings');
  const cashFlowWorkingEntries = cashFlowEntries.filter(entry => entry.finance?.kind==='working_capital');
  const cashFlowLoanReceipts = cashFlowWorkingEntries.filter(entry => entry.finance?.kind==='working_capital'&&entry.finance.account==='loan'&&entry.finance.action==='increase');
  const cashFlowLoanRepayments = cashFlowWorkingEntries.filter(entry => entry.finance?.kind==='working_capital'&&entry.finance.account==='loan'&&entry.finance.action==='release');
  const cashFlowPrepayments = cashFlowWorkingEntries.filter(entry => entry.finance?.kind==='working_capital'&&entry.finance.account==='prepayment'&&entry.finance.action==='increase');
  const cashFlowAccrualPayments = cashFlowWorkingEntries.filter(entry => entry.finance?.kind==='working_capital'&&entry.finance.account==='accrual'&&entry.finance.action==='release');
  const cashFlowCustomerAdvances = cashFlowWorkingEntries.filter(entry => entry.finance?.kind==='working_capital'&&entry.finance.account==='unearned_revenue'&&entry.finance.action==='increase');
  const cashFlowLoanInterest = cashFlowWorkingEntries.filter(entry => entry.finance?.kind==='working_capital'&&entry.finance.action==='interest');
  const cashSalesEntries = cashFlowEntries.filter(entry => entry.type === 'sale');
  const cashFlowDebtorPaymentEntries = cashFlowEntries.filter(entry => entry.type === 'credit_sale_payment');
  const cashFlowCashPurchaseEntries = cashFlowEntries.filter(entry => entry.type === 'purchase');
  const cashFlowCreditorPaymentEntries = cashFlowEntries.filter(entry => entry.type === 'credit_purchase_payment');
  const cashFlowCustomerReturnEntries = cashFlowEntries.filter(entry => entry.type === 'return_inward' && !isCreditReturn(entry));
  const cashFlowSupplierReturnEntries = cashFlowEntries.filter(entry => entry.type === 'return_outward' && !isCreditReturn(entry));
  const cashFlowEquipmentEntries = cashFlowEntries.filter(entry =>
    isCashExpenseEntry(entry) && entry.category?.toLowerCase() === 'equipment');
  const cashFlowExpenseEntries = cashFlowEntries.filter(entry => isCashExpenseEntry(entry) &&
    entry.category?.toLowerCase() !== 'equipment');
  const historicalDebtorEntries = creditBalanceEntries.filter(entry => entry.type === 'credit_sale');
  const historicalDebtorPaymentEntries = creditBalanceEntries.filter(entry => entry.type === 'credit_sale_payment');
  const historicalCreditorEntries = creditBalanceEntries.filter(entry => entry.type === 'credit_purchase' || isCreditExpenseEntry(entry));
  const historicalCreditorPaymentEntries = creditBalanceEntries.filter(entry => entry.type === 'credit_purchase_payment');
  const historicalDebtorBalances = getOutstandingCredits(creditBalanceEntries, 'sale', undefined, true);
  const historicalCreditorBalances = getOutstandingCredits(creditBalanceEntries, 'purchase', undefined, true);
  const showReportDetails = (
    title: string,
    sourceEntries: Entry[],
    details: Array<{ label: string; value: string }> = [],
    note?: string,
  ) => setSelectedPnlDetail({
    title,
    entries: sourceEntries,
    details,
    note: note ?? (sourceEntries.length ? undefined : 'This is a calculated statement line and has no source transactions in the selected period.'),
  });
  const showEntryDetails = (entry: Entry, title?: string) => showReportDetails(
    title ?? formatEntryDescription(entry),
    [entry],
    getEntryDetailRows(entry),
    `${fmtDate(entry.date)} · ${entry.type.replace(/_/g, ' ')}`,
  );
  const requestReturnCostCorrection = (entry: Entry) => {
    const rawValue = (returnCostDrafts[entry.id] ?? '').trim().replace(/,/g, '');
    const totalLandedCost = Number(rawValue);
    if (!/^\d+(?:\.\d{1,2})?$/.test(rawValue) || !Number.isFinite(totalLandedCost)) {
      setReturnCostErrors(current => ({ ...current, [entry.id]: 'Enter a valid historical total landed cost, up to two decimal places.' }));
      return;
    }
    if (totalLandedCost < entry.amount) {
      setReturnCostErrors(current => ({ ...current, [entry.id]: `Total landed cost must be at least the supplier credit of ${fmt(entry.amount)}.` }));
      return;
    }
    Alert.alert(
      'Confirm historical landed cost',
      `Save ${fmt(totalLandedCost)} as the TOTAL landed cost for this supplier return? This recalculates historical Purchases and Expenses, without changing the supplier credit or stock quantity.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm & save',
          onPress: async () => {
            setSavingReturnCostId(entry.id);
            setReturnCostErrors(current => ({ ...current, [entry.id]: '' }));
            try {
              await correctSupplierReturnLandedCost(entry.id, totalLandedCost);
              setReturnCostDrafts(current => {
                const next = { ...current };
                delete next[entry.id];
                return next;
              });
            } catch (error: any) {
              setReturnCostErrors(current => ({
                ...current,
                [entry.id]: error?.message ?? 'Could not save this landed-cost correction. Please try again.',
              }));
            } finally {
              setSavingReturnCostId(current => current === entry.id ? null : current);
            }
          },
        },
      ],
    );
  };
  const showPnlDetails = (title: string, predicate: (entry: Entry) => boolean, note?: string) => {
    const details: Array<{ label: string; value: string }> = [];
    if (title === 'Revenue') {
      const lessReturns = filtered.filter(entry => entry.type === 'return_inward')
        .reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
      const netReturns = filtered.filter(entry => entry.type === 'return_inward')
        .reduce((sum, entry) => sum + getSaleValue(entry), 0);
      const grossSales = filtered.filter(entry => entry.type === 'sale' || entry.type === 'credit_sale')
        .reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
      const salesVAT = grossSales - filtered.filter(entry => entry.type === 'sale' || entry.type === 'credit_sale')
        .reduce((sum, entry) => sum + getSaleValue(entry), 0);
      details.push(
        { label: 'Gross cash sales (before VAT)', value: fmtPnlNaira(filtered.filter(entry => entry.type === 'sale').reduce((sum, entry) => sum + getGrossSaleValue(entry), 0)) },
        { label: 'Gross credit sales (before VAT)', value: fmtPnlNaira(creditSales.reduce((sum, entry) => sum + getGrossSaleValue(entry), 0)) },
        { label: 'Total gross sales', value: fmtPnlNaira(grossSales) },
        { label: 'Less: sales VAT', value: `−${fmtPnlNaira(salesVAT)}` },
        { label: 'Sales excluding VAT', value: fmtPnlNaira(grossSales - salesVAT) },
        { label: 'Full customer refunds (including VAT)', value: fmtPnlNaira(lessReturns) },
        { label: 'Return VAT reversed', value: fmtPnlNaira(lessReturns - netReturns) },
        { label: 'Less: returns excluding VAT', value: `−${fmtPnlNaira(netReturns)}` },
        { label: 'Revenue', value: fmtPnlNaira(statementRevenue) },
      );
    } else if (title === 'Cost of Sales') {
      details.push(
        { label: 'Opening stock (value before period)', value: fmtPnlNaira(pnlReport.openingStock) },
        { label: 'Selected-period Purchases', value: fmtPnlNaira(purchasesTotal) },
        ...(pnlReport.inventoryIntroductions ? [{ label: 'Add: opening-stock introductions', value: fmtPnlNaira(pnlReport.inventoryIntroductions) }] : []),
        { label: 'Less: Closing Stock = Stock Value as of report end', value: `−${fmtPnlNaira(closingStock)}` },
        { label: 'Cost of Sales', value: `${costOfGoodsSold < 0 ? '−' : ''}${fmtPnlNaira(costOfGoodsSold)}` },
      );
      note = `Purchases = cash base ${fmtPnlNaira(cashPurchaseBase)} + credit base ${fmtPnlNaira(creditPurchaseBase)} + material/other ${fmtPnlNaira(materialOtherCosts)} + handling ${fmtPnlNaira(handlingCosts)} + carriage ${fmtPnlNaira(carriageCosts)} − returns outward ${fmtPnlNaira(returnsOutwardCost)}.`;
    } else if (title.startsWith('Gross ')) {
      details.push(
        { label: 'Revenue', value: fmtPnlNaira(statementRevenue) },
        { label: costOfGoodsSold < 0 ? 'Add: negative Cost of Sales' : 'Less: Cost of Sales', value: `${costOfGoodsSold < 0 ? '+' : '−'}${fmtPnlNaira(costOfGoodsSold)}` },
        { label: title, value: fmtPnlNaira(grossProfit) },
      );
    } else if (title === 'Operating Expenses') {
      pnlReport.itemizedOperatingExpenses.forEach(row => details.push({ label: row.label, value: fmtPnlNaira(row.value) }));
      details.push({ label: 'Operating Expenses = Expenses', value: fmtPnlNaira(expenses) });
    } else if (title.startsWith('Operating ')) {
      details.push(
        { label: 'Gross Profit', value: fmtPnlNaira(grossProfit) },
        { label: 'Less: Operating Expenses', value: `−${fmtPnlNaira(expenses)}` },
        { label: 'Gain/(loss) on asset disposals', value: `${pnlReport.assetDisposalProfit < 0 ? '−' : '+'}${fmtPnlNaira(pnlReport.assetDisposalProfit)}` },
        { label: title, value: fmtPnlNaira(operatingProfit) },
      );
    } else if (title === 'Finance Costs') {
      details.push({ label: 'Interest on loan expenses', value: fmtPnlNaira(interestOnLoan) });
    } else if (title.includes('Before Tax')) {
      details.push(
        { label: 'Operating Profit', value: fmtPnlNaira(operatingProfit) },
        { label: 'Less: Finance costs', value: `−${fmtPnlNaira(interestOnLoan)}` },
        { label: title, value: fmtPnlNaira(profitBeforeTax) },
      );
    } else if (title === 'Tax') {
      details.push(
        { label: 'Profit before tax', value: fmtPnlNaira(profitBeforeTax) },
        { label: 'Recorded income tax', value: fmtPnlNaira(incomeTax) },
      );
      note = `${taxLabel}. Year-to-date profit before tax: ${fmtPnlNaira(pnlReport.taxBasisProfitBeforeTax)}. Tax attributable before this period: ${fmtPnlNaira(pnlReport.taxBasisPreviousTax)}. The first ₦800,000 of annual profit is taxed at 0%; tax is zero if the year-to-date amount has not exceeded this band or there is a loss. Source: PwC Nigeria individual income tax summary.`;
    } else {
      details.push(
        { label: 'Profit before tax', value: fmtPnlNaira(profitBeforeTax) },
        { label: 'Less: recorded income tax', value: `−${fmtPnlNaira(incomeTax)}` },
        { label: `${profitAfterTax >= 0 ? 'Profit' : 'Loss'} for the period (after recorded income tax)`, value: fmtPnlNaira(profitAfterTax) },
      );
    }
    const sourceEntries = pnlEntries.filter(predicate);
    const roundingNote = 'Amounts are rounded individually; displayed rows may differ by ₦1.';
    setSelectedPnlDetail({
      title,
      entries: sourceEntries,
      note: [note ?? (!sourceEntries.length ? 'This is a calculated statement line and has no source transactions.' : undefined), roundingNote].filter(Boolean).join(' '),
      details,
    });
  };
  const buildReportHTML = () => {
    if (reportView === 'balance_sheet') {
      return buildBalanceSheetHTML(profile.businessName, profile.businessAddress, profile.businessPhone, entries, products, reportEnd);
    }
    const grossPurchase = (e: Entry) => creditorAmount(e);

    return buildPDF(
      reportView,
      reportEndDate,
      profile.businessName, profile.businessAddress, profile.businessPhone,
       statementRevenue, costOfGoodsSold, expenses, operatingProfit, interestOnLoan,
      grossProfit, profitBeforeTax, taxLabel, reportView === 'tax' ? pnlReport.estimatedTax : incomeTax, profitAfterTax,
      creditSales.reduce((s, e) => s + grossSaleValue(e), 0),
      creditSalePayments.reduce((s, e) => s + e.amount, 0),
      creditPurchases.reduce((s, e) => s + grossPurchase(e), 0),
      creditPurchasePayments.reduce((s, e) => s + e.amount, 0),
      cashFlowData,
      vatLedger.filter(row => row.kind === 'cash_sale').reduce((sum, row) => sum + row.vatAmount, 0),
      vatLedger.filter(row => row.kind === 'credit_sale').reduce((sum, row) => sum + row.vatAmount, 0),
      vatLedger.filter(row => row.kind === 'return_inward').reduce((sum, row) => sum + row.vatAmount, 0),
      vatLedger.filter(row => row.kind === 'credit_sale_payment').reduce((sum, row) => sum + row.vatAmount, 0),
      totalVat,
      getOutstandingCredits(creditBalanceEntries, 'sale', undefined, true).reduce((sum, credit) => sum + credit.remainingBalance, 0),
      getOutstandingCredits(creditBalanceEntries, 'purchase', undefined, true).reduce((sum, credit) => sum + credit.remainingBalance, 0),
      fmtDate(creditBalanceEntries.reduce((latest, e) => e.date > latest ? e.date : latest, '')),
      returnInwardEntries,
      returnOutwardEntries,
      whtEntries,
      { profit: pnlReport.taxBasisProfitBeforeTax, previousTax: pnlReport.taxBasisPreviousTax },
      `${reportStart} – ${reportEnd}`,
      pnlReport.assetDisposalProfit,
      pnlReport.estimatedTax,
      profitStatementYearLabel(reportEnd, profile.accountingYearEnd),
      pnlReport,
    ).replace('</body>', ['vat', 'wht', 'tax'].includes(reportView)
      ? `<h2>${selectedTaxType === 'income_tax' ? 'Confirmed income tax' : selectedTaxType.toUpperCase()} account</h2><table>${taxControlRows(selectedTaxControl, reportEnd).map(row => `<tr><td>${row.label}</td><td>${row.value === null ? 'Not available' : fmt(row.value)}</td></tr>`).join('')}</table></body>`
      : '</body>');
  };

  // ── Print ────────────────────────────────────────────────────────────────
  const handlePrint = async () => {
    if (isProReport && !hasProAccess) {
      Alert.alert('Pro Feature', `Upgrade to Pro to export the ${reportView === 'tax' ? 'Tax' : 'Advanced'} report.`);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGenerating(true);
    try {
      const html = buildReportHTML();
      await Print.printAsync({ html });
    } catch (e: any) {
      Alert.alert('Print Error', e?.message ?? 'Could not open print dialog.');
    } finally {
      setGenerating(false);
    }
  };

  // ── PDF download ─────────────────────────────────────────────────────────
  const handleDownloadPDF = async () => {
    if (isProReport && !hasProAccess) {
      Alert.alert('Pro Feature', `Upgrade to Pro to export the ${reportView === 'tax' ? 'Tax' : 'Advanced'} report.`);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setGenerating(true);
    try {
      const html = buildReportHTML();
      const { uri } = await Print.printToFileAsync({ html });
       const filename = `${safeBusinessName(profile.businessName)}-${reportView}-${dateStr(new Date())}.pdf`;
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        anchor.click();
        URL.revokeObjectURL(url);
      } else if (Platform.OS === 'android') {
        const permissions = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permissions.granted) return;
        const target = await FileSystem.StorageAccessFramework.createFileAsync(permissions.directoryUri, filename, 'application/pdf');
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
      } else {
        const target = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.copyAsync({ from: uri, to: target });
      }
      Alert.alert('PDF saved', 'Your report PDF was saved successfully.');
    } catch (e: any) {
      Alert.alert('PDF Error', e?.message ?? 'Could not generate PDF.');
    } finally {
      setGenerating(false);
    }
  };

  // ── Share the generated PDF ───────────────────────────────────────────────
  const handleShare = async () => {
    if (isProReport && !hasProAccess) {
      Alert.alert('Pro Feature', `Upgrade to Pro to export the ${reportView === 'tax' ? 'Tax' : 'Advanced'} report.`);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSharing(true);
    try {
      const html = buildReportHTML();
      const { uri } = await Print.printToFileAsync({ html });
      if (Platform.OS === 'web' || !(await Sharing.isAvailableAsync())) {
        Alert.alert('Share unavailable', 'PDF sharing is not available on this device.');
      } else {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
           dialogTitle: `${profile.businessName || 'Business'} ${reportTitle} Report`,
          UTI: 'com.adobe.pdf',
        });
      }
    } catch (e: any) {
      Alert.alert('Share failed', e?.message ?? 'Could not share report.');
    } finally {
      setSharing(false);
    }
  };

  // ── List sections ────────────────────────────────────────────────────────
  const ListHeader = (
    <View>
      {/* App header */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: topInset + 16 }]}>
        <Animated.View entering={FadeInUp.springify()}>
          <Text style={styles.headerTitle}>{taxCenter ? 'Tax Center' : reportView === 'pnl' ? `Profit or Loss Statement, for ${profitStatementYearLabel(reportEnd, profile.accountingYearEnd)}` : `${reportTitle} Report`}</Text>
           {reportView === 'balance_sheet'
            ? <Text style={styles.headerSub}>As at {reportEnd}</Text>
            : reportView !== 'pnl' && <Text style={styles.headerSub}>{reportStart} – {reportEnd}</Text>}
        </Animated.View>

        {!taxCenter && !profile.accountingYearConfirmed && (
          <Pressable onPress={() => router.push('/profile')} accessibilityRole="button">
            <Text style={[styles.headerSub, { textDecorationLine: 'underline', marginTop: 8 }]}>Confirm your accounting year in Profile</Text>
          </Pressable>
        )}
        {/* Period tabs */}
        <View style={[styles.periodBar, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
          {PERIOD_TABS.map(tab => {
            const active = tab.key === period;
            return (
              <Pressable
                key={tab.key}
                onPress={() => {
                  Haptics.selectionAsync();
                  if (tab.key === 'custom') {
                    setRangeModalVisible(true);
                  } else {
                    setPeriod(tab.key);
                  }
                }}
                style={[styles.periodBtn, active && styles.periodBtnActive]}
              >
                <Text style={[styles.periodBtnTxt, active && styles.periodBtnTxtActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={[styles.reportSelector, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {visibleViews.map(item => {
          const active = reportView === item.key;
          return (
            <Pressable
              key={item.key}
              testID={`report-view-${item.key}`}
              onPress={() => {
                Haptics.selectionAsync();
                setReportView(item.key);
              }}
              style={[
                styles.reportSelectorBtn,
                { backgroundColor: active ? colors.primary : colors.background },
              ]}
              accessibilityHint={item.description}
            >
              <Text style={[styles.reportSelectorLabel, { color: active ? '#fff' : colors.foreground }]}>
                {item.label}
              </Text>
              <Text
                numberOfLines={2}
                style={[styles.reportSelectorDescription, { color: active ? 'rgba(255,255,255,0.72)' : colors.mutedForeground }]}
              >
                {item.description}
              </Text>
              {hasProAccess && ['vat', 'wht', 'tax'].includes(item.key) && <Text style={[styles.reportSelectorDescription, { color: active ? colors.primaryForeground : colors.foreground }]}>
                {item.key === 'tax' ? fmt(pnlReport.estimatedTax) : (() => { const c = taxControls.find(c => c.taxType === item.key)!; return fmt(c.closing ?? c.additions - c.deductions + c.charges - c.credits - c.payments); })()}
                {item.key !== 'tax' && taxControls[0]!.closing === null ? ' (period activity)' : ''}
              </Text>}
            </Pressable>
          );
        })}
      </View>

      {taxCenter && hasProAccess && <TaxControlSummary control={selectedTaxControl} end={reportEnd} estimate={reportView === 'tax' ? pnlReport.estimatedTax : undefined} />}

      {/* P&L statement */}
      {reportView === 'pnl' && (
        <Animated.View entering={FadeInDown.delay(100).springify()}
        style={[styles.plCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <View style={styles.plHeader}>
          <MaterialCommunityIcons name="file-chart-outline" size={18} color={colors.primary} />
           <Text style={[styles.plTitle, { color: colors.foreground }]}>Profit or Loss Statement, for {profitStatementYearLabel(reportEnd, profile.accountingYearEnd)}</Text>
        </View>

        <View style={[styles.plDivider, { backgroundColor: colors.border }]} />

        <PLRow label="Revenue" value={statementRevenue} sign="+" color={colors.primary} labelColor={colors.primary} bold separator onPress={() => showPnlDetails('Revenue', isRevenueEntry)} />
        <PLRow label="Opening stock" value={pnlReport.openingStock} sign="+" color={colors.foreground} indent />
        <PLRow label="Purchases (net of supplier returns)" value={pnlReport.purchases} sign="+" color={colors.foreground} indent />
        {!!pnlReport.inventoryIntroductions && <PLRow label="Stock introductions" value={pnlReport.inventoryIntroductions} sign="+" color={colors.foreground} indent />}
        <PLRow label="Less closing stock" value={pnlReport.closingStock} sign="−" color={colors.expense} indent />
        <PLRow label="Cost of Sales" value={costOfGoodsSold} sign={costOfGoodsSold < 0 ? '+' : '−'} color={costOfGoodsSold < 0 ? colors.primary : colors.expense} bold separator onPress={() => showPnlDetails('Cost of Sales', isCostEntry)} />
        <PLRow label={grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss'} value={grossProfit} sign={grossProfit >= 0 ? '+' : '−'} color={grossProfit >= 0 ? colors.revenue : colors.expense} bold separator onPress={() => showPnlDetails(grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss', e => isRevenueEntry(e) || isCostEntry(e))} />
        <PLRow label="Operating Expenses" value={expenses} sign="−" color={colors.expense} labelColor={colors.expense} bold indent onPress={() => showPnlDetails('Operating Expenses', isOperatingExpenseEntry)} />
        <PLRow label="Cash / bank operating expenses" value={pnlReport.cashOperatingExpenses} sign="" color={colors.foreground} indent />
        <PLRow label="Non-cash / unpaid operating expenses" value={pnlReport.nonCashOperatingExpenses} sign="" color={colors.foreground} indent />
        <PLRow label="Gain/(loss) on asset disposals" value={pnlReport.assetDisposalProfit} sign={pnlReport.assetDisposalProfit < 0 ? '−' : '+'} color={pnlReport.assetDisposalProfit < 0 ? colors.expense : colors.revenue} indent />
        <PLRow label={operatingProfit >= 0 ? 'Operating Profit' : 'Operating Loss'} value={operatingProfit} sign={operatingProfit >= 0 ? '+' : '−'} color={operatingProfit >= 0 ? colors.revenue : colors.expense} labelColor={operatingProfit < 0 ? colors.expense : undefined} bold separator onPress={() => showPnlDetails(operatingProfit >= 0 ? 'Operating Profit' : 'Operating Loss', e => isRevenueEntry(e) || isCostEntry(e) || isOperatingExpenseEntry(e))} />
        <PLRow label="Finance Costs" value={interestOnLoan} sign="−" color={colors.expense} indent onPress={() => showPnlDetails('Finance Costs', isFinanceCostEntry)} />
        <PLRow label={profitBeforeTax >= 0 ? 'Profit Before Tax' : 'Loss Before Tax'} value={profitBeforeTax} sign={profitBeforeTax >= 0 ? '+' : '−'} color={profitBeforeTax >= 0 ? colors.revenue : colors.expense} labelColor={profitBeforeTax < 0 ? colors.expense : undefined} bold separator onPress={() => showPnlDetails(profitBeforeTax >= 0 ? 'Profit Before Tax' : 'Loss Before Tax', e => isRevenueEntry(e) || isCostEntry(e) || isOperatingExpenseEntry(e) || isFinanceCostEntry(e))} />
        <PLRow label="Recorded income tax" value={incomeTax} sign={incomeTax < 0 ? '+' : '−'} color={incomeTax > 0 ? colors.expense : incomeTax < 0 ? colors.primary : colors.mutedForeground} indent onPress={() => showPnlDetails('Tax', () => false, `${taxLabel}. This is the recorded income tax. The PIT planning estimate is shown separately and is not a tax provision. Year-to-date profit before tax: ${fmtPnlNaira(pnlReport.taxBasisProfitBeforeTax)}. Less tax attributable before this period: ${fmtPnlNaira(pnlReport.taxBasisPreviousTax)}. Annual 0% PIT band: ₦800,000. This is calculated from the statement and has no source transaction.`)} />

        {/* Net Profit box */}
        <Pressable onPress={() => showPnlDetails(profitAfterTax >= 0 ? 'PROFIT' : 'LOSS', e => isRevenueEntry(e) || isCostEntry(e) || isOperatingExpenseEntry(e) || isFinanceCostEntry(e), `${taxLabel}.`)}>
         <View style={[styles.netProfitBox, { backgroundColor: isProfit ? colors.profit : colors.expense }]}>
            <Text style={styles.netProfitLabel}>{profitAfterTax >= 0 ? 'Profit for the period (after recorded income tax)' : 'Loss for the period (after recorded income tax)'}</Text>
          <Text style={styles.netProfitValue}>
            {isProfit ? '+' : '−'}{fmtPnlNaira(profitAfterTax)}
          </Text>
        </View>
        </Pressable>


        {pnlEntries.length === 0 && !loading && (
          <Text style={[styles.emptyNote, { color: colors.mutedForeground }]}>
            No P&amp;L transactions recorded in this period
          </Text>
        )}
      </Animated.View>
      )}

      {reportView === 'balance_sheet' && (
        <Animated.View
          entering={FadeInDown.delay(100).springify()}
          style={[styles.plCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          {hasProAccess ? (
            <BalanceSheetStatement entries={entries} products={products} asOfDate={reportEnd} />
          ) : (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <MaterialCommunityIcons name="lock-outline" size={32} color={colors.primary} style={{ marginBottom: 12 }} />
              <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 8 }}>Advanced Reports is a Pro feature</Text>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', lineHeight: 20 }}>
                Upgrade to the Pro plan to access the Balance Sheet and other exportable advanced reports.
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {reportView !== 'pnl' && reportView !== 'balance_sheet' && (
        <Animated.View
          entering={FadeInDown.delay(100).springify()}
          style={[styles.plCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <View style={styles.plHeader}>
            <MaterialCommunityIcons
            name={reportView === 'cash_flow' ? 'cash' : reportView === 'vat' ? 'receipt-text-outline' : reportView === 'tax' ? 'calculator-variant-outline' : 'credit-card-outline'}
              size={18}
              color={colors.primary}
            />
            <Text style={[styles.plTitle, { color: colors.foreground }]}>{reportTitle} Statement</Text>
          </View>
          {(reportView === 'credit_sales' || reportView === 'credit_purchases') && (
            <Text style={[styles.reportDefinition, { color: colors.mutedForeground }]}>
              {reportView === 'credit_sales' ? 'People that are owing me' : 'people that I am owing'}
            </Text>
          )}
          <View style={[styles.plDivider, { backgroundColor: colors.border }]} />

          {reportView === 'cash_flow' && (
            <>
              <ReportMetricRow label="Opening cash balance" helperText="Derived from prior recorded cash movements; ₦0 if no earlier cash history." value={fmt(cashFlowData.openingCash)} bold onPress={() => showReportDetails('Opening cash balance', entries.filter(entry => entry.date < reportStart), [{ label: 'Opening cash balance', value: fmt(cashFlowData.openingCash) }], 'Reconstructed from prior recorded entries; unrecorded/off-ledger balances are not available.')} />
              <ReportMetricRow label="Cash sales received (gross, including VAT)" value={fmt(cashFlowData.cashSales)} onPress={() => showReportDetails('Cash sales received', cashSalesEntries, [{ label: 'Gross recorded cash sales', value: fmt(cashFlowData.cashSales) }])} />
              <ReportMetricRow label="Debtor payments received" value={fmt(cashFlowData.debtorPayments)} onPress={() => showReportDetails('Debtor payments received', cashFlowDebtorPaymentEntries, [{ label: 'Recorded debtor payments', value: fmt(cashFlowData.debtorPayments) }])} />
              <ReportMetricRow label="Supplier return settlements received" value={fmt(cashFlowData.supplierReturnSettlements)} onPress={() => showReportDetails('Supplier return settlements received', cashFlowSupplierReturnEntries, [{ label: 'Recorded supplier return amounts', value: fmt(cashFlowData.supplierReturnSettlements) }], 'Assumed cash settlement because the entry model does not record settlement method.')} />
              <ReportMetricRow label="Customer advances received" value={fmt(cashFlowData.workingCapital.advancesReceived)} onPress={() => showReportDetails('Customer advances received', cashFlowCustomerAdvances, [{ label: 'Receipts before revenue recognition', value: fmt(cashFlowData.workingCapital.advancesReceived) }])} />
              <ReportMetricRow label="Total operating cash receipts" value={fmt(cashFlowData.totalOperatingReceipts)} bold onPress={() => showReportDetails('Total operating cash receipts', [...cashSalesEntries, ...cashFlowDebtorPaymentEntries, ...cashFlowSupplierReturnEntries,...cashFlowCustomerAdvances], [
                { label: 'Cash sales received', value: fmt(cashFlowData.cashSales) },
                { label: 'Debtor payments received', value: fmt(cashFlowData.debtorPayments) },
                { label: 'Supplier return settlements', value: fmt(cashFlowData.supplierReturnSettlements) },
                { label: 'Customer advances received', value: fmt(cashFlowData.workingCapital.advancesReceived) },
                { label: 'Total operating receipts', value: fmt(cashFlowData.totalOperatingReceipts) },
              ])} />
              <ReportMetricRow label="Cash purchases (recorded landed cost)" value={`−${fmt(cashFlowData.cashPurchases)}`} onPress={() => showReportDetails('Cash purchases', cashFlowCashPurchaseEntries, [{ label: 'Recorded landed cost', value: fmt(cashFlowData.cashPurchases) }])} />
              <ReportMetricRow label="Creditor payments" value={`−${fmt(cashFlowData.creditorPayments)}`} onPress={() => showReportDetails('Creditor payments', cashFlowCreditorPaymentEntries, [{ label: 'Explicit recorded payments', value: fmt(cashFlowData.creditorPayments) }])} />
              <ReportMetricRow label="Customer return refunds" value={`−${fmt(cashFlowData.customerReturnRefunds)}`} onPress={() => showReportDetails('Customer return refunds', cashFlowCustomerReturnEntries, [{ label: 'Recorded customer return amounts', value: fmt(cashFlowData.customerReturnRefunds) }], 'Assumed cash refund because the entry model does not record settlement method.')} />
              <ReportMetricRow label="Manual operating expenses" value={`−${fmt(cashFlowData.manualExpenses)}`} onPress={() => showReportDetails('Manual operating expenses', cashFlowExpenseEntries, [{ label: 'Recorded operating expenses', value: fmt(cashFlowData.manualExpenses) }])} />
              <ReportMetricRow label="Tax payments (Financial Controls)" value={`−${fmt(Math.abs(cashFlowData.taxPayments))}`} />
              <ReportMetricRow label="Prepayments paid" value={`−${fmt(cashFlowData.workingCapital.prepayments)}`} onPress={() => showReportDetails('Prepayments paid',cashFlowPrepayments,[{label:'Recorded advance payments',value:fmt(cashFlowData.workingCapital.prepayments)}])} />
              <ReportMetricRow label="Accrued expenses paid" value={`−${fmt(cashFlowData.workingCapital.accruedPayments)}`} onPress={() => showReportDetails('Accrued expenses paid',cashFlowAccrualPayments,[{label:'Recorded accrual settlements',value:fmt(cashFlowData.workingCapital.accruedPayments)}])} />
              <ReportMetricRow label="Loan interest paid" value={`−${fmt(cashFlowData.workingCapital.interestPaid)}`} onPress={() => showReportDetails('Loan interest paid',cashFlowLoanInterest,[{label:'Recorded loan interest',value:fmt(cashFlowData.workingCapital.interestPaid)}])} />
              <ReportMetricRow label="Total operating cash payments" value={`−${fmt(cashFlowData.totalOperatingPayments)}`} bold onPress={() => showReportDetails('Total operating cash payments', [...cashFlowCashPurchaseEntries, ...cashFlowCreditorPaymentEntries, ...cashFlowCustomerReturnEntries, ...cashFlowExpenseEntries,...cashFlowWorkingEntries], [
                { label: 'Cash purchases', value: fmt(cashFlowData.cashPurchases) },
                { label: 'Creditor payments', value: fmt(cashFlowData.creditorPayments) },
                { label: 'Customer return refunds', value: fmt(cashFlowData.customerReturnRefunds) },
                { label: 'Manual operating expenses', value: fmt(cashFlowData.manualExpenses) },
                { label: 'Prepayments paid', value: fmt(cashFlowData.workingCapital.prepayments) },
                { label: 'Accrued expenses paid', value: fmt(cashFlowData.workingCapital.accruedPayments) },
                { label: 'Loan interest paid', value: fmt(cashFlowData.workingCapital.interestPaid) },
                { label: 'Total operating payments', value: fmt(cashFlowData.totalOperatingPayments) },
              ], 'App-generated VAT Paid entries and calculated income-tax estimates are accruals, not evidence of cash payments, and are excluded. A separately recorded payment expense is included.')} />
              <ReportMetricRow
                label="Net cash from operating activities"
                value={`${cashFlowData.netOperatingCashFlow < 0 ? '−' : '+'}${fmt(cashFlowData.netOperatingCashFlow)}`}
                valueColor={cashFlowData.netOperatingCashFlow < 0 ? colors.expense : colors.primary}
                bold
                onPress={() => showReportDetails('Net cash from operating activities', [...cashSalesEntries, ...cashFlowDebtorPaymentEntries, ...cashFlowSupplierReturnEntries, ...cashFlowCashPurchaseEntries, ...cashFlowCreditorPaymentEntries, ...cashFlowCustomerReturnEntries, ...cashFlowExpenseEntries], [
                  { label: 'Total operating receipts', value: fmt(cashFlowData.totalOperatingReceipts) },
                  { label: 'Less: operating payments', value: `−${fmt(cashFlowData.totalOperatingPayments)}` },
                  { label: 'Net operating cash flow', value: `${cashFlowData.netOperatingCashFlow < 0 ? '−' : '+'}${fmt(cashFlowData.netOperatingCashFlow)}` },
                ])}
              />
              <ReportMetricRow label="Net asset acquisitions (investing)" helperText="Equipment-category expenses are classified as investing." value={`−${fmt(Math.abs(cashFlowData.investingCashFlow))}`} onPress={() => showReportDetails('Net asset acquisitions (investing)', cashFlowEquipmentEntries, [{ label: 'Recorded equipment purchases', value: fmt(Math.abs(cashFlowData.investingCashFlow)) }])} />
              {(() => { const cf = cashFlowData;
                return (<>
                  <ReportMetricRow label="Asset acquisitions" value={`−${fmt(Math.abs(cf.assetAcquisitions))}`} />
                  <ReportMetricRow label="Asset disposal proceeds" value={`+${fmt(Math.abs(cf.assetDisposalProceeds))}`} />
                </>); })()}
              <ReportMetricRow label="Net cash from investing activities" value={`${cashFlowData.investingCashFlow < 0 ? '−' : '+'}${fmt(Math.abs(cashFlowData.investingCashFlow))}`} onPress={() => showReportDetails('Net cash from investing activities', cashFlowEquipmentEntries, [{ label: 'Recorded investing cash flow', value: `${cashFlowData.investingCashFlow < 0 ? '−' : '+'}${fmt(Math.abs(cashFlowData.investingCashFlow))}` }], 'No other investing activity is recorded in the entry model.')} />
              <ReportMetricRow label="Owner contributions (financing)" value={fmt(cashFlowData.ownerContributions)} onPress={() => showReportDetails('Owner contributions', ownerFinancingEntries.filter(e => e.type === 'owner_contribution'), [{ label: 'Capital received', value: fmt(cashFlowData.ownerContributions) }], 'Cash/Bank received from owners; not sales revenue or VAT.')} />
              <ReportMetricRow label="Loan proceeds (financing)" value={fmt(cashFlowData.workingCapital.loanReceipts)} onPress={() => showReportDetails('Loan proceeds', cashFlowLoanReceipts, [{ label: 'Borrowed principal received', value: fmt(cashFlowData.workingCapital.loanReceipts) }])} />
              <ReportMetricRow label="Owner drawings (financing)" value={`−${fmt(cashFlowData.ownerDrawings)}`} onPress={() => showReportDetails('Owner drawings', ownerFinancingEntries.filter(e => e.type === 'owner_drawings'), [{ label: 'Drawings paid', value: fmt(cashFlowData.ownerDrawings) }], 'Cash/Bank paid to owners; reduces equity, not operating profit.')} />
              <ReportMetricRow label="Loan principal repaid (financing)" value={`−${fmt(cashFlowData.workingCapital.loanRepayments)}`} onPress={() => showReportDetails('Loan principal repaid', cashFlowLoanRepayments, [{ label: 'Principal repayments', value: fmt(cashFlowData.workingCapital.loanRepayments) }])} />
              <ReportMetricRow label="Net cash from financing activities" helperText="Owner contributions and loans less drawings and principal repayments." value={`${cashFlowData.financingCashFlow < 0 ? '−' : ''}${fmt(Math.abs(cashFlowData.financingCashFlow))}`} onPress={() => showReportDetails('Net cash from financing activities', [...ownerFinancingEntries,...cashFlowLoanReceipts,...cashFlowLoanRepayments], [{ label: 'Owner contributions', value: fmt(cashFlowData.ownerContributions) }, { label: 'Loan proceeds', value: fmt(cashFlowData.workingCapital.loanReceipts) }, { label: 'Less: drawings', value: `−${fmt(cashFlowData.ownerDrawings)}` }, { label: 'Less: principal repayments', value: `−${fmt(cashFlowData.workingCapital.loanRepayments)}` }, { label: 'Recorded financing cash flow', value: `${cashFlowData.financingCashFlow < 0 ? '−' : '+'}${fmt(Math.abs(cashFlowData.financingCashFlow))}` }], 'Contributions, loans and drawings are financing movements, not operating revenue/expenses. Unrecorded activity is not inferred.')} />
              <ReportMetricRow label="Net change in cash" value={`${cashFlowData.netChangeInCash < 0 ? '−' : '+'}${fmt(Math.abs(cashFlowData.netChangeInCash))}`} bold onPress={() => showReportDetails('Net change in cash', [...cashSalesEntries, ...cashFlowDebtorPaymentEntries, ...cashFlowSupplierReturnEntries, ...cashFlowCashPurchaseEntries, ...cashFlowCreditorPaymentEntries, ...cashFlowCustomerReturnEntries, ...cashFlowExpenseEntries, ...cashFlowEquipmentEntries,...cashFlowWorkingEntries], [
                { label: 'Net operating cash flow', value: `${cashFlowData.netOperatingCashFlow < 0 ? '−' : '+'}${fmt(Math.abs(cashFlowData.netOperatingCashFlow))}` },
                { label: 'Net investing cash flow', value: `${cashFlowData.investingCashFlow < 0 ? '−' : '+'}${fmt(Math.abs(cashFlowData.investingCashFlow))}` },
                { label: 'Net financing cash flow', value: fmt(cashFlowData.financingCashFlow) },
                { label: 'Net change in cash', value: `${cashFlowData.netChangeInCash < 0 ? '−' : '+'}${fmt(Math.abs(cashFlowData.netChangeInCash))}` },
              ])} />
              <ReportMetricRow label="Closing cash balance" value={`${cashFlowData.closingCash < 0 ? '−' : ''}${fmt(Math.abs(cashFlowData.closingCash))}`} valueColor={cashFlowData.closingCash < 0 ? colors.expense : colors.primary} bold onPress={() => showReportDetails('Closing cash balance', [...cashSalesEntries, ...cashFlowDebtorPaymentEntries, ...cashFlowSupplierReturnEntries, ...cashFlowCashPurchaseEntries, ...cashFlowCreditorPaymentEntries, ...cashFlowCustomerReturnEntries, ...cashFlowExpenseEntries, ...cashFlowEquipmentEntries], [
                { label: 'Opening cash balance', value: fmt(cashFlowData.openingCash) },
                { label: 'Net change in cash', value: `${cashFlowData.netChangeInCash < 0 ? '−' : '+'}${fmt(Math.abs(cashFlowData.netChangeInCash))}` },
                { label: 'Closing cash balance', value: `${cashFlowData.closingCash < 0 ? '−' : ''}${fmt(Math.abs(cashFlowData.closingCash))}` },
              ], 'Calculated from recorded entries only; does not include unrecorded or off-ledger cash movements.')} />
            </>
          )}

          {reportView === 'credit_sales' && hasProAccess && (
            <>
              <ReportMetricRow label="Debtors" helperText="People that are owing me" value={fmt(totalCreditSales)} onPress={() => showReportDetails('Debtors in selected period', creditSales, [{ label: 'Credit sales recorded', value: fmt(totalCreditSales) }])} />
              <ReportMetricRow label="Payments Received" value={fmt(totalCreditSalePayments)} onPress={() => showReportDetails('Debtor payments received', creditSalePayments, [{ label: 'Payments recorded in selected period', value: fmt(totalCreditSalePayments) }])} />
              <ReportMetricRow
                label="Outstanding Balance"
                value={fmt(outstandingCreditSales)}
                valueColor={colors.primary}
                bold
                onPress={() => showReportDetails('Outstanding debtor balance', [...historicalDebtorEntries, ...historicalDebtorPaymentEntries], [
                  ...historicalDebtorBalances.map(balance => ({
                    label: `${balance.originalEntry.partyName || balance.originalEntry.itemName || 'Credit sale'} · remaining`,
                    value: fmt(balance.remainingBalance),
                  })),
                  { label: 'Outstanding balance', value: fmt(outstandingCreditSales) },
                ], `Historical balance through ${reportEndDate}; includes entries before the selected period. Each invoice's linked payments are applied to its gross sale amount, with balances floored at zero per invoice.`)}
              />
              {creditSales.map((entry, index) => (
                <ReportMetricRow
                  key={entry.id ?? `credit-sale-${index}`}
                  label={`Debtors · ${entry.date} · ${entry.itemName || 'Product'} · ${entry.partyName || 'Customer'} · ${entry.partyPhone || 'No phone'}`}
                  value={fmt(getSaleValue(entry))}
                  stacked
                  onPress={() => setSelectedParty(entry)}
                />
              ))}
              {creditSalePayments.map((entry, index) => (
                <ReportMetricRow
                  key={entry.id ?? `credit-sale-payment-${index}`}
                  label={`Debtors Payment · ${entry.date} · ${entry.itemName || 'Product'} · ${entry.partyName || 'Customer'} · ${entry.partyPhone || 'No phone'}`}
                  value={`${fmt(entry.amount)} · VAT deducted when the sale was recorded`}
                  stacked
                  onPress={() => showEntryDetails(entry, 'Debtor payment')}
                />
              ))}
            </>
          )}

          {reportView === 'credit_purchases' && hasProAccess && (
            <>
              <ReportMetricRow label="Creditors" helperText="people that I am owing" value={fmt(totalCreditPurchases)} onPress={() => showReportDetails('Creditors in selected period', creditPurchases, [{ label: 'Credit purchases recorded', value: fmt(totalCreditPurchases) }])} />
              <ReportMetricRow label="Payments Made" value={fmt(totalCreditPurchasePayments)} onPress={() => showReportDetails('Creditor payments made', creditPurchasePayments, [{ label: 'Payments recorded in selected period', value: fmt(totalCreditPurchasePayments) }])} />
              <ReportMetricRow
                label="Outstanding Balance"
                value={fmt(outstandingCreditPurchases)}
                valueColor={colors.primary}
                bold
                onPress={() => showReportDetails('Outstanding creditor balance', [...historicalCreditorEntries, ...historicalCreditorPaymentEntries], [
                  ...historicalCreditorBalances.map(balance => ({
                    label: `${balance.originalEntry.partyName || balance.originalEntry.itemName || 'Credit purchase'} · remaining`,
                    value: fmt(balance.remainingBalance),
                  })),
                  { label: 'Outstanding balance', value: fmt(outstandingCreditPurchases) },
                ], `Historical balance through ${reportEndDate}; includes entries before the selected period. Each invoice's linked payments are applied to its recorded credit-purchase amount, with balances floored at zero per invoice.`)}
              />
              {creditPurchases.map((entry, index) => (
                <ReportMetricRow
                  key={entry.id ?? `credit-purchase-${index}`}
                  label={`Creditors${entry.type === 'expense' ? ' (Expense)' : ''} · ${entry.date} · ${entry.type === 'expense' ? (entry.category || 'Expense') : (entry.itemName || 'Product')} · ${entry.partyName || 'Supplier'} · ${entry.partyPhone || 'No phone'}`}
                  value={entry.type === 'expense' ? fmt(entry.amount) : `Base ${fmt((entry.unitPurchasePrice ?? entry.baseCost ?? 0) * (entry.unitsPurchased ?? 0))} · Material/other ${fmt(entry.materialCosts?.reduce((sum, value) => sum + value, 0) ?? 0)} · Carriage ${fmt(entry.carriageInward ?? 0)} · Handling ${fmt(entry.handlingCost ?? 0)}`}
                  stacked
                  onPress={() => setSelectedParty(entry)}
                />
              ))}
              {creditPurchasePayments.map((entry, index) => (
                <ReportMetricRow
                  key={entry.id ?? `credit-purchase-payment-${index}`}
                  label={`Creditors Payment · ${entry.date} · ${entry.itemName || 'Product'} · ${entry.partyName || 'Supplier'} · ${entry.partyPhone || 'No phone'}`}
                  value={fmt(entry.amount)}
                  stacked
                  onPress={() => showEntryDetails(entry, 'Creditor payment')}
                />
              ))}
            </>
          )}

          {reportView === 'returns_inward' && hasProAccess && (
            <>
              <ReportMetricRow
                label="Gross returned to customers"
                value={`−${fmt(returnedGrossTotal)}`}
                valueColor={colors.expense}
                bold
                onPress={() => showReportDetails('Gross returned to customers', returnInwardEntries, [
                  { label: 'Returns inward count', value: String(returnInwardEntries.length) },
                  { label: 'Gross returned (before VAT)', value: `−${fmt(returnedGrossTotal)}` },
                ])}
              />
              <ReportMetricRow
                label="VAT reversal"
                value={`−${fmt(returnVatReversalTotal)}`}
                valueColor={colors.expense}
                onPress={() => showReportDetails('Returns-inward VAT reversal', returnInwardEntries, [
                  { label: 'VAT reversed', value: `−${fmt(returnVatReversalTotal)}` },
                ])}
              />
              {returnInwardEntries.map((entry, index) => (
                <ReportMetricRow
                  key={entry.id ?? `return-inward-${index}`}
                  label={`${entry.date} · ${entry.itemName || 'Product'} · ${entry.partyName || 'Customer'}`}
                  value={`Gross ${fmt(getGrossSaleValue(entry))} · VAT ${fmt(getEntryVAT(entry))}`}
                  stacked
                  onPress={() => showEntryDetails(entry, 'Returns Inward')}
                />
              ))}
            </>
          )}

          {reportView === 'returns_outward' && hasProAccess && (
            <>
              <ReportMetricRow
                label="Supplier credit / refund"
                value={fmt(supplierReturnCreditTotal)}
                bold
                onPress={() => showReportDetails('Supplier credit / refund', returnOutwardEntries, [
                  { label: 'Returns outward count', value: String(returnOutwardEntries.length) },
                  { label: 'Supplier credit recorded', value: fmt(supplierReturnCreditTotal) },
                ])}
              />
              <ReportMetricRow
                label="Returned inventory at recorded landed cost"
                helperText="Only entries with a saved landed-cost value are included."
                value={fmt(recordedReturnLandedCostTotal)}
                onPress={() => showReportDetails('Returned inventory at recorded landed cost', returnOutwardEntries, [
                  { label: 'Recorded landed cost total', value: fmt(recordedReturnLandedCostTotal) },
                  { label: 'Returns missing landed cost', value: String(missingReturnLandedCostCount) },
                ], 'No cost is inferred for returns with missing returnLandedCost.')}
              />
              <ReportMetricRow
                label="Supplier return expenses"
                helperText="Recorded landed cost less supplier credit, floored at zero."
                value={fmt(supplierReturnExpenseTotal)}
                valueColor={supplierReturnExpenseTotal > 0 ? colors.expense : colors.foreground}
                onPress={() => showReportDetails('Supplier return expenses', returnOutwardEntries, [
                  { label: 'Supplier return expenses', value: fmt(supplierReturnExpenseTotal) },
                  { label: 'Returns missing landed cost', value: String(missingReturnLandedCostCount) },
                ], 'Calculated only for returns with recorded landed cost using getSupplierReturnExpense.')}
              />
              <ReportMetricRow
                label="Returns missing recorded landed cost"
                value={String(missingReturnLandedCostCount)}
                valueColor={missingReturnLandedCostCount > 0 ? colors.expense : colors.foreground}
                onPress={() => showReportDetails(
                  'Returns missing recorded landed cost',
                  returnOutwardEntries.filter(entry => typeof entry.returnLandedCost !== 'number'),
                  [{ label: 'Missing landed-cost count', value: String(missingReturnLandedCostCount) }],
                  'These returns are excluded from the recorded landed-cost total; no cost or supplier return expenses are invented.',
                )}
              />
              {returnOutwardEntries.map((entry, index) => (
                <ReportMetricRow
                  key={entry.id ?? `return-outward-${index}`}
                  label={`${entry.date} · ${entry.itemName || 'Product'} · ${entry.partyName || 'Supplier'}`}
                  value={`Credit ${fmt(entry.amount)} · Landed cost ${typeof entry.returnLandedCost === 'number' ? fmt(entry.returnLandedCost) : 'Not recorded'}`}
                  stacked
                  onPress={() => showEntryDetails(entry, 'Returns Outward')}
                />
              ))}
            </>
          )}

          {reportView === 'wht' && hasProAccess && (
            <>
              <Text style={[styles.plTitle, { color: colors.foreground }]}>Withholding Tax Statement</Text>
              <Text style={[styles.emptyNote, { color: colors.mutedForeground }]}>{reportStart} – {reportEnd}</Text>
              <ReportMetricRow label="Total withholding tax withheld" bold value={fmt(whtEntries.reduce((sum, e) => sum + (Number((e as any).withholdingTax) || 0), 0))} />
              {whtEntries.length === 0 ? (
                <Text style={[styles.emptyNote, { color: colors.mutedForeground }]}>No purchases with withholding tax in this period.</Text>
              ) : whtEntries.map(e => (
                <ReportMetricRow key={e.id} stacked
                  label={`${fmtDate(e.date)} · ${e.partyName || 'Supplier'} · ${e.itemName || 'Item'}`}
                  helperText={`Base ${fmt(getPurchaseBaseCost(e))} · VAT ${fmt(Number((e as any).purchaseVAT) || 0)} · WHT ${fmt(Number((e as any).withholdingTax) || 0)}`}
                  value={`Net supplier payable ${fmt(supplierPurchasePayable(e))}`}
                  onPress={() => showReportDetails('Withholding tax', [e], [])} />
              ))}
            </>
          )}

          {reportView === 'vat' && hasProAccess && (
            <>
              <Text style={[styles.plTitle, { color: colors.foreground }]}>VAT Statement</Text>
              <Text style={[styles.emptyNote, { color: colors.mutedForeground }]}>{reportStart} – {reportEnd}</Text>
              <ReportMetricRow label="Net sales VAT (before input VAT and remittances)" value={fmt(totalVat)} valueColor={colors.primary} bold />
              <ReportMetricRow label="Cash-sale VAT additions" value={fmt(vatLedger.filter(row => row.kind === 'cash_sale').reduce((sum, row) => sum + row.vatAmount, 0))} onPress={() => {
                const rows = vatLedger.filter(row => row.kind === 'cash_sale');
                showReportDetails('Cash-sale VAT additions', rows.map(row => row.entry), [{ label: 'Cash-sale VAT', value: fmt(rows.reduce((sum, row) => sum + row.vatAmount, 0)) }]);
              }} />
              <ReportMetricRow label="Credit-sale VAT additions" value={fmt(vatLedger.filter(row => row.kind === 'credit_sale').reduce((sum, row) => sum + row.vatAmount, 0))} onPress={() => {
                const rows = vatLedger.filter(row => row.kind === 'credit_sale');
                showReportDetails('Credit-sale VAT additions', rows.map(row => row.entry), [{ label: 'Credit-sale VAT', value: fmt(rows.reduce((sum, row) => sum + row.vatAmount, 0)) }]);
              }} />
              <ReportMetricRow label="Return-inward VAT reversals" value={`−${fmt(vatLedger.filter(row => row.kind === 'return_inward').reduce((sum, row) => sum + row.vatAmount, 0))}`} onPress={() => {
                const rows = vatLedger.filter(row => row.kind === 'return_inward');
                showReportDetails('Return-inward VAT reversals', rows.map(row => row.entry), [{ label: 'VAT reversed', value: `−${fmt(rows.reduce((sum, row) => sum + row.vatAmount, 0))}` }]);
              }} />
              <ReportMetricRow label="Credit-sale payment allocations (reference)" value={fmt(vatLedger.filter(row => row.kind === 'credit_sale_payment').reduce((sum, row) => sum + row.vatAmount, 0))} onPress={() => {
                const rows = vatLedger.filter(row => row.kind === 'credit_sale_payment');
                showReportDetails('Credit-sale payment allocations (reference only)', rows.map(row => row.entry), [{ label: 'Previously recorded VAT allocated to payments', value: fmt(rows.reduce((sum, row) => sum + row.vatAmount, 0)) }], 'Payment allocations are references only and do not add VAT a second time.');
              }} />
              <ReportMetricRow label="Net sales VAT (additions − reversals)" value={fmt(totalVat)} valueColor={colors.primary} bold onPress={() => showReportDetails('Net sales VAT', vatLedger.map(row => row.entry), [
                { label: 'Cash-sale VAT additions', value: fmt(vatLedger.filter(row => row.kind === 'cash_sale').reduce((sum, row) => sum + row.vatAmount, 0)) },
                { label: 'Credit-sale VAT additions', value: fmt(vatLedger.filter(row => row.kind === 'credit_sale').reduce((sum, row) => sum + row.vatAmount, 0)) },
                { label: 'Less: return-inward VAT reversals', value: `−${fmt(vatLedger.filter(row => row.kind === 'return_inward').reduce((sum, row) => sum + row.vatAmount, 0))}` },
                { label: 'Net sales VAT', value: fmt(totalVat) },
              ], 'VAT is calculated at 7.5% of the entered customer price; net revenue is the customer total less VAT.')} />
              {vatLedger.map((row, index) => (
                <ReportMetricRow
                  key={row.entry.id ?? `vat-row-${index}`}
                  label={`${row.entry.date} · ${row.entry.itemName || row.entry.category || 'Product sale'} · ${row.direction === 'allocation' ? 'Allocation/reference' : row.direction === 'deduction' ? 'Return inward reversal' : row.kind === 'credit_sale' ? 'Debtors addition' : 'Cash sale addition'}${row.entry.partyName ? ` · ${row.entry.partyName}` : ''}`}
                  value={`${row.direction === 'deduction' ? '−' : row.direction === 'allocation' ? '↔' : '+'}${fmt(row.vatAmount)} · ${row.direction === 'allocation' ? 'Payment' : 'Net'} ${fmt(row.baseAmount)}${row.vatRate === undefined ? '' : ` · ${(row.vatRate * 100).toFixed(2)}%`}`}
                  stacked
                  onPress={() => showReportDetails('VAT transaction details', [row.entry], [
                    { label: 'VAT ledger category', value: row.direction === 'allocation' ? 'Allocation/reference' : row.direction === 'deduction' ? 'Return-inward reversal' : 'Sale addition' },
                    { label: row.direction === 'allocation' ? 'Payment amount' : 'Entered customer total (VAT basis)', value: fmt(row.baseAmount + row.vatAmount) },
                    ...(row.direction === 'allocation' ? [] : [{ label: row.direction === 'deduction' ? 'Net return amount' : 'Net sales amount', value: fmt(row.baseAmount) }]),
                    { label: 'VAT rate', value: row.vatRate === undefined ? 'Not available' : `${(row.vatRate * 100).toFixed(2)}%` },
                    { label: row.direction === 'deduction' ? 'VAT reversed' : 'VAT amount', value: fmt(row.vatAmount) },
                    ...getEntryDetailRows(row.entry),
                  ], row.direction === 'allocation'
                    ? 'Payment allocations reference VAT already recorded on the sale and do not add VAT again.'
                    : 'VAT is calculated at 7.5% of the entered customer total; net sales/return amount is gross less VAT.')}
                />
              ))}
            </>
          )}

          {isProReport && !hasProAccess && (
            <View style={{ padding: 20, alignItems: 'center' }}>
              <MaterialCommunityIcons name="lock-outline" size={32} color={colors.primary} style={{ marginBottom: 12 }} />
              <Text style={{ fontSize: 16, fontFamily: 'Inter_700Bold', color: colors.foreground, marginBottom: 8 }}>
                {taxCenter ? 'Tax Center' : 'Advanced Reports'} is a Pro feature
              </Text>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, textAlign: 'center', marginBottom: 20, lineHeight: 20 }}>
                {reportView === 'tax'
                  ? 'Upgrade to the Pro plan to automatically calculate your tax liabilities based on your profit and business type.'
                  : 'Upgrade to the Pro plan to access VAT tracking, credit ledgers, and exportable advanced reports.'}
              </Text>
            </View>
          )}

          {reportView === 'tax' && hasProAccess && (
            <>
              <Text style={[styles.plTitle, { color: colors.foreground }]}>PIT Statement</Text>
              <Text style={[styles.emptyNote, { color: colors.mutedForeground }]}>{reportStart} – {reportEnd}</Text>
              <ReportMetricRow label="Estimated PIT for this period" value={fmt(pnlReport.estimatedTax)} valueColor={colors.primary} bold />
              {pnlEntries.length === 0 && <Text style={[styles.emptyNote, { color: colors.mutedForeground }]}>No profit/loss activity in this period. PIT still uses the year-to-date tax basis below.</Text>}
              <ReportMetricRow label="Year-to-date profit before tax" value={`${pnlReport.taxBasisProfitBeforeTax < 0 ? '−' : ''}${fmt(pnlReport.taxBasisProfitBeforeTax)}`} onPress={() => showReportDetails('Year-to-date tax basis', entries.filter(entry => entry.date <= reportEnd && entry.date.startsWith(reportEnd.slice(0, 4))), [{ label: 'Year-to-date profit before tax', value: `${pnlReport.taxBasisProfitBeforeTax < 0 ? '−' : ''}${fmt(pnlReport.taxBasisProfitBeforeTax)}` }])} />
              <ReportMetricRow label="Year-to-date PIT estimate" value={fmt(calcNigerianPIT(pnlReport.taxBasisProfitBeforeTax))} />
              <ReportMetricRow label="Less tax attributable before this period" value={`−${fmt(pnlReport.taxBasisPreviousTax)}`} />
              <ReportMetricRow label="Profit/Loss Before Tax" value={fmt(profitBeforeTax)} onPress={() => showReportDetails('Profit/Loss Before Tax', pnlEntries.filter(entry => isRevenueEntry(entry) || isCostEntry(entry) || isOperatingExpenseEntry(entry) || isFinanceCostEntry(entry)), [
                { label: 'Operating profit', value: fmt(operatingProfit) },
                { label: 'Less: finance costs', value: `−${fmt(interestOnLoan)}` },
                { label: 'Profit/Loss before tax', value: fmt(profitBeforeTax) },
              ])} />
              <ReportMetricRow label="PIT planning estimate" value={fmt(pnlReport.estimatedTax)} valueColor={colors.expense} bold onPress={() => showReportDetails('PIT planning estimate', [], [
                { label: 'Year-to-date profit before tax', value: fmt(pnlReport.taxBasisProfitBeforeTax) },
                { label: 'Tax attributable before this period', value: `−${fmt(pnlReport.taxBasisPreviousTax)}` },
                { label: 'Current-period PIT estimate', value: fmt(pnlReport.estimatedTax) },
              ], `${taxLabel}. Calculated using Nigeria Tax Act individual PIT bands; tax is zero when taxable profit is not positive and the first annual ₦800,000 is taxed at 0%. Tax is computed from statement profit and has no source tax transaction.`)} />
              <ReportMetricRow
                label="Profit/Loss After Tax"
                value={fmt(profitAfterTax)}
                valueColor={profitAfterTax >= 0 ? colors.revenue : colors.expense}
                bold
                onPress={() => showReportDetails('Profit/Loss After Tax', pnlEntries.filter(entry => isRevenueEntry(entry) || isCostEntry(entry) || isOperatingExpenseEntry(entry) || isFinanceCostEntry(entry)), [
                  { label: 'Profit/Loss before tax', value: fmt(profitBeforeTax) },
                  { label: 'Less: income tax', value: `−${fmt(incomeTax)}` },
                  { label: profitAfterTax >= 0 ? 'Profit after tax' : 'Loss after tax', value: fmt(profitAfterTax) },
                ], 'Calculated as profit/loss before tax less income tax payable.')}
              />
            </>
          )}

          {hasProAccess && ((reportView === 'credit_sales' && creditSales.length === 0 && creditSalePayments.length === 0) ||
            (reportView === 'credit_purchases' && creditPurchases.length === 0 && creditPurchasePayments.length === 0) ||
            (reportView === 'vat' && vatLedger.length === 0) ||
            (reportView === 'returns_inward' && returnInwardEntries.length === 0) ||
            (reportView === 'returns_outward' && returnOutwardEntries.length === 0)) && (
            <Text style={[styles.emptyNote, { color: colors.mutedForeground }]}>
              {reportView === 'returns_inward'
                ? 'No customer returns recorded in this period.'
                : reportView === 'returns_outward'
                  ? 'No supplier returns recorded in this period.'
                  : `No ${reportView === 'vat' ? 'product sales' : reportView === 'credit_sales' ? 'debtors or debtors payment entries' : 'creditors or creditors payment entries'} in this period`}
            </Text>
          )}
        </Animated.View>
      )}

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.loadingTxt, { color: colors.mutedForeground }]}>Loading…</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: bottomInset + 120 }}
        showsVerticalScrollIndicator={false}
      >
        {ListHeader}
      </ScrollView>

      <Modal
        visible={!!selectedParty}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedParty(null)}
      >
        <Pressable style={styles.partyOverlay} onPress={() => setSelectedParty(null)}>
          <Pressable style={[styles.partySheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={styles.partyHandle} />
            <View style={styles.partyHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.partyTitle, { color: colors.foreground }]}>{partySummary?.name}</Text>
                <Text style={[styles.partyMeta, { color: colors.mutedForeground }]}>
                  {partySummary?.kind === 'customer' ? 'Customer' : 'Supplier'} · {partySummary?.phone || 'No phone'}
                </Text>
              </View>
              <Pressable onPress={() => setSelectedParty(null)}><Feather name="x" size={22} color={colors.mutedForeground} /></Pressable>
            </View>
            <Text style={[styles.partyCaption, { color: colors.mutedForeground }]}>Historical totals through {reportEndDate}</Text>
            <View style={[styles.partyTotals, { borderColor: colors.border }]}>
              <ReportMetricRow label={partySummary?.kind === 'customer' ? 'Total bought' : 'Total purchased'} value={fmt(partySummary?.bought ?? 0)} />
              <ReportMetricRow label={partySummary?.kind === 'customer' ? 'Total paid' : 'Total paid'} value={fmt(partySummary?.paid ?? 0)} />
              <ReportMetricRow label="Remaining" value={fmt(partySummary?.remaining ?? 0)} valueColor={colors.primary} bold />
            </View>
            {selectedParty ? (
              <ScrollView style={{ maxHeight: 220, marginTop: 12 }}>
                <Text style={{ color: colors.mutedForeground, marginBottom: 6 }}>Selected transaction details</Text>
                {getEntryDetailRows(selectedParty).map((row, index) => (
                  <View key={`party-detail-${index}`} style={[styles.partyMetricRow, { borderBottomColor: colors.border }]}>
                    <Text style={{ flex: 1, paddingRight: 12, color: colors.mutedForeground }}>{row.label}</Text>
                    <Text style={{ color: colors.foreground, fontWeight: '600' }}>{row.value}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* ── Action bar ──────────────────────────────────────────────────────── */}
      <View style={[styles.pdfBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: bottomInset + 8 }]}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={handlePrint}
              disabled={generating}
              style={({ pressed }) => [
                styles.pdfBtn,
                { flex: 1, backgroundColor: colors.muted, opacity: generating || pressed ? 0.7 : 1 },
              ]}
            >
              <Feather name="printer" size={18} color={colors.foreground} />
              <Text style={[styles.pdfBtnTxt, { color: colors.foreground }]}>Print</Text>
            </Pressable>
            <Pressable
              onPress={handleDownloadPDF}
              disabled={generating}
              style={({ pressed }) => [
                styles.pdfBtn,
                { flex: 1.4, backgroundColor: colors.primary, opacity: generating || pressed ? 0.7 : 1 },
              ]}
            >
              {generating
                ? <ActivityIndicator color="#fff" size="small" />
                : <Feather name="download" size={18} color="#fff" />}
              <Text style={styles.pdfBtnTxt}>Save PDF</Text>
            </Pressable>
            <Pressable
              onPress={handleShare}
              disabled={sharing}
              style={({ pressed }) => [
                styles.pdfBtn,
                { flex: 1, backgroundColor: colors.muted, opacity: sharing || pressed ? 0.7 : 1 },
              ]}
            >
              {sharing
                ? <ActivityIndicator color={colors.foreground} size="small" />
                : <Feather name="share-2" size={18} color={colors.foreground} />}
              <Text style={[styles.pdfBtnTxt, { color: colors.foreground }]}>Share</Text>
            </Pressable>
          </View>
      </View>

      <CustomRangeModal
        accountingYearEnd={accountingYearEnd}
        visible={rangeModalVisible}
        initialStart={customRange.start}
        initialEnd={customRange.end}
        onApply={(start, end) => {
          setCustomRange({ start, end });
          setPeriod('custom');
          setRangeModalVisible(false);
        }}
        onClose={() => setRangeModalVisible(false)}
      />
      <Modal
        visible={!!selectedPnlDetail}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPnlDetail(null)}
      >
        <Pressable style={styles.partyOverlay} onPress={() => setSelectedPnlDetail(null)}>
          <Pressable style={[styles.partySheet, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={styles.partyHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.partyTitle, { color: colors.foreground }]}>{selectedPnlDetail?.title}</Text>
                <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>Contributing entries for this period</Text>
              </View>
              <Pressable onPress={() => setSelectedPnlDetail(null)}><Feather name="x" size={22} color={colors.mutedForeground} /></Pressable>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {selectedPnlDetail?.details?.map((row, index) => (
                <View key={`formula-${index}`} style={[styles.partyMetricRow, { borderBottomColor: colors.border }]}>
                  <Text style={{ flex: 1, paddingRight: 12, color: colors.foreground, fontWeight: index === (selectedPnlDetail.details?.length ?? 1) - 1 ? '700' : '400' }}>
                    {row.label}
                  </Text>
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>{row.value}</Text>
                </View>
              ))}
              {selectedPnlDetail?.entries.length ? (
                <Text style={{ color: colors.mutedForeground, paddingTop: 12, paddingBottom: 4 }}>Source entries</Text>
              ) : null}
              {selectedPnlDetail?.entries.length ? selectedPnlDetail.entries.map((entry, index) => {
                const liveEntry = entries.find(candidate => candidate.id === entry.id && candidate.type === entry.type) ?? entry;
                const value = selectedPnlDetail.title === 'Operating Expenses' && liveEntry.type === 'return_outward'
                  ? getSupplierReturnExpense(liveEntry)
                  : liveEntry.type === 'sale' || liveEntry.type === 'credit_sale' || liveEntry.type === 'return_inward'
                  ? getGrossSaleValue(liveEntry)
                  : liveEntry.amount;
                const isMissingReturnCost = liveEntry.type === 'return_outward' && typeof liveEntry.returnLandedCost !== 'number';
                return (
                  <View key={liveEntry.id ?? index} style={[styles.partyMetricRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                      <Text style={{ color: colors.foreground, fontWeight: '600' }}>{formatEntryDescription(liveEntry)}</Text>
                      <Text style={{ color: colors.mutedForeground, marginTop: 2 }}>{liveEntry.date} · {liveEntry.type.replace(/_/g, ' ')}</Text>
                      {getEntryDetailRows(liveEntry, fmtPnlNaira).map((row, rowIndex) => (
                        <Text key={`entry-detail-${rowIndex}`} style={{ color: colors.mutedForeground, fontSize: 11, lineHeight: 16, marginTop: rowIndex === 0 ? 4 : 0 }}>
                          {row.label}: {row.value}
                        </Text>
                      ))}
                      {isMissingReturnCost && (
                        <View style={{ marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: colors.background, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                          <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 13, marginBottom: 5 }}>
                            Correct historical total landed cost
                          </Text>
                          <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18, marginBottom: 10 }}>
                            Enter the TOTAL carrying cost recorded for this return when it happened, including allocated freight/handling where applicable. Do not use today’s product price or an estimate.
                          </Text>
                          <TextInput
                            testID={`return-landed-cost-${liveEntry.id}`}
                            value={returnCostDrafts[liveEntry.id] ?? ''}
                            onChangeText={value => {
                              setReturnCostDrafts(current => ({ ...current, [liveEntry.id]: value }));
                              setReturnCostErrors(current => ({ ...current, [liveEntry.id]: '' }));
                            }}
                            placeholder="Historical total landed cost"
                            placeholderTextColor={colors.mutedForeground}
                            keyboardType="decimal-pad"
                            editable={savingReturnCostId !== liveEntry.id}
                            accessibilityLabel="Historical total landed cost"
                            style={{
                              color: colors.foreground,
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                              borderWidth: StyleSheet.hairlineWidth,
                              borderRadius: 10,
                              paddingHorizontal: 12,
                              paddingVertical: 10,
                              fontSize: 15,
                            }}
                          />
                          <Pressable
                            testID={`confirm-return-landed-cost-${liveEntry.id}`}
                            accessibilityRole="button"
                            disabled={savingReturnCostId === liveEntry.id}
                            onPress={() => requestReturnCostCorrection(liveEntry)}
                            style={({ pressed }) => ({
                              marginTop: 10,
                              paddingVertical: 11,
                              paddingHorizontal: 12,
                              alignItems: 'center',
                              borderRadius: 10,
                              backgroundColor: colors.primary,
                              opacity: pressed || savingReturnCostId === liveEntry.id ? 0.7 : 1,
                            })}
                          >
                            <Text style={{ color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 13 }}>
                              {savingReturnCostId === liveEntry.id ? 'Saving…' : 'Review & save historical cost'}
                            </Text>
                          </Pressable>
                          {returnCostErrors[liveEntry.id] ? (
                            <Text accessibilityLiveRegion="polite" style={{ color: colors.expense, fontSize: 12, marginTop: 8, lineHeight: 17 }}>
                              {returnCostErrors[liveEntry.id]}
                            </Text>
                          ) : null}
                        </View>
                      )}
                    </View>
                    <Text style={{ color: colors.foreground, fontWeight: '700' }}>{fmtPnlNaira(value)}</Text>
                  </View>
                );
              }) : (
                <Text style={{ color: colors.mutedForeground, paddingVertical: 18 }}>No source transactions for this line.</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header:         { paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle:    { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.5 },
  headerSub:      { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 3, marginBottom: 18 },

  periodBar:      { flexDirection: 'row', borderRadius: 14, padding: 4, gap: 4 },
  periodBtn:      { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  periodBtnActive:{ backgroundColor: '#fff' },
  periodBtnTxt:   { fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.7)' },
  periodBtnTxtActive: { color: '#1B7A3E', fontFamily: 'Inter_700Bold' },

  reportSelector: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 16,
    padding: 8,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  reportSelectorBtn: {
    width: '48%',
    minHeight: 66,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  reportSelectorLabel: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  reportSelectorDescription: { fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 },
  reportDefinition: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: -8, marginBottom: 10 },

  plCard: {
    margin: 16, borderRadius: 18, padding: 18,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 8, elevation: 2,
  },
  plHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  plTitle:  { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.6 },
  plDivider:{ height: StyleSheet.hairlineWidth, marginBottom: 4 },

  netProfitBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderRadius: 12, padding: 16, marginTop: 14,
  },
  netProfitLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  netProfitValue: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },

  emptyNote: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 12 },

  sectionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  sectionCount: { fontSize: 12, fontFamily: 'Inter_400Regular' },

  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 20, justifyContent: 'center' },
  loadingTxt: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  emptyState: { alignItems: 'center', paddingTop: 48, gap: 10 },
  emptyTxt:   { fontSize: 14, fontFamily: 'Inter_400Regular' },

  pdfBar: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    padding: 12, borderTopWidth: StyleSheet.hairlineWidth,
  },
  pdfBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingVertical: 15, borderRadius: 14,
  },
  pdfBtnTxt: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },
  partyOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  partySheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: 34 },
  partyHandle: { width: 42, height: 4, borderRadius: 2, backgroundColor: '#CBD5D0', alignSelf: 'center', marginBottom: 18 },
  partyHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  partyTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  partyMeta: { fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 4 },
  partyCaption: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  partyTotals: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 4 },
  partyMetricRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
});
