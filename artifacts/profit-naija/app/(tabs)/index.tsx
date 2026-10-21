import { supplierPurchasePayable, statementRowsFromLines, statementToHTML, statementTransactionRows, profitStatementYearLabel } from '@workspace/accounting-core';
import React, { useState, useMemo } from 'react';
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
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useColors } from '@/hooks/useColors';
import { useEntries, Entry } from '@/context/EntriesContext';
import { useAuth } from '@/context/AuthContext';
import { useProfile } from '@/context/ProfileContext';
import {
  TrendingUp, TrendingDown,
  ShoppingCart, Banknote, Boxes,
  DollarSign, Receipt,
  Plus, Inbox, AlertCircle,
  Package, UserCircle, X, Pencil, Trash2, RotateCcw,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { buildPnLReport, buildVATLedger, calcCashSales, calcCostBalance, calcCostForEntries, calcDashboardRevenue, calcDirectExpensesForEntries, calcInventoryPurchasesForEntries, calcInventoryValueAsOf, calcNigerianPIT, calcSalesExcludingVAT, calcTotalSales, formatDirectExpenseDescription, getGrossSaleValue, getSaleValue, getInventoryMovementCost, getPurchaseBaseCost, getPurchaseValue, getRecognizedCreditPurchasePaymentCost, getOutstandingCredits, getStockValueBreakdown, getSupplierReturnExpense, isDirectExpenseEntry } from '@/lib/utils/formulas';
import { calcMoneyAccountBalances, getMoneyAccountMovements, getPaymentModeLabel } from '@/lib/utils/moneyAccounts';
import { getPurchaseSettlement, sumPurchaseSettlements, getPurchaseDetailSections, type PurchaseDetailRow } from '@/lib/utils/purchaseSettlement';
import { DashboardPeriodFilter } from '@/components/DashboardPeriodFilter';
import { resolveDashboardRange, dashboardPeriodEntries, dashboardBalanceEntries, type DashboardDateRange } from '@/lib/dashboardPeriod';

// ── Helpers ───────────────────────────────────────────────────────────────────

const NAIRA = '₦';

function fmt(n: number): string {
  return NAIRA + Math.abs(n).toLocaleString('en-NG', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function fmtPnlNaira(n: number): string {
  return NAIRA + Math.round(Math.abs(n)).toLocaleString('en-NG', { maximumFractionDigits: 0 });
}

function fmtSale(n: number): string {
  return NAIRA + Math.abs(n).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}

function fmtReportDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-NG', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  } catch { return dateStr; }
}

function safeBusinessName(value: string): string {
  return (value || 'Business').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Business';
}

// ── Metric Detail Modal ───────────────────────────────────────────────────────

type MetricKey =
  | 'sales'
  | 'revenue'
  | 'cost'
  | 'expenses'
  | 'profit'
  | 'stock'
  | 'credit_sales'
  | 'credit_purchases'
  | 'vat';

function MetricRow({
  label, value, helperText, valueColor, labelColor, bold = false, onPress,
}: { label: string; value: string; helperText?: string; valueColor?: string; labelColor?: string; bold?: boolean; onPress?: () => void; }) {
  const colors = useColors();
  const row = (
    <View style={[mStyles.row, { borderBottomColor: colors.border }]}>
      <View style={mStyles.rowLeft}>
        <Text style={[
          mStyles.rowLabel,
          { color: labelColor ?? colors.mutedForeground },
          bold && { fontFamily: 'Inter_700Bold' },
        ]} numberOfLines={2}>{label}</Text>
      </View>
      <View style={mStyles.rowRight}>
        <Text style={[
          mStyles.rowValue,
          { color: valueColor ?? colors.foreground },
          bold && { fontFamily: 'Inter_700Bold' },
        ]}>{value}</Text>
      </View>
    </View>
  );
  return onPress ? <Pressable onPress={onPress}>{row}</Pressable> : row;
}

function MetricDetailModal({
  metricKey, range, onClose, onRowPress,
}: { metricKey: MetricKey; range: DashboardDateRange; onClose: () => void; onRowPress: (entry: Entry) => void }) {
  const colors = useColors();
  const [selectedPnlLine, setSelectedPnlLine] = useState<{ title: string; entries: Entry[]; details: Array<{ label: string; value: string }>; note?: string } | null>(null);
  const { profile } = useProfile();
  const {
    entries, products,
    deleteEntry,
  } = useEntries();
  const stockValue = useMemo(
    () => calcInventoryValueAsOf(products, entries, range.end),
    [products, entries, range.end],
  );
  const stockBreakdown = useMemo(
    () => getStockValueBreakdown(products, entries, range.end),
    [products, entries, range.end],
  );
  const costPeriodLabel = range.label;
  const periodEntries = useMemo(
    () => dashboardPeriodEntries(entries, range),
    [entries, range.start, range.end],
  );
  const balanceEntries = useMemo(() => dashboardBalanceEntries(entries, range), [entries, range.end]);

  const pnlReport = useMemo(() => buildPnLReport(entries, periodEntries, products, range.end, range.start), [entries, periodEntries, products, range.end, range.start]);
  const totalRevenue = pnlReport.revenue;
  const statementRevenue = pnlReport.statementRevenue;
  const totalCost = calcCostBalance(periodEntries, products);
  const totalCOGS = pnlReport.cost;
  const grossProfit = pnlReport.grossProfit;
  const totalExpenses = pnlReport.operatingExpenses;
  const profitBeforeTax = pnlReport.profitBeforeTax;
  const incomeTax = pnlReport.tax;
  const netProfit = pnlReport.profitAfterTax;
  const debtorsBalance = useMemo(
    () => getOutstandingCredits(balanceEntries, 'sale').reduce((sum, credit) => sum + credit.remainingBalance, 0),
    [balanceEntries],
  );
  const creditorsBalance = useMemo(
    () => getOutstandingCredits(balanceEntries, 'purchase').reduce((sum, credit) => sum + credit.remainingBalance, 0),
    [balanceEntries],
  );

  const grossSales = calcTotalSales(periodEntries);
  const totalSales = calcSalesExcludingVAT(periodEntries);
  const dashboardRevenue = calcDashboardRevenue(periodEntries);
  const salesVAT = grossSales - totalSales;

  const cashSaleEntries = periodEntries.filter(e => e.type === 'sale');
  const allSaleEntries = periodEntries.filter(e => e.type === 'sale' || e.type === 'credit_sale');
  const creditSaleEntries = periodEntries.filter(e => e.type === 'credit_sale');
  const creditSalePaymentEntries = periodEntries.filter(e => e.type === 'credit_sale_payment');
  const purchaseEntries = periodEntries.filter(e => e.type === 'purchase');
  const creditPurchaseEntries = periodEntries.filter(e => e.type === 'credit_purchase');
  const creditPurchasePaymentEntries = periodEntries.filter(e => e.type === 'credit_purchase_payment');
  const creditExpenseEntries = periodEntries.filter(e => e.type === 'expense' && e.paymentMode === 'credit');
  const returnInwardEntries = periodEntries.filter(e => e.type === 'return_inward');
  const returnOutwardEntries = periodEntries.filter(e => e.type === 'return_outward');
  const expenseEntries  = periodEntries.filter(isDirectExpenseEntry).filter(e => e.category?.toLowerCase() !== 'interest on loan');
  const vatLedger = buildVATLedger(periodEntries, products, entries);
  const totalVatOnSales = vatLedger.reduce((sum, row) => sum + (row.direction === 'deduction' ? -row.vatAmount : row.direction === 'addition' ? row.vatAmount : 0), 0);

  const totalReturns    = returnInwardEntries.reduce((s, e) => s + getGrossSaleValue(e), 0);
  const netReturns = returnInwardEntries.reduce((sum, entry) => sum + getSaleValue(entry), 0);
  const inventoryPurchaseEntries = [...purchaseEntries, ...creditPurchaseEntries];
  const totalCarriage   = inventoryPurchaseEntries.reduce((s, e) => s + (e.carriageInward ?? 0), 0);
  const totalHandling   = inventoryPurchaseEntries.reduce((s, e) => s + (e.handlingCost ?? 0), 0);
  const totalUnitsPurchased = inventoryPurchaseEntries.reduce((sum, entry) => sum + (entry.unitsPurchased ?? 0), 0);
  const cashPurchaseBase = purchaseEntries.reduce((sum, entry) => sum + getPurchaseBaseCost(entry), 0);
  const allPurchaseEntries = [...purchaseEntries, ...creditPurchaseEntries];
  const purchaseVAT = allPurchaseEntries.reduce((sum, entry) => sum + (entry.purchaseVAT ?? 0), 0);
  const withholdingTax = allPurchaseEntries.reduce((sum, entry) => sum + (entry.withholdingTax ?? 0), 0);
  const settle = sumPurchaseSettlements(allPurchaseEntries.map(entry => getPurchaseSettlement(entry, entries, range.end)));
  const purchaseDetails = getPurchaseDetailSections(settle, allPurchaseEntries, returnOutwardEntries, products);
  const purchaseRowValue = (row: PurchaseDetailRow) => row.value === null ? 'Not available'
    : row.quantity ? row.value.toLocaleString('en-NG')
    : `${row.value < 0 || row.label.startsWith('Less ') ? '−' : ''}${fmt(Math.abs(row.value))}`;
  const creditPurchaseBase = creditPurchaseEntries.reduce((sum, entry) => sum + getPurchaseBaseCost(entry), 0);
  const totalPurchaseMaterials = inventoryPurchaseEntries.reduce((sum, entry) => sum + (entry.materialCosts?.reduce((a, value) => a + value, 0) ?? 0), 0);
  const totalReturnsInwardCost = returnInwardEntries.reduce((sum, entry) => sum + getInventoryMovementCost(entry, products), 0);
  const totalReturnsOutward = returnOutwardEntries.reduce((sum, entry) => sum + getInventoryMovementCost(entry, products), 0);
  const totalCreditSalePayments = creditSalePaymentEntries.reduce((s, e) => s + e.amount, 0);
  const totalCreditPurchasePayments = creditPurchasePaymentEntries.reduce(
    (sum, entry) => sum + getRecognizedCreditPurchasePaymentCost(entry, entries),
    0,
  );
  const totalCreditSales = creditSaleEntries.reduce((sum, entry) => sum + getGrossSaleValue(entry), 0);
  const totalCashSales = calcCashSales(periodEntries);
  const totalCreditPurchases = creditPurchaseEntries.reduce((sum, entry) => sum + supplierPurchasePayable(entry), 0)
    + creditExpenseEntries.reduce((sum, e) => sum + e.amount, 0);
  const outstandingDebtors = useMemo(
    () => getOutstandingCredits(balanceEntries, 'sale').reduce((sum, credit) => sum + credit.remainingBalance, 0),
    [balanceEntries],
  );
  const outstandingCreditors = useMemo(
    () => getOutstandingCredits(balanceEntries, 'purchase').reduce((sum, credit) => sum + credit.remainingBalance, 0),
    [balanceEntries],
  );
  // Expenses by category
  const expByCat: Record<string, number> = {};
  pnlReport.itemizedOperatingExpenses.forEach(e => {
    expByCat[e.label] = e.value;
  });

  const renderTxs = (list: Entry[], title: string = 'Transactions', saleAmountMode: 'gross' | 'net' = 'gross', customerReturnLabel = false) => {
    if (list.length === 0) return null;
    return (
      <>
        <Text style={[mStyles.groupLabel, { color: colors.mutedForeground, marginTop: 16 }]}>{title}</Text>
        {list.sort((a,b) => b.createdAt - a.createdAt).map((e, i) => (
          <EntryRow key={e.id ?? i} item={e} index={i} onPress={() => onRowPress(e)} saleAmountMode={saleAmountMode} customerReturnLabel={customerReturnLabel} />
        ))}
      </>
    );
  };
  const openPnlLine = (title: string, predicate: (entry: Entry) => boolean) => {
    const lineDetails: Array<{ label: string; value: string }> = [];
    if (title === 'Revenue') {
      lineDetails.push(
        { label: 'Gross cash sales (before VAT)', value: fmtPnlNaira(totalCashSales) },
        { label: 'Gross credit sales (before VAT)', value: fmtPnlNaira(totalCreditSales) },
        { label: 'Total gross sales', value: fmtPnlNaira(totalCashSales + totalCreditSales) },
        { label: 'Less: sales VAT', value: `−${fmtPnlNaira(salesVAT)}` },
        { label: 'Sales excluding VAT', value: fmtPnlNaira(totalSales) },
        { label: 'Full customer refunds (including VAT)', value: fmtPnlNaira(totalReturns) },
        { label: 'Return VAT reversed', value: fmtPnlNaira(totalReturns - netReturns) },
        { label: 'Less: returns excluding VAT', value: `−${fmtPnlNaira(netReturns)}` },
        { label: 'Revenue', value: fmtPnlNaira(statementRevenue) },
      );
    } else if (title === 'Cost of Sales') {
      lineDetails.push(
        { label: 'Opening stock (fixed at zero)', value: fmtPnlNaira(pnlReport.openingStock) },
        { label: 'Selected-period Purchases', value: fmtPnlNaira(totalCost) },
        { label: 'Less: Closing Stock = Stock Value at period end', value: `−${fmtPnlNaira(stockValue)}` },
        { label: 'Cost of Sales', value: `${totalCOGS < 0 ? '−' : ''}${fmtPnlNaira(totalCOGS)}` },
      );
    } else if (title.startsWith('Gross ')) {
      lineDetails.push(
        { label: 'Revenue', value: fmtPnlNaira(statementRevenue) },
        { label: totalCOGS < 0 ? 'Add: negative Cost of Sales' : 'Less: Cost of Sales', value: `${totalCOGS < 0 ? '+' : '−'}${fmtPnlNaira(totalCOGS)}` },
        { label: title, value: fmtPnlNaira(grossProfit) },
      );
    } else if (title === 'Operating Expenses') {
      pnlReport.itemizedOperatingExpenses.forEach(row => lineDetails.push({ label: row.label, value: fmtPnlNaira(row.value) }));
      lineDetails.push({ label: 'Operating Expenses = Expenses', value: fmtPnlNaira(totalExpenses) });
    } else if (title.startsWith('Operating ')) {
      lineDetails.push(
        { label: 'Gross Profit', value: fmtPnlNaira(grossProfit) },
        { label: 'Less: Operating Expenses', value: `−${fmtPnlNaira(totalExpenses)}` },
        { label: title, value: fmtPnlNaira(grossProfit - totalExpenses) },
      );
    } else if (title === 'Finance Costs') {
      lineDetails.push({ label: 'Interest on loan entries', value: fmtPnlNaira(pnlReport.interestOnLoan) });
    } else if (title.includes('Before Tax')) {
      lineDetails.push(
        { label: 'Operating Profit', value: fmtPnlNaira(pnlReport.operatingProfit) },
        { label: 'Less: Finance costs', value: `−${fmtPnlNaira(pnlReport.interestOnLoan)}` },
        { label: title, value: fmtPnlNaira(profitBeforeTax) },
      );
    } else if (title === 'Tax') {
      lineDetails.push(
        { label: 'Profit before tax', value: fmtPnlNaira(profitBeforeTax) },
        { label: 'Estimated income tax (PIT; not IAS 12)', value: fmtPnlNaira(incomeTax) },
        { label: 'Tax is zero when profit before tax is not positive', value: '' },
      );
    } else {
      lineDetails.push(
        { label: 'Profit before tax', value: fmtPnlNaira(profitBeforeTax) },
        { label: 'Less: estimated income tax (PIT; not IAS 12)', value: `−${fmtPnlNaira(incomeTax)}` },
        { label: `${netProfit >= 0 ? 'Profit' : 'Loss'} for the period (after estimated PIT)`, value: fmtPnlNaira(netProfit) },
      );
    }
    setSelectedPnlLine({
      title,
      entries: periodEntries.filter(predicate),
      details: lineDetails,
      note: 'Amounts are rounded individually; displayed rows may differ by ₦1.',
    });
  };

  type Config = { title: string; accent: string; rows: React.ReactNode };

  const configs: Record<MetricKey, Config> = {
    sales: {
      title: 'Sales Breakdown',
      accent: colors.revenue,
      rows: (
        <>
           {renderTxs([...cashSaleEntries, ...creditSaleEntries], 'Sales excluding VAT (tap for customer total)', 'net')}
           <MetricRow label="Gross cash + credit sales" value={fmt(totalCashSales + totalCreditSales)} />
           <MetricRow label="Less: VAT on sales" value={`−${fmt(salesVAT)}`} valueColor={colors.expense} />
           <MetricRow label="Sales excluding VAT (before returns)" value={fmt(totalSales)} valueColor={colors.revenue} bold />
        </>
      ),
    },
    revenue: {
      title: 'Revenue Breakdown',
      accent: colors.primary,
      rows: (
        <>
            <MetricRow label="Sales excluding VAT" value={fmt(totalSales)} />
            <MetricRow label="Less: Returns Inward (excl. VAT)" value={netReturns > 0 ? `−${fmt(netReturns)}` : fmt(0)} valueColor={netReturns > 0 ? colors.expense : undefined} />
            <MetricRow label="Revenue" value={fmt(dashboardRevenue)} valueColor={colors.primary} bold />
            {renderTxs([...cashSaleEntries, ...creditSaleEntries, ...returnInwardEntries], 'Revenue transactions (excluding VAT); full refunds remain in Returns Inward', 'net', true)}
        </>
      ),
    },
    cost: {
      title: `My Purchases · ${costPeriodLabel}`,
      accent: colors.primary,
      rows: (
        <>
          {purchaseDetails.costRows.map(row => (
            <MetricRow key={row.label} label={row.label} value={purchaseRowValue(row)} bold={row.total} />
          ))}
          <MetricRow label="Supplier payment / balance" value="" bold />
          {purchaseDetails.supplierRows.map(row => (
            <MetricRow key={row.label} label={row.label} value={purchaseRowValue(row)} bold={row.total} />
          ))}
          <MetricRow label="Purchase totals" value="" bold />
          {purchaseDetails.reconciliationRows.map(row => (
            <MetricRow key={row.label} label={row.label} value={purchaseRowValue(row)} />
          ))}
           {renderTxs([...purchaseEntries, ...creditPurchaseEntries, ...returnOutwardEntries])}
        </>
      ),
    },
    expenses: {
      title: 'Expenses Breakdown',
      accent: colors.expense,
      rows: (
        <>
          {Object.entries(expByCat).length === 0
            ? <MetricRow label="No expenses recorded" value="—" />
            : Object.entries(expByCat).map(([label, amount], i) => (
                <MetricRow key={i} label={label} value={fmt(amount)} />
              ))}
          <MetricRow label="Total Expenses" value={fmt(totalExpenses)} valueColor={colors.expense} bold />
          {renderTxs(expenseEntries)}
          {returnOutwardEntries.filter(entry => getSupplierReturnExpense(entry) > 0).map(entry => (
            <MetricRow key={entry.id} label={`Supplier return expense · ${entry.itemName || entry.category}`} value={fmt(getSupplierReturnExpense(entry))} />
          ))}
        </>
      ),
    },
    profit: {
       title: `Profit or Loss Statement, for ${profitStatementYearLabel(range.end, profile.accountingYearEnd)}`,
      accent: colors.primary,
      rows: (
        <>
          <ProfitLossRows
            statementRevenue={statementRevenue}
            totalCOGS={totalCOGS}
            grossProfit={grossProfit}
            totalExpenses={totalExpenses}
            profitBeforeTax={profitBeforeTax}
            incomeTax={incomeTax}
            expByCat={expByCat}
            netProfit={netProfit}
            interestOnLoan={pnlReport.interestOnLoan}
            onLinePress={openPnlLine}
            onTaxPress={() => openPnlLine('Tax', () => false)}
            colors={colors}
          />
        </>
      ),
    },
    credit_sales: {
       title: 'Debtors',
      accent: colors.primary,
      rows: (
        <>
          <MetricRow label={`Debtors outstanding as of ${fmtReportDate(range.end)}`} value={fmt(debtorsBalance)} />
          <MetricRow label="Debtor payments in this period" value={fmt(totalCreditSalePayments)} />
          <MetricRow label="Credit sales in this period" value={fmt(totalCreditSales)} valueColor={colors.primary} bold />
          {renderTxs([...creditSaleEntries, ...creditSalePaymentEntries])}
        </>
      ),
    },
    credit_purchases: {
       title: 'Creditors',
      accent: colors.primary,
      rows: (
        <>
          <MetricRow label={`Creditors outstanding as of ${fmtReportDate(range.end)}`} value={fmt(creditorsBalance)} />
          <MetricRow label="Creditor payments in this period" value={fmt(totalCreditPurchasePayments)} />
          <MetricRow label="Credit purchases & unpaid expenses in this period" value={fmt(totalCreditPurchases)} valueColor={colors.primary} bold />
          {renderTxs([...creditPurchaseEntries, ...creditExpenseEntries, ...creditPurchasePaymentEntries])}
        </>
      ),
    },
    vat: {
      title: 'VAT on Products Sold',
      accent: colors.primary,
      rows: (
        <>
          <MetricRow label="Cash Sales VAT" value={fmt(vatLedger.filter(r => r.kind === 'cash_sale').reduce((s, r) => s + r.vatAmount, 0))} />
          <MetricRow label="Debtors VAT" value={fmt(vatLedger.filter(r => r.kind === 'credit_sale').reduce((s, r) => s + r.vatAmount, 0))} />
          <MetricRow label="Less Return Reversals" value={`−${fmt(vatLedger.filter(r => r.kind === 'return_inward').reduce((s, r) => s + r.vatAmount, 0))}`} />
          <MetricRow label="Total VAT Payable" value={fmt(totalVatOnSales)} valueColor={colors.primary} bold />
          {renderTxs(Array.from(new Map(vatLedger.map(r => [r.entry.id, r.entry])).values()), 'VAT-Affected Transactions')}
        </>
      ),
    },
    stock: {
      title: 'Stock Value Breakdown',
      accent: colors.primary,
      rows: (
        <>
          <MetricRow label="Product · units × landed unit cost" value="Total cost" bold />
          {stockBreakdown.filter(row => row.quantity > 0).map(row => (
            <MetricRow
              key={row.productId}
              label={row.name}
              helperText={`${row.quantity} on hand × ${fmt(row.unitCost)} landed cost per unit`}
              value={fmt(row.totalCost)}
            />
          ))}
          {stockBreakdown.length === 0 && stockValue > 0 && (
            <MetricRow label="Unlinked inventory" helperText="Product quantities are unavailable because no product stock records exist." value={fmt(stockValue)} />
          )}
          {stockBreakdown.length > 0 && stockBreakdown.every(row => row.quantity <= 0) && (
            <MetricRow label="No stock on hand" value={fmt(0)} />
          )}
          <MetricRow label="Total Stock Value" helperText="Base purchase cost plus remaining material/other, handling and carriage costs." value={fmt(stockValue)} valueColor={colors.primary} bold />
        </>
      ),
    },
  };

  const cfg = configs[metricKey];
  const totals: Record<MetricKey, { label: string; value: number; color: string }> = {
    sales: { label: 'Total Sales', value: totalSales, color: colors.revenue },
    revenue: { label: 'Total Revenue', value: dashboardRevenue, color: colors.primary },
    cost: { label: 'My Purchases', value: totalCost, color: colors.primary },
    expenses: { label: 'Total Expenses', value: totalExpenses, color: colors.expense },
    profit: { label: netProfit >= 0 ? 'PROFIT' : 'LOSS', value: netProfit, color: netProfit < 0 ? colors.expense : colors.primary },
    stock: { label: 'Total Stock Value', value: stockValue, color: colors.primary },
     credit_sales: { label: 'Debtors', value: outstandingDebtors, color: colors.primary },
     credit_purchases: { label: 'Creditors', value: outstandingCreditors, color: colors.primary },
    vat: { label: 'Total VAT Payable', value: totalVatOnSales, color: colors.primary },
  };
  const [exporting, setExporting] = useState(false);

  const buildSummaryText = () => {
    const lines: string[] = [`📊 ${cfg.title}`, ''];
    switch (metricKey) {
      case 'sales':
        lines.push(
          `Gross cash + credit sales: ${fmt(totalCashSales + totalCreditSales)}`,
          `Less VAT on sales: −${fmt(salesVAT)}`,
          `Sales excluding VAT (before returns): ${fmt(totalSales)}`,
        );
        break;
      case 'revenue':
        lines.push(
          `Sales excluding VAT: ${fmt(totalSales)}`,
          `Less Returns Inward (excl. VAT): −${fmt(netReturns)}`,
          `Revenue: ${fmt(dashboardRevenue)}`,
        );
        break;
      case 'cost':
        lines.push(
          ...purchaseDetails.costRows.map(row => `${row.label}: ${purchaseRowValue(row)}`),
          'Supplier payment / balance',
          ...purchaseDetails.supplierRows.map(row => `${row.label}: ${purchaseRowValue(row)}`),
          'Purchase totals',
          ...purchaseDetails.reconciliationRows.map(row => `${row.label}: ${purchaseRowValue(row)}`),
        );
        break;
      case 'expenses':
        lines.push(`Operating Expenses: ${fmt(totalExpenses)}`);
        break;
      case 'profit':
        lines.push(
          `Revenue: ${fmtPnlNaira(statementRevenue)}`,
          `Cost of Sales: ${totalCOGS < 0 ? '−' : ''}${fmtPnlNaira(totalCOGS)}`,
          `${grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss'}: ${fmtPnlNaira(grossProfit)}`,
          `Operating Expenses: ${fmtPnlNaira(totalExpenses)}`,
          `${grossProfit - totalExpenses >= 0 ? 'Operating Profit' : 'Operating Loss'}: ${fmtPnlNaira(grossProfit - totalExpenses)}`,
          `Finance costs: ${fmtPnlNaira(pnlReport.interestOnLoan)}`,
          `${profitBeforeTax >= 0 ? 'Profit Before Tax' : 'Loss Before Tax'}: ${fmtPnlNaira(profitBeforeTax)}`,
          `Estimated income tax (PIT; not IAS 12): ${fmtPnlNaira(incomeTax)}`,
          `${netProfit >= 0 ? 'Profit' : 'Loss'} for the period (after estimated PIT): ${fmtPnlNaira(netProfit)}`,
        );
        break;
      case 'credit_sales':
        lines.push(
          `Debtors: ${fmt(totalCreditSales)}`,
          `Debtors Payment: ${fmt(totalCreditSalePayments)}`,
          `Outstanding balance as of ${fmtReportDate(range.end)}: ${fmt(debtorsBalance)}`,
        );
        break;
      case 'credit_purchases':
        lines.push(
          `Creditors: ${fmt(totalCreditPurchases)}`,
          `Creditors Payment: ${fmt(totalCreditPurchasePayments)}`,
          `Outstanding balance as of ${fmtReportDate(range.end)}: ${fmt(creditorsBalance)}`,
        );
        break;
      case 'vat':
        lines.push(
          `Total VAT Payable: ${fmt(totalVatOnSales)}`,
        );
        break;
      case 'stock':
        lines.push(`Total Stock Value: ${fmt(stockValue)}`);
        break;
    }
     lines.push('', `Powered by ProfitNaija`);
    return lines.join('\n');
  };

  const escapeHTML = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const buildHTML = () => {
    const total = totals[metricKey];
    const statementTitles: Partial<Record<MetricKey, string>> = {
      sales: 'Sales Statement', revenue: 'Revenue Statement',
      cost: 'Purchases Statement', expenses: 'Expenses Statement',
      credit_sales: 'Debtors Statement', credit_purchases: 'Creditors Statement', stock: 'Stock Value Statement',
    };
    const statementTitle = statementTitles[metricKey];
    if (statementTitle) {
      const sources = metricKey === 'stock'
        ? balanceEntries.filter(entry => ['sale', 'credit_sale', 'purchase', 'credit_purchase', 'return_inward', 'return_outward', 'opening_stock', 'closing_stock'].includes(entry.type))
        : periodEntries.filter(entry => metricKey === 'sales' ? ['sale', 'credit_sale'].includes(entry.type)
          : metricKey === 'revenue' ? ['sale', 'credit_sale', 'return_inward'].includes(entry.type)
          : metricKey === 'cost' ? ['purchase', 'credit_purchase', 'return_outward'].includes(entry.type)
          : metricKey === 'expenses' ? (isDirectExpenseEntry(entry) && entry.category?.toLowerCase() !== 'interest on loan') || getSupplierReturnExpense(entry) > 0
          : metricKey === 'credit_sales' ? ['credit_sale', 'credit_sale_payment'].includes(entry.type)
          : ['credit_purchase', 'credit_purchase_payment'].includes(entry.type) || entry.type === 'expense' && entry.paymentMode === 'credit' && entry.category?.trim().toLowerCase() !== 'depreciation');
      const details = statementTransactionRows(sources, source => {
        const entry = source as Entry;
        const value = metricKey === 'stock' ? getInventoryMovementCost(entry, products)
          : metricKey === 'sales' || metricKey === 'revenue' ? getSaleValue(entry)
          : metricKey === 'expenses' && getSupplierReturnExpense(entry) > 0 ? getSupplierReturnExpense(entry)
          : metricKey === 'credit_sales' && entry.type === 'credit_sale' ? getGrossSaleValue(entry)
          : metricKey === 'credit_purchases' && entry.type === 'credit_purchase' ? supplierPurchasePayable(entry)
          : entry.type === 'purchase' || entry.type === 'credit_purchase' ? getPurchaseBaseCost(entry) : entry.amount;
        return `${entry.type === 'return_inward' || entry.type === 'return_outward' ? '−' : ''}${fmt(value)}`;
      });
      if (metricKey === 'credit_sales' || metricKey === 'credit_purchases') {
        details.push(
          { label: `Outstanding balances as of ${range.end}`, value: 0, valueStr: '', summaryRow: true },
          ...getOutstandingCredits(balanceEntries, metricKey === 'credit_sales' ? 'sale' : 'purchase').map(credit => ({
            label: `${credit.originalEntry.date} | ${credit.originalEntry.partyName || credit.originalEntry.itemName || credit.originalEntry.category} | ID: ${credit.originalEntry.id}`,
            value: credit.remainingBalance, valueStr: fmt(credit.remainingBalance),
          })),
        );
      }
      const stockRows = metricKey === 'stock' ? stockBreakdown.map(item => ({
        label: `${item.name} | ${item.quantity} units x ${fmt(item.unitCost)} per unit`,
        value: item.totalCost, valueStr: fmt(item.totalCost),
      })) : [];
      return statementToHTML({
        businessName: profile.businessName || 'Business',
        title: statementTitle,
        periodLabel: metricKey === 'stock' ? `balances as of ${fmtReportDate(range.end)}` : range.label,
        rows: [...stockRows, ...statementRowsFromLines(buildSummaryText().split('\n').slice(2, -2)), ...details],
      });
    }
    if (metricKey === 'profit') {
      const n = (value: number) => fmtPnlNaira(value);
      const interestOnLoan = pnlReport.interestOnLoan;
      const operatingExpenses = totalExpenses;
      const operatingProfit = grossProfit - operatingExpenses;

      const statementRows = [
        `<tr class="revenue"><td>Revenue</td><td>${n(statementRevenue)}</td></tr>`,
        `<tr><td>Cost of Sales</td><td>${totalCOGS < 0 ? `+${n(totalCOGS)}` : `(${n(totalCOGS)})`}</td></tr>`,
        `<tr class="subtotal ${grossProfit < 0 ? 'negative' : ''}"><td>${grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss'}</td><td>${n(grossProfit)}</td></tr>`,
        `<tr class="negative"><td>Operating Expenses</td><td>(${n(Math.abs(operatingExpenses))})</td></tr>`,
        `<tr class="subtotal ${operatingProfit < 0 ? 'negative' : ''}"><td>${operatingProfit >= 0 ? 'Operating Profit' : 'Operating Loss'}</td><td>${n(operatingProfit)}</td></tr>`,
         `<tr><td>Finance Costs</td><td>(${n(Math.abs(interestOnLoan))})</td></tr>`,
        `<tr class="subtotal ${profitBeforeTax < 0 ? 'negative' : ''}"><td>${profitBeforeTax >= 0 ? 'Profit Before Tax' : 'Loss Before Tax'}</td><td>${n(profitBeforeTax)}</td></tr>`,
        `<tr><td>Estimated income tax (PIT; not IAS 12)</td><td>(${n(Math.abs(incomeTax))})</td></tr>`,
        `<tr class="total ${netProfit < 0 ? 'negative' : ''}"><td>${netProfit >= 0 ? 'Profit' : 'Loss'} for the period (after estimated PIT)</td><td>${netProfit >= 0 ? '+' : '−'}${n(netProfit)}</td></tr>`,
      ].join('');
      return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><title>${safeBusinessName(profile.businessName)} — Profit or Loss Statement, for ${escapeHTML(profitStatementYearLabel(range.end, profile.accountingYearEnd))}</title>
       <style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;padding:60px;color:#17221b;font-size:14px;line-height:1.6;max-width:800px;margin:0 auto}h1{color:#13733A;margin-bottom:8px;font-size:24px;text-transform:uppercase}h2{font-size:14px;text-transform:uppercase;color:#385044;margin:40px 0 16px;border-bottom:1px solid #13733A;padding-bottom:8px}table{width:100%;border-collapse:collapse;margin-bottom:40px}tr{page-break-inside:avoid;break-inside:avoid}td,th{padding:12px 16px;border-bottom:1px solid #e1e8e2;text-align:left;font-weight:700}td:last-child,th:last-child{text-align:right}th{font-weight:bold;background:#f8f9f8;color:#385044}.revenue td{color:#13733A;font-weight:bold}.subtotal td{background:#f1f6f2;font-weight:bold}.total td{font-size:16px;font-weight:bold;border-top:2px solid #13733A;background:#e8f5e9;color:#13733A}.positive td:last-child{color:#15803D}.negative td{color:#B91C1C}.meta{color:#5f6b63;font-size:12px;margin-bottom:32px}.footer{margin-top:60px;padding-top:24px;border-top:1px solid #d9e2db;color:#7b887e;font-size:12px;text-align:center}</style></head><body>
      <h1>${escapeHTML(profile.businessName || 'Business')}</h1>
       <div style="font-weight:bold;font-size:14px;margin-bottom:4px">Profit or Loss Statement, for ${escapeHTML(profitStatementYearLabel(range.end, profile.accountingYearEnd))}</div>
       <div class="meta">Selected transactions: ${escapeHTML(range.label)}</div>
       <div class="meta">Generated ${escapeHTML(fmtReportDate(new Date().toISOString()))}</div>
      <table><thead><tr><th>Profit &amp; Loss Summary</th><th>${escapeHTML(fmtReportDate(range.end))} (NGN)</th></tr></thead><tbody>${statementRows}</tbody></table>
       <div class="footer">Powered by ProfitNaija</div></body></html>`;
    }
    const breakdown: Array<[string, string]> = [];
    buildSummaryText().split('\n').slice(2, -2).filter(line => line.trim()).forEach(line => {
      const split = line.lastIndexOf(': ');
      breakdown.push([split >= 0 ? line.slice(0, split) : line, split >= 0 ? line.slice(split + 2) : '']);
    });
    const rows = breakdown.map(([label, value]) =>
      `<tr style="page-break-inside: avoid; break-inside: avoid;"><td>${escapeHTML(label)}</td><td>${escapeHTML(value)}</td></tr>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"/>
 <title>${safeBusinessName(profile.businessName)} — ${cfg.title}</title>
 <style>@page{size:A4;margin:18mm}body{font-family:Arial,sans-serif;padding:60px;font-size:15px;line-height:1.6;color:#17221b;} h1{color:#13733A;margin-bottom:8px;font-size:24px;text-transform:uppercase;} table{width:100%;border-collapse:collapse;margin-top:24px;}td{padding:14px 16px;border-bottom:1px solid #e1e8e2;}td:last-child{text-align:right;font-weight:bold;}tfoot td{font-weight:bold;font-size:16px;border-top:2px solid #13733A;background:#e8f5e9;color:#13733A;} tr { page-break-inside: avoid; break-inside: avoid; }</style>
  </head><body><h1>${escapeHTML(profile.businessName || 'Business')}</h1><p>Powered by ProfitNaija · ${escapeHTML(cfg.title)} · ${metricKey === 'stock' ? `As of ${escapeHTML(fmtReportDate(range.end))}` : escapeHTML(range.label)}</p><table><tbody>${rows}</tbody><tfoot><tr><td>${escapeHTML(total.label)}</td><td>${escapeHTML(fmt(total.value))}</td></tr></tfoot></table></body></html>`;
  };

  const handlePrint = async () => {
    setExporting(true);
    try { await Print.printAsync({ html: buildHTML() }); }
    catch (e: any) { Alert.alert('Print Error', e?.message ?? 'Could not print.'); }
    finally { setExporting(false); }
  };

  const generatePDF = async () => (await Print.printToFileAsync({ html: buildHTML() })).uri;
  const handleSavePDF = async () => {
    setExporting(true);
    try {
      const uri = await generatePDF();
       const filename = `${safeBusinessName(profile.businessName)}-${metricKey}-${range.start}-${range.end}.pdf`;
      if (Platform.OS === 'web') {
        const response = await fetch(uri);
        const blob = await response.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob); link.download = filename; link.click();
        URL.revokeObjectURL(link.href);
        Alert.alert('PDF saved', `${filename} downloaded.`);
      } else if (Platform.OS === 'android') {
        const directory = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!directory.granted) return;
        const target = await FileSystem.StorageAccessFramework.createFileAsync(directory.directoryUri, filename, 'application/pdf');
        const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        await FileSystem.writeAsStringAsync(target, base64, { encoding: FileSystem.EncodingType.Base64 });
        Alert.alert('PDF saved', `${filename} saved to your selected folder.`);
      } else {
        const target = `${FileSystem.documentDirectory}${filename}`;
        await FileSystem.copyAsync({ from: uri, to: target });
        Alert.alert('PDF saved', `${filename} saved in ProfitNaija app storage.`);
      }
    } catch (e: any) { Alert.alert('PDF Error', e?.message ?? 'Could not generate PDF.'); }
    finally { setExporting(false); }
  };

  const handleShare = async () => {
    setExporting(true);
    try {
      const uri = await generatePDF();
      if (!(await Sharing.isAvailableAsync())) {
        Alert.alert('Sharing unavailable', 'PDF sharing is not available on this device.');
        return;
      }
       await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${safeBusinessName(profile.businessName)} — ${cfg.title}` });
    } catch (e: any) { Alert.alert('Share Error', e?.message ?? 'Could not share PDF.'); }
    finally { setExporting(false); }
  };

  return (
    <>
    <Modal transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={mStyles.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[mStyles.sheet, { backgroundColor: colors.card }]}>
            <View style={[mStyles.handle, { backgroundColor: colors.border }]} />
            <View style={mStyles.headerRow}>
              <View style={[mStyles.dot, { backgroundColor: cfg.accent }]} />
              <Text style={[mStyles.title, { color: colors.foreground }]}>{cfg.title}</Text>
              <Pressable onPress={onClose} style={[mStyles.closeBtn, { backgroundColor: colors.background }]}>
                <X size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={{ color: colors.mutedForeground, marginBottom: 12 }}>
              {metricKey === 'stock' ? `As of ${fmtReportDate(range.end)}` : range.label}
            </Text>
            {(metricKey === 'credit_sales' || metricKey === 'credit_purchases') && (
              <Text
                accessibilityRole="text"
                style={[mStyles.definition, { color: colors.mutedForeground }]}
              >
                {metricKey === 'credit_sales' ? 'People that are owing me' : 'people that I am owing'}
              </Text>
            )}
            <ScrollView showsVerticalScrollIndicator={false} style={{ flexShrink: 1 }}>
              {cfg.rows}
            </ScrollView>
              <View style={[mStyles.alwaysTotal, { borderTopColor: colors.border, backgroundColor: colors.muted }]}>
                <View style={mStyles.totalLabelStack}>
                  <Text style={[mStyles.totalLabel, { color: totals[metricKey].color }]}>{totals[metricKey].label}</Text>
                  {metricKey === 'credit_sales' && <Text style={[mStyles.totalHelper, { color: colors.mutedForeground }]}>People that are owing me</Text>}
                  {metricKey === 'credit_purchases' && <Text style={[mStyles.totalHelper, { color: colors.mutedForeground }]}>people that I am owing</Text>}
                </View>
               <Text style={[mStyles.totalValue, { color: totals[metricKey].color }]}>{metricKey === 'profit' ? fmtPnlNaira(totals[metricKey].value) : fmt(totals[metricKey].value)}</Text>
             </View>
            {/* Action buttons */}
            <View style={[mStyles.actionRow, { borderTopColor: colors.border }]}>
              <Pressable onPress={handlePrint} disabled={exporting} style={[mStyles.actionBtn, { backgroundColor: colors.muted }]}>
                <Text style={[mStyles.actionBtnTxt, { color: colors.foreground }]}>🖨️ Print</Text>
              </Pressable>
              <Pressable onPress={handleSavePDF} disabled={exporting} style={[mStyles.actionBtn, { backgroundColor: '#1B7A3E' }]}>
                {exporting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={[mStyles.actionBtnTxt, { color: '#fff' }]}>📄 Save PDF</Text>}
              </Pressable>
              <Pressable onPress={handleShare} style={[mStyles.actionBtn, { backgroundColor: colors.muted }]}>
                <Text style={[mStyles.actionBtnTxt, { color: colors.foreground }]}>📤 Share</Text>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
    <Modal transparent animationType="slide" visible={!!selectedPnlLine} onRequestClose={() => setSelectedPnlLine(null)}>
      <Pressable style={mStyles.overlay} onPress={() => setSelectedPnlLine(null)}>
        <Pressable onPress={() => {}}>
          <View style={[mStyles.sheet, { backgroundColor: colors.card }]}>
            <View style={mStyles.headerRow}>
              <Text style={[mStyles.title, { color: colors.foreground }]}>{selectedPnlLine?.title}</Text>
              <Pressable onPress={() => setSelectedPnlLine(null)} style={[mStyles.closeBtn, { backgroundColor: colors.background }]}>
                <X size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={{ color: colors.mutedForeground, marginBottom: 10 }}>Contributing entries for this period</Text>
            <ScrollView style={{ maxHeight: 420 }}>
              {selectedPnlLine?.details.map((row, index) => (
                <MetricRow key={`formula-${index}`} label={row.label} value={row.value} bold={index === selectedPnlLine.details.length - 1} />
              ))}
              {selectedPnlLine?.entries.length ? <Text style={[mStyles.groupLabel, { color: colors.mutedForeground }]}>Source entries</Text> : null}
              {selectedPnlLine?.entries.length ? selectedPnlLine.entries.map((entry, index) => (
                <EntryRow key={entry.id ?? index} item={entry} index={index} onPress={() => { setSelectedPnlLine(null); onRowPress(entry); }} />
              )) : (
                <Text style={{ color: colors.mutedForeground, paddingVertical: 18 }}>No source transactions for this line.</Text>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

const mStyles = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 16, maxHeight: '85%' },
  handle:     { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  headerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  dot:        { width: 10, height: 10, borderRadius: 5 },
  title:      { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold' },
  definition: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: -8, marginBottom: 10 },
  closeBtn:   { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  row:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLeft:    { flex: 1, paddingRight: 12 },
  rowLabel:   { fontSize: 13, fontFamily: 'Inter_400Regular' },
  rowHelper:  { fontSize: 10, lineHeight: 14, fontFamily: 'Inter_400Regular', marginTop: 2 },
  rowValue:   { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'right' },
  rowRight:   { alignItems: 'flex-end', gap: 5 },
  metricActions: { flexDirection: 'row', gap: 5 },
  metricAction: { width: 24, height: 24, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  subtotalRow: { marginVertical: 4 },
  alwaysTotal: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderTopWidth: 1, borderRadius: 10, marginTop: 8 },
  totalLabelStack: { flex: 1, paddingRight: 8 },
  totalLabel: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  totalHelper: { fontSize: 10, lineHeight: 14, fontFamily: 'Inter_400Regular', marginTop: 2 },
  totalValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  groupLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 8, marginBottom: 2 },
  actionRow:  { flexDirection: 'row', gap: 8, marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#E5E7EB' },
  actionBtn:  { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  actionBtnTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});

// ── P&L Rows (Profit modal) ───────────────────────────────────────────────────

function PLSectionHeader({ label, colors }: { label: string; colors: any }) {
  return (
    <View style={[plStyles.sectionHeader, { borderBottomColor: colors.border, backgroundColor: colors.muted + 'AA' }]}>
      <Text style={[plStyles.sectionHeaderText, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

function PLRow({
  label, value, valueColor, bold = false, indent = false, colors,
}: {
  label: string; value: string; valueColor?: string;
  bold?: boolean; indent?: boolean; colors: any;
}) {
  return (
    <View style={[mStyles.row, { borderBottomColor: colors.border, paddingLeft: indent ? 20 : 0 }]}>
      <Text style={[
        mStyles.rowLabel,
        { color: colors.mutedForeground },
        bold && { fontFamily: 'Inter_700Bold', color: colors.foreground },
      ]}>
        {label}
      </Text>
      <Text style={[
        mStyles.rowValue,
        { color: valueColor ?? colors.foreground },
        bold && { fontFamily: 'Inter_700Bold' },
      ]}>
        {value}
      </Text>
    </View>
  );
}

function PLTotal({ label, value, colors }: { label: string; value: number; colors: any }) {
  const isPos = value >= 0;
  const color = isPos ? colors.revenue : '#EF5350';
  return (
    <View style={[
      plStyles.totalRow,
      { borderTopColor: isPos ? colors.revenue + '44' : '#EF535044', backgroundColor: isPos ? colors.revenueBg : '#FFEBEE' },
    ]}>
      <Text style={[plStyles.totalLabel, { color }]}>{label}</Text>
      <Text style={[plStyles.totalValue, { color }]}>
        {value < 0 ? '−' : ''}{fmt(Math.abs(value))}
      </Text>
    </View>
  );
}

interface PLProps {
  statementRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  totalExpenses: number;
  profitBeforeTax: number;
  incomeTax: number;
  expByCat: Record<string, number>;
  netProfit: number;
  interestOnLoan: number;
  onLinePress: (title: string, predicate: (entry: Entry) => boolean) => void;
  onTaxPress: () => void;
  colors: any;
}

function ProfitLossRows({
  statementRevenue, totalCOGS,
  grossProfit, totalExpenses, profitBeforeTax, incomeTax,
  expByCat, netProfit, interestOnLoan, onLinePress, onTaxPress, colors,
}: PLProps) {
  const operatingProfit = grossProfit - totalExpenses;
  const revenueEntries = (entry: Entry) => entry.type === 'sale' || entry.type === 'credit_sale' || entry.type === 'return_inward';
  const costEntries = (entry: Entry) => entry.type === 'purchase' || entry.type === 'credit_purchase' || entry.type === 'return_outward';
  const operatingEntries = (entry: Entry) => isDirectExpenseEntry(entry) && entry.category?.toLowerCase() !== 'interest on loan';
  const financeEntries = (entry: Entry) => isDirectExpenseEntry(entry) && entry.category?.toLowerCase() === 'interest on loan';

  return (
    <>
      <MetricRow label="Revenue" value={fmtPnlNaira(statementRevenue)} bold labelColor={colors.primary} valueColor={colors.primary} onPress={() => onLinePress('Revenue', revenueEntries)} />
      <MetricRow label="Cost of Sales" value={totalCOGS < 0 ? `+${fmtPnlNaira(totalCOGS)}` : `(${fmtPnlNaira(totalCOGS)})`} bold onPress={() => onLinePress('Cost of Sales', costEntries)} />
      <View style={[mStyles.subtotalRow, { backgroundColor: colors.secondary, borderRadius: 8, paddingHorizontal: 8 }]}><MetricRow label={grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss'} value={fmtPnlNaira(grossProfit)} bold valueColor={grossProfit < 0 ? colors.expense : colors.primary} onPress={() => onLinePress(grossProfit >= 0 ? 'Gross Profit' : 'Gross Loss', e => revenueEntries(e) || costEntries(e))} /></View>
      <MetricRow label="Operating Expenses" value={`(${fmtPnlNaira(Math.abs(totalExpenses))})`} bold labelColor={colors.expense} valueColor={colors.expense} onPress={() => onLinePress('Operating Expenses', operatingEntries)} />
      <View style={[mStyles.subtotalRow, { backgroundColor: colors.secondary, borderRadius: 8, paddingHorizontal: 8 }]}><MetricRow label={operatingProfit >= 0 ? 'Operating Profit' : 'Operating Loss'} value={fmtPnlNaira(operatingProfit)} bold labelColor={operatingProfit < 0 ? colors.expense : undefined} valueColor={operatingProfit < 0 ? colors.expense : colors.primary} onPress={() => onLinePress(operatingProfit >= 0 ? 'Operating Profit' : 'Operating Loss', e => revenueEntries(e) || costEntries(e) || operatingEntries(e))} /></View>
      <MetricRow label="Finance Costs" value={`(${fmtPnlNaira(Math.abs(interestOnLoan))})`} bold onPress={() => onLinePress('Finance Costs', financeEntries)} />
      <View style={[mStyles.subtotalRow, { backgroundColor: colors.secondary, borderRadius: 8, paddingHorizontal: 8 }]}><MetricRow label={profitBeforeTax >= 0 ? 'Profit Before Tax' : 'Loss Before Tax'} value={fmtPnlNaira(profitBeforeTax)} bold labelColor={profitBeforeTax < 0 ? colors.expense : undefined} valueColor={profitBeforeTax < 0 ? colors.expense : colors.primary} onPress={() => onLinePress(profitBeforeTax >= 0 ? 'Profit Before Tax' : 'Loss Before Tax', e => revenueEntries(e) || costEntries(e) || operatingEntries(e) || financeEntries(e))} /></View>
      <MetricRow label="Estimated income tax (PIT; not IAS 12)" value={`(${fmtPnlNaira(Math.abs(incomeTax))})`} bold onPress={onTaxPress} />
      <View style={[mStyles.subtotalRow, { backgroundColor: netProfit < 0 ? colors.expense : colors.primary, borderRadius: 8, paddingHorizontal: 8, marginTop: 12 }]}><MetricRow label={netProfit >= 0 ? 'Profit for the period (after estimated PIT)' : 'Loss for the period (after estimated PIT)'} value={`${netProfit >= 0 ? '+' : '−'}${fmtPnlNaira(netProfit)}`} bold valueColor="#fff" onPress={() => onLinePress(netProfit >= 0 ? 'PROFIT' : 'LOSS', e => revenueEntries(e) || costEntries(e) || operatingEntries(e) || financeEntries(e))} /></View>
    </>
  );
}

const plStyles = StyleSheet.create({
  sectionHeader:     { paddingVertical: 8, paddingHorizontal: 2, marginTop: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderRadius: 4 },
  sectionHeaderText: { fontSize: 10, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.8 },
  totalRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderTopWidth: 1, marginTop: 4, borderRadius: 10 },
  totalLabel:        { fontSize: 13, fontFamily: 'Inter_700Bold' },
  totalValue:        { fontSize: 15, fontFamily: 'Inter_700Bold' },
  netRow:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderTopWidth: 2, marginTop: 10, borderRadius: 14 },
  netLabel:          { fontSize: 16, fontFamily: 'Inter_700Bold' },
  netValue:          { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
});

// ── StatCard ──────────────────────────────────────────────────────────────────

type LucideIcon = React.ComponentType<{ size: number; color: string }>;

interface StatCardProps {
  label: string;
  subtitle?: string;
  accessibilityLabel?: string;
  Icon: LucideIcon;
  bgColor: string;
  textColor: string;
  value: number;
  showSign?: boolean;
  onPress: () => void;
  delay?: number;
}

function StatCard({
  label, subtitle, accessibilityLabel, Icon, bgColor, textColor, value, showSign, onPress, delay = 0,
}: StatCardProps) {
  const isNeg = value < 0;
  const sign  = showSign ? (isNeg ? '−' : '+') : '';
  const displayColor = showSign && isNeg ? '#EF5350' : textColor;

  return (
    <Animated.View entering={FadeInDown.delay(delay).springify()} style={{ flex: 1 }}>
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
        style={[styles.statCard, { backgroundColor: bgColor }]}
        accessibilityLabel={accessibilityLabel ?? label}
        accessibilityHint={subtitle ? `${subtitle}. Tap for details.` : 'Tap for details.'}
      >
        <View style={[styles.statIconWrap, { backgroundColor: textColor + '22' }]}>
          <Icon size={16} color={textColor} />
        </View>
        <Text style={[styles.statLabel, { color: textColor }]} numberOfLines={2}>{label}</Text>
        {subtitle ? <Text style={[styles.statSubtitle, { color: textColor + 'CC' }]} numberOfLines={1}>{subtitle}</Text> : null}
        <Text
          style={[styles.statValue, { color: displayColor }]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {sign}{fmt(value)}
        </Text>
        <Text style={[styles.statAllTime, { color: textColor + '55' }]}>Tap for details</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Money account detail ──────────────────────────────────────────────────────

const RECORDED_NOTE = 'Recorded balance from your entries only; not a bank reconciliation. Older records with no mode are treated as cash.';

function MoneyAccountModal({ account, entries, range, onClose }: { account: 'cash' | 'bank' | null; entries: Entry[]; range: DashboardDateRange; onClose: () => void }) {
  const colors = useColors();
  const detail = useMemo(() => {
    if (!account) return null;
    const all = getMoneyAccountMovements(entries, range.end).filter(m => m.account === account);
    const opening = all.filter(m => m.entry.date < range.start).reduce((sum, m) => sum + m.amount, 0);
    const inRange = all.filter(m => m.entry.date >= range.start);
    const net = inRange.reduce((sum, m) => sum + m.amount, 0);
    return { opening, inRange, net, end: opening + net };
  }, [account, entries, range.start, range.end]);
  const { profile } = useProfile();
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const exportStatement = async (mode: 'print' | 'share') => {
    if (!detail || !account) return;
    const title = account === 'cash' ? 'Money in My Hand' : 'Money in My Bank';
    const rows = detail.inRange.map(m => `<tr><td>${esc(m.entry.date)}</td><td>${esc(m.entry.itemName || m.entry.category || m.entry.type)}</td><td>${esc(m.entry.type.replace(/_/g, ' '))}</td><td>${esc(getPaymentModeLabel(m.entry))}</td><td style="text-align:right">${m.amount < 0 ? '-' : '+'}${esc(fmt(Math.abs(m.amount)))}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;font-size:12px}</style></head><body><h1>${esc(profile.businessName || 'Business')}</h1><h2>${esc(title)} - ${esc(range.label)}</h2><p>Opening ${esc(fmt(detail.opening))} | Net ${detail.net < 0 ? '-' : ''}${esc(fmt(Math.abs(detail.net)))} | Closing ${esc(fmt(detail.end))}</p><table><thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Mode</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><p style="font-size:11px;color:#555">${esc(RECORDED_NOTE)}</p></body></html>`;
    try {
      if (mode === 'print') await Print.printAsync({ html });
      else { const { uri } = await Print.printToFileAsync({ html }); await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title }); }
    } catch (e: any) { Alert.alert('Could not export statement', e?.message ?? 'Please try again.'); }
  };
  return (
    <Modal visible={!!account} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,.45)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable onPress={() => {}} style={{ backgroundColor: colors.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, maxHeight: '80%' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={{ color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 18 }}>{account === 'cash' ? 'Money in My Hand' : 'Money in My Bank'}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close"><X size={20} color={colors.mutedForeground} /></Pressable>
          </View>
          {detail && (
            <>
              <MetricRow label={`Opening balance (${fmtReportDate(range.start)})`} value={fmt(detail.opening)} />
              <MetricRow label={`Net movement, ${range.label}`} value={fmt(detail.net)} />
              <MetricRow label={`Balance at ${fmtReportDate(range.end)}`} value={fmt(detail.end)} />
              <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 8 }}>{RECORDED_NOTE}</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable onPress={() => exportStatement('print')} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.secondary, alignItems: 'center' }}><Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Print</Text></Pressable>
                <Pressable onPress={() => exportStatement('share')} style={{ flex: 1, padding: 10, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' }}><Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold' }}>Share PDF</Text></Pressable>
              </View>
              <ScrollView style={{ marginTop: 12 }}>
                {detail.inRange.length === 0 ? (
                  <Text style={{ color: colors.mutedForeground, textAlign: 'center', paddingVertical: 24 }}>No {account} movements in this period.</Text>
                ) : detail.inRange.map(m => (
                  <View key={`${m.entry.id}-${m.entry.type}`} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>{m.entry.itemName || m.entry.category || m.entry.type}</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{fmtDate(m.entry.date)} · {m.entry.type.replace(/_/g, ' ')} · Mode: {getPaymentModeLabel(m.entry)}</Text>
                    </View>
                    <Text style={{ color: m.amount < 0 ? colors.expense : colors.revenue, fontFamily: 'Inter_700Bold' }}>{m.amount < 0 ? '−' : '+'}{fmt(Math.abs(m.amount))}</Text>
                  </View>
                ))}
              </ScrollView>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({ item, index, onPress, saleAmountMode = 'gross', customerReturnLabel = false }: { item: Entry; index: number; onPress: () => void; saleAmountMode?: 'gross' | 'net'; customerReturnLabel?: boolean }) {
  const colors       = useColors();
  const { deleteEntry } = useEntries();
  const isSale       = item.type === 'sale' || item.type === 'credit_sale';
  const isSalePayment = item.type === 'credit_sale_payment';
  const isPurch      = item.type === 'purchase' || item.type === 'credit_purchase';
  const isPurchasePayment = item.type === 'credit_purchase_payment';
  const isReturnInward = item.type === 'return_inward';
  const isReturnOutward = item.type === 'return_outward';
  const isIncoming   = isSale || isSalePayment;
  const isCredit     = item.type === 'credit_sale' || item.type === 'credit_purchase' || isSalePayment || isPurchasePayment;

  const IconComp  = isReturnInward || isReturnOutward ? RotateCcw : isIncoming ? TrendingUp : isPurch || isPurchasePayment ? Package : TrendingDown;
  const iconBg    = isIncoming ? colors.revenueBg : isPurch || isPurchasePayment ? colors.secondary : colors.expenseBg;
  const iconColor = isIncoming ? colors.revenue   : isPurch || isPurchasePayment ? colors.primary   : colors.expense;
  const amtColor  = isIncoming ? colors.revenue   : colors.expense;
  const prefix    = isIncoming ? '+' : '−';
  const displayAmount = isSale || isReturnInward
    ? saleAmountMode === 'net' ? getSaleValue(item) : getGrossSaleValue(item)
    : isSalePayment
      ? item.amount
      : item.amount;
  const creditTag = isCredit ? ' (Credit)' : '';
  const label     = customerReturnLabel && isReturnInward ? "Customer's return" : item.itemName || item.category || item.notes || 'Transaction';

  return (
    <Animated.View entering={FadeInDown.delay(index * 50 + 300).springify()}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.entryRow,
          { backgroundColor: pressed ? colors.muted : colors.card, borderColor: colors.border }
        ]}
      >
        <View style={[styles.entryIcon, { backgroundColor: iconBg }]}>
          <IconComp size={20} color={iconColor} />
        </View>
        <View style={styles.entryInfo}>
          <Text style={[styles.entryLabel, { color: colors.foreground }]} numberOfLines={1}>
            {label}
          </Text>
          <Text style={[styles.entryDate, { color: colors.mutedForeground }]}>
            {fmtDate(item.date)}{['sale', 'credit_sale', 'purchase', 'credit_purchase', 'expense', 'credit_sale_payment', 'credit_purchase_payment'].includes(item.type) ? ` · ${getPaymentModeLabel(item)}` : ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <Text style={[styles.entryAmt, { color: amtColor }]}>{prefix}{saleAmountMode === 'net' && isSale ? fmtSale(displayAmount) : fmt(displayAmount)}</Text>
          {saleAmountMode === 'net' && isSale && <Text style={{ color: colors.mutedForeground, fontSize: 11 }}>excl. VAT</Text>}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Home screen ───────────────────────────────────────────────────────────────

import { TransactionDetailSheet } from '@/components/TransactionDetailSheet';

export default function HomeScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const {
    entries, loading, error, retry, syncStatus, pendingCount, products,
  } = useEntries();
  const { user } = useAuth();
  const { profile } = useProfile();

  const [detailEntry, setDetailEntry] = useState<Entry | null>(null);
  const { dashboardPeriodSelection: periodSelection, setDashboardPeriodSelection: setPeriodSelection } = useAuth();
  const range = resolveDashboardRange(periodSelection, entries, new Date(), profile.accountingYearEnd);
  const [moneyCard, setMoneyCard] = useState<'cash' | 'bank' | null>(null);
  const moneyBalances = useMemo(() => calcMoneyAccountBalances(entries, range.end), [entries, range.end]);

  const topInset    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const stockValue = useMemo(
    () => calcInventoryValueAsOf(products, entries, range.end),
    [products, entries, range.end],
  );
  const periodEntries = useMemo(
    () => dashboardPeriodEntries(entries, range),
    [entries, range.start, range.end],
  );
  const balanceEntries = useMemo(() => dashboardBalanceEntries(entries, range), [entries, range.end]);

  const pnlReport = useMemo(() => buildPnLReport(entries, periodEntries, products, range.end, range.start), [entries, periodEntries, products, range.end, range.start]);
  const totalRevenue = pnlReport.revenue;
  const totalCost = calcCostBalance(periodEntries, products);
  const totalCOGS = pnlReport.cost;
  const grossProfit = pnlReport.grossProfit;
  const totalExpenses = pnlReport.operatingExpenses;
  const profitBeforeTax = pnlReport.profitBeforeTax;
  const incomeTax = pnlReport.tax;
  const netProfit = pnlReport.profitAfterTax;
  const debtorsBalance = useMemo(
    () => getOutstandingCredits(balanceEntries, 'sale').reduce((sum, credit) => sum + credit.remainingBalance, 0),
    [balanceEntries],
  );
  const creditorsBalance = useMemo(
    () => getOutstandingCredits(balanceEntries, 'purchase').reduce((sum, credit) => sum + credit.remainingBalance, 0),
    [balanceEntries],
  );

  const totalSales = calcSalesExcludingVAT(periodEntries);
  const dashboardRevenue = calcDashboardRevenue(periodEntries);

  const [activeMetric, setActiveMetric] = useState<MetricKey | null>(null);

  const openMetric = (key: MetricKey) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveMetric(key);
  };

  const displayName  = profile.fullName || user?.displayName || '';
  const businessName = profile.businessName;
  const initials     = displayName
    ? displayName.trim().split(' ').slice(0, 2).map((w: string) => w[0]).join('').toUpperCase()
    : (user?.email?.[0]?.toUpperCase() ?? '?');

  // ── List header ──────────────────────────────────────────────────────────────

  const ListHeader = (
    <View>
      {/* App header */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: topInset + 16 }]}>
        <Animated.View entering={FadeInUp.springify()} style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>ProfitNaija</Text>
            <View style={styles.headerSubRow}>
              {displayName ? (
                <Text style={styles.headerGreeting} numberOfLines={1}>
                  {businessName ? `${displayName} · ${businessName}` : displayName}
                </Text>
              ) : (
                <Text style={styles.headerSub}>
                  {range.label}
                </Text>
              )}
              <View style={[
                styles.syncChip,
                syncStatus === 'synced' ? styles.syncGreen : styles.syncYellow,
              ]}>
                <View style={[styles.syncDot,
                  { backgroundColor: syncStatus === 'synced' ? '#4CAF50' : '#FFC107' },
                ]} />
                <Text style={[styles.syncTxt,
                  { color: syncStatus === 'synced' ? '#2E7D32' : '#7B5800' },
                ]}>
                  {syncStatus === 'synced' ? 'Synced'
                    : pendingCount > 0 ? `${pendingCount} pending`
                    : 'Connecting…'}
                </Text>
              </View>
            </View>
          </View>

          {/* Profile avatar */}
          <Pressable
            onPress={() => { Haptics.selectionAsync(); router.push('/profile'); }}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.avatarWrap, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
              {profile.photoUri ? (
                <Image source={{ uri: profile.photoUri }} style={styles.avatarImg} />
              ) : initials !== '?' ? (
                <Text style={styles.avatarInitial}>{initials}</Text>
              ) : (
                <UserCircle size={22} color="#fff" strokeWidth={1.8} />
              )}
            </View>
          </Pressable>
        </Animated.View>

        {displayName ? (
          <Text style={[styles.headerDateSub, { color: 'rgba(255,255,255,0.5)' }]}>
            {range.label}
          </Text>
        ) : null}

        <View style={{ backgroundColor: colors.card, borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <DashboardPeriodFilter selection={periodSelection} range={range} onChange={setPeriodSelection} />
        </View>

        <View style={[styles.cardsRow, { marginBottom: 12 }]}>
          <StatCard
            label="Money in My Hand"
            subtitle="Cash balance"
            Icon={Banknote}
            bgColor={colors.card}
            textColor={colors.revenue}
            value={moneyBalances.cash}
            onPress={() => setMoneyCard('cash')}
            delay={30}
          />
          <StatCard
            label="Money in My Bank"
            subtitle="Bank Balance"
            Icon={Boxes}
            bgColor={colors.card}
            textColor={colors.primary}
            value={moneyBalances.bank}
            onPress={() => setMoneyCard('bank')}
            delay={45}
          />
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginBottom: 12 }}>Recorded balances; older records without a mode count as cash.</Text>
        <MoneyAccountModal account={moneyCard} entries={entries} range={range} onClose={() => setMoneyCard(null)} />

        {/* ── 6 stat cards (3 rows × 2) ── */}
        <View style={styles.cardsGrid}>
          {/* Row 1 */}
          <View style={styles.cardsRow}>
            <StatCard
              label="My Sales"
              subtitle="(Sales)"
              accessibilityLabel="My Sales (Sales)"
              Icon={TrendingUp}
              bgColor={colors.card}
              textColor={colors.revenue}
              value={totalSales}
              onPress={() => openMetric('sales')}
              delay={60}
            />
            <StatCard
              label="My Income"
              subtitle="(Revenue)"
              accessibilityLabel="My Income (Revenue)"
              Icon={DollarSign}
              bgColor={colors.card}
              textColor={colors.primary}
              value={dashboardRevenue}
              onPress={() => openMetric('revenue')}
              delay={100}
            />
          </View>
          {/* Outstanding ledgers */}
          <View style={styles.cardsRow}>
            <StatCard
              label="People that are owing me"
              subtitle="(Debtors)"
              accessibilityLabel="Debtors. People that are owing me."
              Icon={UserCircle}
              bgColor={colors.card}
              textColor={colors.primary}
              value={debtorsBalance}
              onPress={() => openMetric('credit_sales')}
              delay={280}
            />
            <StatCard
              label="People that I am owing"
              subtitle="(Supplier / expense creditors)"
              accessibilityLabel="Supplier and expense creditors."
              Icon={Package}
              bgColor={colors.card}
              textColor={colors.primary}
              value={creditorsBalance}
              onPress={() => openMetric('credit_purchases')}
              delay={320}
            />
          </View>
          {/* Row 2 */}
          <View style={styles.cardsRow}>
            <StatCard
              label="My Purchases"
              Icon={ShoppingCart}
              bgColor={colors.card}
              textColor={colors.primary}
              value={totalCost}
              onPress={() => openMetric('cost')}
              delay={140}
            />
            <StatCard
              label="Expenses"
              Icon={Receipt}
              bgColor={colors.card}
              textColor={colors.expense}
              value={totalExpenses}
              onPress={() => openMetric('expenses')}
              delay={180}
            />
          </View>
          {/* Row 3 */}
          <View style={styles.cardsRow}>
            <StatCard
              label="My Profit"
              subtitle="(Net Profit)"
              Icon={Banknote}
              bgColor={colors.profit}
              textColor="#FFFFFF"
              value={netProfit}
              showSign
              onPress={() => openMetric('profit')}
              delay={220}
            />
            <StatCard
              label="Stock Value"
              Icon={Boxes}
              bgColor={colors.card}
              textColor={colors.primary}
              value={stockValue}
              onPress={() => openMetric('stock')}
              delay={260}
            />
          </View>
        </View>
      </View>

      {/* Recent activity */}
      <View style={[styles.sectionRow, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Activity</Text>
        {loading
          ? <ActivityIndicator size="small" color={colors.primary} />
          : <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
              {periodEntries.length} {periodEntries.length === 1 ? 'entry' : 'entries'} in this period
            </Text>}
      </View>

      {error && !loading && (
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); retry(); }}
            style={[styles.errorCard, { backgroundColor: colors.expenseBg, borderColor: colors.expense + '44' }]}
          >
            <AlertCircle size={20} color={colors.expense} />
            <Text style={[styles.errorTxt, { color: colors.expense }]}>{error} — tap to retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const ListEmpty = !error ? (
    loading ? (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.emptyTxt, { color: colors.mutedForeground }]}>Connecting…</Text>
      </View>
    ) : (
      <View style={styles.centerState}>
        <Inbox size={40} color={colors.mutedForeground} />
        <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No transactions in this period</Text>
        <Text style={[styles.emptyTxt, { color: colors.mutedForeground }]}>
          Choose another period or tap + to record a sale, purchase, or expense
        </Text>
      </View>
    )
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={periodEntries}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => <EntryRow item={item} index={index} onPress={() => setDetailEntry(item)} />}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        ListFooterComponent={
          <Text style={[styles.homeFooterCopy, { color: colors.mutedForeground }]}>
            © 2026 ProfitNaija, powered by Bisrotex Investment Synergy Limited, a registered
            Nigerian company with RC: 1700008
          </Text>
        }
        contentContainerStyle={{ paddingBottom: bottomInset + 90 }}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <Animated.View
        entering={FadeInUp.delay(400).springify()}
        style={[styles.fab, { backgroundColor: colors.primary, bottom: bottomInset + 24 }]}
      >
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            router.push('/add-entry');
          }}
          style={styles.fabInner}
        >
          <Plus size={28} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* Metric detail modal */}
      {activeMetric && (
        <MetricDetailModal metricKey={activeMetric} range={range} onClose={() => setActiveMetric(null)} onRowPress={(entry) => setDetailEntry(entry)} />
      )}

      <TransactionDetailSheet asOfDate={range.end} entry={detailEntry} onClose={() => setDetailEntry(null)} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header:       { paddingHorizontal: 16, paddingBottom: 20 },
  headerRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 4 },
  headerTitle:  { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.5 },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' },
  headerGreeting: { fontSize: 13, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.8)', flex: 1 },
  headerSub:    { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)' },
  headerDateSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginBottom: 16, marginTop: -2, color: 'rgba(255,255,255,0.5)' },

  syncChip:   { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  syncGreen:  { backgroundColor: 'rgba(76,175,80,0.18)' },
  syncYellow: { backgroundColor: 'rgba(255,193,7,0.22)' },
  syncDot:    { width: 6, height: 6, borderRadius: 3 },
  syncTxt:    { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  avatarWrap:    { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarImg:     { width: 40, height: 40, borderRadius: 20 },
  avatarInitial: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  cardsGrid: { gap: 10, marginBottom: 4, marginTop: 12 },
  cardsRow:  { flexDirection: 'row', gap: 10 },

  statCard: {
    flex: 1, borderRadius: 16, padding: 14, gap: 5,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
  },
  statIconWrap:  { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  statLabel:     { fontSize: 13, lineHeight: 17, fontFamily: 'Inter_700Bold' },
  statSubtitle: { fontSize: 10, lineHeight: 14, fontFamily: 'Inter_500Medium', marginTop: 1 },
  statValue:     { fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: -0.5, minHeight: 22 },
  statAllTime:   { fontSize: 9, fontFamily: 'Inter_400Regular' },
  sectionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  sectionCount: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  entryRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 10,
    borderRadius: 14, padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  entryIcon:  { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  entryInfo:  { flex: 1, gap: 2 },
  entryLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  entrySub:   { fontSize: 12, fontFamily: 'Inter_400Regular' },
  entryDate:  { fontSize: 11, fontFamily: 'Inter_400Regular' },
  entryAmt:   { fontSize: 15, fontFamily: 'Inter_700Bold', marginLeft: 8, flexShrink: 0 },
  entryActions: { flexDirection: 'row', gap: 6 },
  entryAction: { width: 27, height: 27, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },

  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, borderWidth: 1, padding: 14 },
  errorTxt:  { fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },

  centerState: { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTitle:  { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  emptyTxt:    { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 40 },
  homeFooterCopy: {
    fontSize: 11.5, fontFamily: 'Inter_400Regular', textAlign: 'center',
    paddingHorizontal: 32, paddingTop: 24, lineHeight: 17,
  },

  fab: {
    position: 'absolute', right: 24, width: 60, height: 60, borderRadius: 30,
    shadowColor: '#1B7A3E', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  fabInner: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
