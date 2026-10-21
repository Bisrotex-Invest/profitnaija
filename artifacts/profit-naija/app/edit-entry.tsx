import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, Package, X } from 'lucide-react-native';
import { Entry, EntryType, Product, useEntries } from '@/context/EntriesContext';
import { useCustomers } from '@/context/CustomerContext';
import { useColors } from '@/hooks/useColors';
import { getEntryVAT, getOutstandingCredits } from '@/lib/utils/formulas';
import { getEntryPaymentMode } from '@/lib/utils/moneyAccounts';
import { duplicatePartyEntry, normalizeNigerianPhone } from '@/lib/utils/party';

const number = (value: string) => Number(value.replace(/,/g, '')) || 0;
const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

function ProductPicker({ visible, products, onPick, onClose }: { visible: boolean; products: Product[]; onPick: (product: Product) => void; onClose: () => void }) {
  const colors = useColors();
  return <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}><Pressable style={styles.overlay} onPress={onClose}><View style={[styles.sheet, { backgroundColor: colors.card }]}><Text style={[styles.title, { color: colors.foreground }]}>Select product</Text><FlatList data={products.filter(item => !item.archived)} keyExtractor={item => item.id} renderItem={({ item }) => <Pressable onPress={() => { onPick(item); onClose(); }} style={[styles.productRow, { borderColor: colors.border }]}><Package size={18} color={colors.primary} /><View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{item.name}</Text><Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{item.stockQty} in stock · {money(item.suggestedPrice)}</Text></View></Pressable>} /></View></Pressable></Modal>;
}

export default function EditEntryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id, type } = useLocalSearchParams<{ id: string; type: EntryType }>();
  const { entries, products, updateEntry } = useEntries();
  const { customers, resolveOrUpsertCustomer } = useCustomers();
  const entry = useMemo(() => entries.find(item => item.id === id && item.type === type), [entries, id, type]);
  const [amount, setAmount] = useState(entry ? String(entry.amount) : '');
  const [category, setCategory] = useState(entry?.category ?? '');
  const [notes, setNotes] = useState(entry?.notes ?? '');
  const [date, setDate] = useState(entry?.date ?? '');
  const [quantity, setQuantity] = useState(entry ? String(entry.unitsSold ?? entry.unitsPurchased ?? 1) : '1');
  const [unitPrice, setUnitPrice] = useState(entry ? String(entry.unitSalesPrice ?? entry.baseCost ?? entry.unitPurchasePrice ?? entry.amount) : '');
  const [product, setProduct] = useState<Product | undefined>(() => products.find(item => item.id === entry?.productId));
  const [itemName, setItemName] = useState(entry?.itemName ?? '');
  const [partyName, setPartyName] = useState(entry?.partyName ?? '');
  const [partyPhone, setPartyPhone] = useState(entry?.partyPhone ?? '');
  const [partyAddress, setPartyAddress] = useState(entry?.partyAddress ?? '');
  const [partyEmail, setPartyEmail] = useState(entry?.partyEmail ?? '');
  const [customerId, setCustomerId] = useState(entry?.customerId ?? '');
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [payMode, setPayMode] = useState<'cash' | 'bank'>(entry && getEntryPaymentMode(entry) === 'bank' ? 'bank' : 'cash');
  const sale = type === 'sale' || type === 'credit_sale';
  const purchase = type === 'purchase' || type === 'credit_purchase';
  const isReturn = type === 'return_inward' || type === 'return_outward';
  const isCredit = type === 'credit_sale' || type === 'credit_sale_payment' || type === 'credit_purchase' || type === 'credit_purchase_payment';
  const isQuantityEntry = sale || purchase || isReturn;
  const isCreditPayment = type === 'credit_sale_payment' || type === 'credit_purchase_payment';
  const originalEntry = entry?.linkedCreditEntryId
    ? entries.find(item => item.id === entry.linkedCreditEntryId)
    : undefined;
  const creditStatus = useMemo(() => getOutstandingCredits(
    entries,
    type === 'credit_sale_payment' ? 'sale' : 'purchase',
    entry?.id,
    true,
  ).find(item => item.originalEntry.id === entry?.linkedCreditEntryId), [entries, type, entry?.id, entry?.linkedCreditEntryId]);
  const savedSupplierBaseCost = type === 'return_outward' &&
    typeof entry?.baseCostSnapshot === 'number' &&
    Number.isFinite(entry.baseCostSnapshot) &&
    entry.baseCostSnapshot > 0
    ? entry.baseCostSnapshot
    : undefined;
  const effectiveUnitPrice = type === 'return_outward' && savedSupplierBaseCost !== undefined
    ? savedSupplierBaseCost
    : number(unitPrice);
  const total = isQuantityEntry ? number(quantity) * effectiveUnitPrice : number(amount);
  const isExpenseEntry = type === 'expense';
  const isDepreciationEntry = isExpenseEntry && category.trim().toLowerCase() === 'depreciation';
  const isCreditExpenseEntry = isExpenseEntry && entry?.paymentMode === 'credit';
  const expenseHasPayments = isCreditExpenseEntry && !!entry && entries.some(e => e.linkedCreditEntryId === entry.id);
  const lockedMode: 'credit' | 'non_cash' | null = isCredit && !isCreditPayment ? 'credit' : isDepreciationEntry ? 'non_cash' : isCreditExpenseEntry ? 'credit' : null;
  const showModeSelect = (sale || purchase || isExpenseEntry || isCreditPayment) && !lockedMode;

  const save = async () => {
    if (!entry || !date || !category.trim() || (type === 'return_outward' ? total < 0 : total <= 0) || isQuantityEntry && number(quantity) <= 0 || isQuantityEntry && (type === 'return_outward' ? effectiveUnitPrice < 0 : effectiveUnitPrice <= 0)) {
      Alert.alert('Check entry', 'Enter a date, category, and valid positive amounts.'); return;
    }
    if ((isQuantityEntry) && entry.productId && !product) { Alert.alert('Select product', 'This inventory entry needs a product.'); return; }
    if ((isReturn || (isCredit && !isCreditPayment)) && !itemName.trim() && !product?.name) { Alert.alert('Enter product', 'Enter the item or product name.'); return; }
    if (isCreditExpenseEntry && (!partyName.trim() || !partyPhone.trim())) { Alert.alert('Enter creditor details', 'A credit expense needs the creditor name and phone number.'); return; }
    if (isCredit && !isCreditPayment && (!partyName.trim() || !partyPhone.trim())) { Alert.alert('Enter credit details', 'Enter the customer or supplier name and phone number.'); return; }
    if ((type === 'credit_sale' || type === 'credit_purchase') &&
      duplicatePartyEntry(entries, type === 'credit_sale' ? 'customer' : 'supplier', partyName, partyPhone, entry.id)) {
      Alert.alert('Phone number already used', `This phone number is already registered to a different ${type === 'credit_sale' ? 'customer' : 'supplier'}. Use that party's name, or enter a different number.`);
      return;
    }
    if (isCreditPayment) {
      const available = (creditStatus?.remainingBalance ?? 0) + entry.amount;
      if (!entry.linkedCreditEntryId || number(amount) > available + 0.005) { Alert.alert('Overpayment', 'Payment cannot exceed the available balance.'); return; }
    }
    const qty = Math.floor(number(quantity));
    const stockDelta = purchase || type === 'return_inward' ? qty : sale || type === 'return_outward' ? -qty : 0;
    if (type === 'return_outward' && typeof entry.returnLandedCost === 'number') {
      if (product?.id !== entry.productId) {
        Alert.alert('Cannot change product', 'The saved landed cost belongs to the original product.'); return;
      }
      if (total > entry.returnLandedCost / (entry.unitsSold || 1) * qty + 0.005) {
        Alert.alert('Check supplier credit', 'Credit exceeds the returned landed cost. Record additional compensation separately.'); return;
      }
    }
    const next: Entry = {
      ...entry, amount: entry.vatExclusive && (sale || type === 'return_inward') ? total + Math.round(total * 7.5) / 100 : total, category: category.trim(), notes, date,
      ...((isReturn || isCredit) ? {
        itemName: product?.name ?? itemName.trim(),
      } : {}),
      ...(lockedMode ? { paymentMode: lockedMode } : (sale || purchase || isExpenseEntry || isCreditPayment) ? { paymentMode: payMode } : {}),
      ...(isCreditExpenseEntry ? { partyName: partyName.trim(), partyPhone: partyPhone.trim() } : {}),
      ...((isCredit || sale) && (partyName.trim() || partyPhone.trim() || partyAddress.trim() || partyEmail.trim()) ? {
        partyName: partyName.trim(),
        partyPhone: partyPhone.trim(),
        partyAddress: partyAddress.trim(),
        partyEmail: partyEmail.trim(),
        ...(customerId ? { customerId } : {}),
      } : {}),
      ...(sale ? {
        productId: product?.id,
        // Keep the product name for inventory sales; free-form sales retain
        // their existing itemName rather than incorrectly using category.
        itemName: product?.name ?? entry.itemName,
        unitsSold: qty,
        unitSalesPrice: number(unitPrice),
        vatPaid: getEntryVAT({
          amount: total,
          vatExclusive: entry.vatExclusive,
          unitsSold: qty,
          unitSalesPrice: number(unitPrice),
        }),
        cogsAmount: qty * (product?.costPrice ?? 0),
        stockDelta,
      } : {}),
      ...(purchase ? {
        productId: product?.id, itemName: product?.name ?? entry.itemName, unitsPurchased: qty, baseCost: number(unitPrice), unitPurchasePrice: number(unitPrice),
        purchaseAmount: total + (entry.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0),
        totalLandedCost: total + (entry.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0) + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0),
        ...(typeof entry.purchaseVatCharged === 'boolean' ? {
          purchaseVAT: entry.purchaseVatCharged ? Math.round(total * 7.5) / 100 : 0,
          withholdingTax: entry.purchaseVatCharged ? Math.round(total * 5) / 100 : 0,
        } : {}),
        supplierPayable: total + (entry.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0)
          + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0)
          + (typeof entry.purchaseVatCharged === 'boolean'
            ? entry.purchaseVatCharged ? Math.round(total * 7.5) / 100 - Math.round(total * 5) / 100 : 0
            : (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0)),
        amount: total + (entry.materialCosts?.reduce((sum, cost) => sum + cost, 0) ?? 0)
          + (entry.carriageInward ?? 0) + (entry.handlingCost ?? 0)
          + (typeof entry.purchaseVatCharged === 'boolean'
            ? entry.purchaseVatCharged ? Math.round(total * 7.5) / 100 - Math.round(total * 5) / 100 : 0
            : (entry.purchaseVAT ?? 0) - (entry.withholdingTax ?? 0)),
        stockDelta,
      } : {}),
      ...(isReturn ? {
        productId: product?.id,
        itemName: product?.name ?? itemName.trim(),
        unitsSold: qty,
        unitSalesPrice: type === 'return_outward' ? effectiveUnitPrice : number(unitPrice),
        ...(type === 'return_outward' && typeof entry.returnLandedCost === 'number' ? {
          returnLandedCost: Math.round(entry.returnLandedCost / (entry.unitsSold || 1) * qty * 100) / 100,
          baseCostSnapshot: entry.baseCostSnapshot,
        } : {}),
        ...(type === 'return_inward' ? {
          vatPaid: getEntryVAT({
            amount: total,
            vatExclusive: entry.vatExclusive,
            unitsSold: qty,
            unitSalesPrice: number(unitPrice),
          }),
          returnVat: getEntryVAT({
            amount: total,
            vatExclusive: entry.vatExclusive,
            unitsSold: qty,
            unitSalesPrice: number(unitPrice),
          }),
          baseCostSnapshot: product?.costPrice ?? entry.baseCostSnapshot ?? (entry.cogsAmount && (entry.unitsSold ?? 0) > 0 ? entry.cogsAmount / (entry.unitsSold ?? 1) : undefined),
        } : {}),
        cogsAmount: type === 'return_outward' && savedSupplierBaseCost !== undefined
          ? qty * savedSupplierBaseCost
          : type === 'return_outward' && entry.cogsAmount && entry.unitsSold
          ? qty * entry.cogsAmount / entry.unitsSold
          : product ? qty * product.costPrice : entry.cogsAmount,
        stockDelta,
      } : {}),
    };
    if (isCreditPayment && originalEntry) {
      next.linkedCreditEntryId = originalEntry.id;
      next.itemName = originalEntry.itemName;
      next.partyName = originalEntry.partyName;
      next.partyPhone = originalEntry.partyPhone;
      if (type === 'credit_sale_payment') {
        const vatTotal = getEntryVAT(originalEntry);
        const previousVat = creditStatus?.vatPaidToDate ?? 0;
        const available = creditStatus?.remainingBalance ?? entry.amount;
        next.allocatedVat = Math.abs(number(amount) - available) < 0.005
          ? Math.max(0, vatTotal - previousVat)
          : Math.floor((number(amount) / (creditStatus?.grossAmount ?? originalEntry.amount)) * vatTotal * 100) / 100;
      }
    }
    setSaving(true);
    try {
      if ((type === 'credit_sale' || type === 'sale') && (partyName.trim() || partyPhone.trim())) {
        let resolved = customerId || (saveCustomer
          ? (partyPhone.trim()
            ? `phone_${normalizeNigerianPhone(partyPhone)}`
            : `customer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`)
          : undefined);
        if (saveCustomer) {
          try {
            resolved = await resolveOrUpsertCustomer({
              customerId: customerId || undefined, fullName: partyName, phone: partyPhone,
              homeAddress: partyAddress, email: partyEmail,
            });
          } catch (error: any) {
            console.warn('[customer] enrichment deferred until sync', error?.message ?? error);
          }
        }
        if (resolved) next.customerId = resolved;
        next.partyAddress = partyAddress; next.partyEmail = partyEmail;
      }
      await updateEntry(entry.id, entry.type, next); router.back();
    }
    catch (error: any) { Alert.alert('Could not update entry', error?.message ?? 'Please try again.'); }
    finally { setSaving(false); }
  };
  const isExpense = type === 'expense';
  const EXPENSE_CATEGORIES = ['Depreciation', 'Miscellaneous Expenses', 'Rent', 'Salary', 'Transport', 'Utilities', 'Tax', 'LUNCH', 'BREAKFAST', 'DINNER', 'MISCELLANEOUS', 'MAINTENANCE', 'MARKETING', 'EQUIPMENT', 'P.R', 'Interest on Loan', 'OTHERS'];
  const formatCategoryLabel = (cat: string) => cat ? cat.charAt(0).toUpperCase() + cat.slice(1).toLowerCase() : cat;

  if (!entry) return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.mutedForeground }}>Loading entry…</Text></View>;
  return <View style={[styles.page, { backgroundColor: colors.background, paddingTop: Platform.OS === 'web' ? 67 : insets.top }]}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><Text style={[styles.title, { color: colors.foreground }]}>Edit {sale ? 'sale' : purchase ? 'purchase' : isReturn ? 'return' : isCredit ? 'credit payment' : 'expense'}</Text><Pressable onPress={() => router.back()}><X color={colors.mutedForeground} /></Pressable></View>
    {isQuantityEntry && <><Text style={[styles.label, { color: colors.mutedForeground }]}>Product</Text><Pressable onPress={() => setPickerOpen(true)} style={[styles.select, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={{ color: product ? colors.foreground : colors.mutedForeground }}>{product?.name ?? 'Select product'}</Text><ChevronDown size={17} color={colors.mutedForeground} /></Pressable><Field label="Quantity" value={quantity} setValue={setQuantity} colors={colors} keyboard="number-pad" /><Field label={type === 'return_outward' ? 'Supplier credit per unit (saved base cost)' : purchase ? 'Unit purchase cost' : isReturn ? 'Unit return amount' : 'Unit selling price'} value={unitPrice} setValue={setUnitPrice} colors={colors} keyboard="decimal-pad" editable={savedSupplierBaseCost === undefined} /><Text style={[styles.total, { color: colors.primary }]}>Total: {money(total)}</Text></>}
    {!isQuantityEntry && <Field label="Amount" value={amount} setValue={setAmount} colors={colors} keyboard="decimal-pad" />}
    {(isReturn || isCredit) && <Field label="Item / Product Name" value={product?.name ?? itemName} setValue={setItemName} colors={colors} />}
    {isCredit && <>{type === 'credit_sale' && <Pressable onPress={() => setCustomerPickerOpen(true)} style={[styles.select, { borderColor: colors.border, backgroundColor: colors.card }]}><Text style={{ color: colors.foreground }}>{customerId ? 'Existing customer selected' : 'Select existing customer'}</Text><ChevronDown size={17} color={colors.mutedForeground} /></Pressable>}<Field label={type === 'credit_sale' || type === 'credit_sale_payment' ? 'Customer Name' : 'Supplier Name'} value={partyName} setValue={(v) => { setPartyName(v); setCustomerId(''); }} colors={colors} /><Field label="Phone Number" value={partyPhone} setValue={(v) => { setPartyPhone(v); setCustomerId(''); }} colors={colors} keyboard="phone-pad" />{type === 'credit_sale' && <><Field label="Address (optional)" value={partyAddress} setValue={setPartyAddress} colors={colors} /><Field label="Email (optional)" value={partyEmail} setValue={setPartyEmail} colors={colors} keyboard="default" /><Pressable onPress={() => setSaveCustomer(value => !value)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}><Check size={18} color={saveCustomer ? colors.primary : colors.mutedForeground} /><Text style={{ color: colors.foreground }}>Save customer for future sales</Text></Pressable><Modal visible={customerPickerOpen} transparent animationType="slide" onRequestClose={() => setCustomerPickerOpen(false)}><Pressable style={styles.overlay} onPress={() => setCustomerPickerOpen(false)}><View style={[styles.sheet, { backgroundColor: colors.card }]}><Text style={[styles.title, { color: colors.foreground }]}>Customers</Text><Pressable style={styles.productRow} onPress={() => { setCustomerId(''); setPartyName(''); setPartyPhone(''); setPartyAddress(''); setPartyEmail(''); setCustomerPickerOpen(false); }}><Text style={{ color: colors.primary }}>＋ New customer</Text></Pressable><FlatList data={customers} keyExtractor={item => item.id} renderItem={({ item }) => <Pressable style={styles.productRow} onPress={() => { setCustomerId(item.id); setPartyName(item.fullName); setPartyPhone(item.phone); setPartyAddress(item.homeAddress); setPartyEmail(item.email ?? ''); setCustomerPickerOpen(false); }}><Text style={{ color: colors.foreground }}>{item.fullName} · {item.phone}</Text></Pressable>} /></View></Pressable></Modal></>}</>}

    {sale && <><Field label="Customer name (optional)" value={partyName} setValue={setPartyName} colors={colors} /><Field label="Customer phone (optional)" value={partyPhone} setValue={setPartyPhone} colors={colors} keyboard="phone-pad" /><Field label="Address (optional)" value={partyAddress} setValue={setPartyAddress} colors={colors} /><Field label="Email (optional)" value={partyEmail} setValue={setPartyEmail} colors={colors} /><Pressable onPress={() => setSaveCustomer(value => !value)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Check size={18} color={saveCustomer ? colors.primary : colors.mutedForeground} /><Text style={{ color: colors.foreground }}>Save customer for future sales</Text></Pressable></>}
    <View style={{ marginBottom: 8 }}>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>Mode of Payment</Text>
      {showModeSelect ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {(['cash', 'bank'] as const).map(m => (
            <Pressable key={m} onPress={() => setPayMode(m)} style={[styles.categoryChip, { backgroundColor: payMode === m ? colors.primary : colors.muted, borderColor: payMode === m ? colors.primary : colors.border }]}>
              <Text style={[styles.categoryText, { color: payMode === m ? '#fff' : colors.foreground }]}>{m === 'cash' ? 'Cash' : 'Bank'}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={[styles.input, { borderColor: colors.border, backgroundColor: colors.card, paddingVertical: 10, marginTop: 6 }]}>
          <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>{lockedMode === 'non_cash' ? 'Non-cash' : lockedMode === 'credit' ? 'Credit' : 'Cash'}</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>
            {lockedMode === 'non_cash'
              ? 'Depreciation has no cash, bank or credit outflow.'
              : expenseHasPayments
                ? 'This credit expense has recorded payments, so it must stay on credit. Edit or delete the payments first.'
                : 'A paid record cannot be converted to credit, and a credit record cannot be converted to paid. Delete it and add the corrected entry instead.'}
          </Text>
        </View>
      )}
      {isExpenseEntry && !lockedMode && <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 4 }}>Paid expenses can switch between Cash and Bank only.</Text>}
    </View>
    {isCreditExpenseEntry && <>
      <Field label="Creditor Name" value={partyName} setValue={setPartyName} colors={colors} />
      <Field label="Phone Number" value={partyPhone} setValue={setPartyPhone} colors={colors} keyboard="phone-pad" />
    </>}
    {isExpense && (
      <View style={{ marginBottom: 12 }}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>Category</Text>
        <View style={styles.categoryGrid}>
          {EXPENSE_CATEGORIES.map(cat => {
            const isSelected = category.toLowerCase() === cat.toLowerCase();
            return (
              <Pressable
                key={cat}
                onPress={() => setCategory(cat)}
                style={[
                  styles.categoryChip,
                  { backgroundColor: isSelected ? colors.primary : colors.muted, borderColor: isSelected ? colors.primary : colors.border }
                ]}
              >
                <Text style={[styles.categoryText, { color: isSelected ? '#fff' : colors.foreground }]}>{formatCategoryLabel(cat)}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    )}

    <Field label={isExpense ? "Custom Category (optional)" : "Category"} value={category} setValue={setCategory} colors={colors} />
    <Field label="Date (YYYY-MM-DD)" value={date} setValue={setDate} colors={colors} />
    <Field label="Notes" value={notes} setValue={setNotes} colors={colors} multiline />
    <Pressable disabled={saving} onPress={save} style={[styles.save, { backgroundColor: colors.primary, opacity: saving ? .7 : 1 }]}>{saving ? <ActivityIndicator color="#fff" /> : <><Check size={18} color="#fff" /><Text style={styles.saveTxt}>Save changes</Text></>}</Pressable>
  </ScrollView><ProductPicker visible={pickerOpen} products={products} onPick={setProduct} onClose={() => setPickerOpen(false)} /></View>;
}
function Field({ label, value, setValue, colors, keyboard = 'default', multiline = false, editable = true }: { label: string; value: string; setValue: (text: string) => void; colors: any; keyboard?: 'default' | 'decimal-pad' | 'number-pad' | 'phone-pad'; multiline?: boolean; editable?: boolean }) {
  return <View><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text><TextInput value={value} onChangeText={setValue} keyboardType={keyboard} multiline={multiline} editable={editable} style={[styles.input, multiline && { height: 86, textAlignVertical: 'top' }, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} /></View>;
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 20, paddingBottom: 45, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 21 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 12, marginTop: 3 },
  input: { borderWidth: 1, borderRadius: 11, minHeight: 45, paddingHorizontal: 12, fontFamily: 'Inter_400Regular' },
  select: { borderWidth: 1, borderRadius: 11, height: 45, paddingHorizontal: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  total: { textAlign: 'right', fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 6 },
  save: { minHeight: 51, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 12 },
  saveTxt: { color: '#fff', fontFamily: 'Inter_700Bold', fontSize: 15 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,.45)', justifyContent: 'flex-end' },
  sheet: { padding: 20, borderTopLeftRadius: 22, borderTopRightRadius: 22, maxHeight: '70%' },
  productRow: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 100, borderWidth: 1 },
  categoryText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
});