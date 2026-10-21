import React from 'react';
import { Modal, View, Text, StyleSheet, Pressable, Alert, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native';
import { X, Pencil, Trash2, Printer, Share2 } from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';
import { Entry, useEntries } from '@/context/EntriesContext';
import { getEntryVAT, getPurchaseBaseCost, getSaleValue, getGrossSaleValue, getSupplierReturnExpense } from '@/lib/utils/formulas';
import { useProfile } from '@/context/ProfileContext';
import { getPaymentModeLabel } from '@/lib/utils/moneyAccounts';
import { getPurchaseSettlement } from '@/lib/utils/purchaseSettlement';
import { getInvoiceGross, printInvoice, shareInvoice } from '@/lib/utils/invoice';

function fmtDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}
function fmtTimestamp(value: number): string {
  if (!Number.isFinite(value)) return 'Pending sync';
  return new Date(value).toLocaleString('en-NG', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}
import { router } from 'expo-router';
import { isAccountingEntry, creditReturnTotal } from '@workspace/accounting-core';
import Animated, { FadeInUp } from 'react-native-reanimated';

const NAIRA = '₦';
function fmtNum(n: number): string {
  return Math.abs(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt(n: number): string {
  return NAIRA + fmtNum(n);
}

export function TransactionDetailSheet({ entry, onClose, asOfDate }: { entry: Entry | null, onClose: () => void, asOfDate?: string }) {
  const colors = useColors();
  const { height } = useWindowDimensions();
  const { deleteEntry, entries } = useEntries();
  const { profile } = useProfile();
  const [invoiceAction, setInvoiceAction] = React.useState<'print' | 'share' | null>(null);

  if (!entry) return null;

  const handleEdit = () => {
    onClose();
    if (isAccountingEntry(entry)) { router.push(entry.type === ('financial_record' as string) ? '/finance' : '/equity'); return; }
    router.push({ pathname: '/edit-entry', params: { id: entry.id, type: entry.type } });
  };

  const handleDelete = () => {
    if (isAccountingEntry(entry)) { onClose(); router.push(entry.type === ('financial_record' as string) ? '/finance' : '/equity'); return; }
    Alert.alert('Delete entry?', 'Delete this transaction? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          await deleteEntry(entry.id, entry.type);
          onClose();
        } catch (error: any) {
          Alert.alert('Error', error?.message ?? 'Please try again.');
        }
      }}
    ]);
  };

  const label = entry.itemName || entry.category || entry.notes || 'Transaction';
  const isSale = entry.type === 'sale' || entry.type === 'credit_sale';
  const isReturnInward = entry.type === 'return_inward';
  const isReturnOutward = entry.type === 'return_outward';
  const isPurchase = entry.type === 'purchase' || entry.type === 'credit_purchase';
  const purchaseQuantity = entry.unitsPurchased ?? 0;
  const ps = isPurchase ? getPurchaseSettlement(entry, entries, asOfDate) : null;
  const grossReturnAmount = isReturnInward && typeof entry.unitsSold === 'number' && typeof entry.unitSalesPrice === 'number'
    ? entry.unitsSold * entry.unitSalesPrice
    : entry.amount;
  const amount = isSale ? getGrossSaleValue(entry) : isReturnInward ? getSaleValue(entry) : entry.amount;
  const paidToDate = entry.type === 'credit_sale'
    ? entries
      .filter(candidate => candidate.type === 'credit_sale_payment' && candidate.linkedCreditEntryId === entry.id)
      .reduce((sum, payment) => sum + Math.max(0, payment.amount), 0)
    : getInvoiceGross(entry);
  const runInvoiceAction = async (action: 'print' | 'share') => {
    setInvoiceAction(action);
    try {
      const returnCredits = creditReturnTotal(entries, entry.id, 'sale');
      if (action === 'print') await printInvoice(entry, profile, paidToDate, returnCredits);
      else await shareInvoice(entry, profile, paidToDate, returnCredits);
    } catch (error: any) {
      Alert.alert(action === 'print' ? 'Could not print invoice' : 'Could not share invoice', error?.message ?? 'Please try again.');
    } finally {
      setInvoiceAction(null);
    }
  };

  return (
    <Modal transparent animationType="fade" visible={!!entry} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[styles.sheet, { backgroundColor: colors.card }]}>
            <View style={styles.header}>
              <Text style={[styles.title, { color: colors.foreground }]}>Transaction Details</Text>
              <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: colors.background }]}>
                <X size={18} color={colors.mutedForeground} />
              </Pressable>
            </View>

             <ScrollView style={{ maxHeight: height * 0.55 }} contentContainerStyle={styles.content}>
              <DetailRow label="Description" value={label} colors={colors} />
              <DetailRow label="Date" value={fmtDate(entry.date)} colors={colors} />
              <DetailRow label="Time Created" value={fmtTimestamp(entry.createdAt)} colors={colors} />
              <DetailRow label="Type" value={entry.type.replace(/_/g, ' ').toUpperCase()} colors={colors} />
              {['sale', 'credit_sale', 'purchase', 'credit_purchase', 'expense', 'credit_sale_payment', 'credit_purchase_payment'].includes(entry.type) && (
                <DetailRow label="Mode of Payment" value={getPaymentModeLabel(entry)} colors={colors} />
              )}
              <DetailRow label="Category" value={entry.category || 'None'} colors={colors} />
              {isPurchase ? (
                <>
                  <DetailRow label="Units Purchased" value={purchaseQuantity > 0 ? String(purchaseQuantity) : 'Not recorded'} colors={colors} />
                  {purchaseQuantity > 0 ? <DetailRow label="Base cost per unit" value={fmt(getPurchaseBaseCost(entry) / purchaseQuantity)} colors={colors} /> : null}
                  <DetailRow label="PURCHASE COST" value="" colors={colors} bold />
                  <DetailRow label="Base goods" value={fmt(ps!.base)} colors={colors} />
                  <DetailRow label="Material / direct costs" value={fmt(ps!.materials)} colors={colors} />
                  <DetailRow label="Carriage / handling" value={fmt(ps!.carriage + ps!.handling)} colors={colors} />
                  {purchaseQuantity > 0 ? <DetailRow label={`Landed cost per unit (${purchaseQuantity} units)`} value={fmt(ps!.landed / purchaseQuantity)} colors={colors} /> : null}
                  <DetailRow label="TOTAL LANDED COST (excl. recoverable VAT)" value={fmt(ps!.landed)} colors={colors} bold />
                  <DetailRow label="SUPPLIER PAYMENT / BALANCE" value="" colors={colors} bold />
                  <DetailRow label="Recoverable input VAT (7.5%)" value={fmt(ps!.vat)} colors={colors} />
                  <DetailRow label="Less withholding deduction" value={`-${fmt(ps!.withholding)}`} colors={colors} />
                  <DetailRow label="TOTAL PAYABLE" value={fmt(ps!.payable)} colors={colors} bold />
                  <DetailRow label={ps!.isCredit ? 'Paid to date' : 'Paid (cash purchase)'} value={fmt(ps!.paid)} colors={colors} />
                  {!!ps!.returnCredits && <DetailRow label="Reviewed return credits" value={fmt(ps!.returnCredits)} colors={colors} />}
                  <DetailRow label="OUTSTANDING SUPPLIER BALANCE" value={fmt(ps!.outstanding)} colors={colors} bold />
                </>
              ) : null}
              {(isSale || isReturnInward || isReturnOutward) && typeof entry.unitsSold === 'number' ? <DetailRow label={isSale ? 'Quantity Sold' : 'Quantity Returned'} value={String(entry.unitsSold)} colors={colors} /> : null}
              {(isSale || isReturnInward) && typeof entry.unitSalesPrice === 'number' ? <DetailRow label="Unit Price" value={fmt(entry.unitSalesPrice)} colors={colors} /> : null}
              {isReturnOutward ? (
                <>
                  <DetailRow label="Base-cost snapshot per unit" value={typeof entry.baseCostSnapshot === 'number' ? fmt(entry.baseCostSnapshot) : 'Not recorded'} colors={colors} />
                  <DetailRow label="Current supplier credit per unit" value={typeof entry.unitSalesPrice === 'number' ? fmt(entry.unitSalesPrice) : 'Not recorded'} colors={colors} />
                  <DetailRow label="Returned inventory at landed cost" value={typeof entry.returnLandedCost === 'number' ? fmt(entry.returnLandedCost) : 'Not recorded'} colors={colors} />
                  <DetailRow label="Supplier return expense" value={typeof entry.returnLandedCost === 'number' ? fmt(getSupplierReturnExpense(entry)) : 'Not calculated — landed cost not recorded'} colors={colors} />
                  {typeof entry.supplierCreditOriginalAmount === 'number' ? (
                    <DetailRow label="Credit recorded before base-cost correction" value={fmt(entry.supplierCreditOriginalAmount)} colors={colors} />
                  ) : null}
                </>
              ) : null}
              {isSale ? <DetailRow label="Base sale amount" value={fmt(getSaleValue(entry))} colors={colors} /> : null}
              {isReturnInward ? <DetailRow label="Gross Return Amount" value={fmt(grossReturnAmount)} colors={colors} /> : null}
              {isSale ? <DetailRow label="VAT (7.5% of base sale)" value={fmt(getEntryVAT(entry))} colors={colors} /> : null}
              {isReturnInward ? <DetailRow label="VAT Reversed" value={fmt(getEntryVAT(entry))} colors={colors} valueColor={colors.expense} /> : null}
               <DetailRow label={isSale ? 'Customer total (base + VAT)' : isReturnInward ? 'Net Return Amount' : isReturnOutward ? 'Supplier credit (current base-cost credit)' : isPurchase ? 'Recorded entry amount' : 'Amount'} value={fmt(amount)} colors={colors} valueColor={isSale || entry.type === 'credit_sale_payment' ? colors.revenue : colors.expense} bold />
              {entry.notes ? <DetailRow label="Notes" value={entry.notes} colors={colors} /> : null}
              {entry.partyName ? <DetailRow label="Party Name" value={entry.partyName} colors={colors} /> : null}
              {entry.partyPhone ? <DetailRow label="Customer Phone" value={entry.partyPhone} colors={colors} /> : null}
             </ScrollView>

            {isSale ? (
              <View style={styles.invoiceActions}>
                <Pressable disabled={!!invoiceAction} onPress={() => runInvoiceAction('print')} style={[styles.invoiceBtn, { backgroundColor: colors.primary }]}>
                  {invoiceAction === 'print' ? <ActivityIndicator size="small" color="#fff" /> : <Printer size={16} color="#fff" />}
                  <Text style={styles.invoiceText}>{invoiceAction === 'print' ? 'Printing…' : 'Print Invoice'}</Text>
                </Pressable>
                <Pressable disabled={!!invoiceAction} onPress={() => runInvoiceAction('share')} style={[styles.invoiceBtn, { backgroundColor: colors.secondary }]}>
                  {invoiceAction === 'share' ? <ActivityIndicator size="small" color={colors.primary} /> : <Share2 size={16} color={colors.primary} />}
                  <Text style={[styles.invoiceText, { color: colors.primary }]}>{invoiceAction === 'share' ? 'Preparing…' : 'Share Invoice'}</Text>
                </Pressable>
              </View>
            ) : null}

            <View style={styles.actions}>
              <Pressable onPress={handleEdit} style={[styles.actionBtn, { backgroundColor: colors.secondary }]}>
                <Pencil size={16} color={colors.primary} />
                <Text style={[styles.actionText, { color: colors.primary }]}>Edit</Text>
              </Pressable>
              <Pressable onPress={handleDelete} style={[styles.actionBtn, { backgroundColor: colors.expenseBg }]}>
                <Trash2 size={16} color={colors.expense} />
                <Text style={[styles.actionText, { color: colors.expense }]}>Delete</Text>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function DetailRow({ label, value, colors, valueColor, bold }: any) {
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]}>
      <Text style={[styles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: valueColor || colors.foreground, fontFamily: bold ? 'Inter_700Bold' : 'Inter_500Medium' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 40 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  closeBtn: { padding: 6, borderRadius: 16 },
  content: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  rowValue: { fontSize: 14, maxWidth: '65%', textAlign: 'right' },
  actions: { flexDirection: 'row', gap: 12, marginTop: 24 },
  invoiceActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  invoiceBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, gap: 7 },
  invoiceText: { color: '#fff', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, gap: 8 },
  actionText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' }
});