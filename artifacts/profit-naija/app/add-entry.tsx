import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
import { useEntries, EntryType, Product } from '@/context/EntriesContext';
import { useCustomers, Customer } from '@/context/CustomerContext';
import {
  TrendingUp, TrendingDown, ShoppingCart, Archive,
  Plus, Minus, X, CheckCircle, AlertCircle,
  Package, Tag, Info, Pencil, RotateCcw,
  ChevronDown, ChevronRight,
} from 'lucide-react-native';
import { INDUSTRIES, INDUSTRY_MARKUP, Industry } from '@/constants/markup';
import {
  calculateSuggestedPrice, formatVATPrice, extractVATAmount, VAT_RATE,
} from '@/lib/utils/price';
import { getEntryVAT, getOutstandingCredits, getStockValueBreakdown } from '@/lib/utils/formulas';
import { duplicatePartyEntry, normalizeNigerianPhone } from '@/lib/utils/party';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

type UiEntryType = 'sale' | 'credit_sale' | 'purchase' | 'credit_purchase' | 'expense' | 'stock' | 'return_inward' | 'return_outward';

const NAIRA = '₦';
const SALE_CATEGORIES = ['Goods', 'Services', 'Online', 'Wholesale', 'Retail', 'Other'];
const CREDIT_SALE_CATEGORIES = ['Goods (Credit)', 'Services (Credit)', 'Wholesale (Credit)', 'Online (Credit)', 'Other'];
const CREDIT_SALE_PAYMENT_CATEGORIES = ['Debtors Payment', 'Part Payment', 'Other'];
const CREDIT_PURCHASE_PAYMENT_CATEGORIES = ['Creditors Payment', 'Part Payment', 'Other'];
const PURCHASE_CATEGORIES = ['RESTOCK', 'MATERIALS', 'ASSET', 'OTHER SPECIFIED'];
const RETURN_INWARD_CATEGORIES = ['Defective', 'Wrong Item', 'Customer Change Mind', 'Others'];
const RETURN_OUTWARD_CATEGORIES = ['Supplier Return', 'Damaged Stock', 'Wrong Item', 'Other'];
const EXPENSE_CATEGORIES = ['Depreciation', 'Miscellaneous Expenses', 'Rent', 'Salary', 'Transport', 'Utilities', 'Tax', 'LUNCH', 'BREAKFAST', 'DINNER', 'MISCELLANEOUS', 'MAINTENANCE', 'MARKETING', 'EQUIPMENT', 'P.R', 'Interest on Loan', 'OTHERS'];

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmt(n: number): string { return NAIRA + fmtNum(n); }
function parseAmt(s: string): number { return parseFloat(s.replace(/,/g, '')) || 0; }
function formatCategoryLabel(category: string): string {
  const normalized = category.toLowerCase();
  return normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : category;
}

// ── Product Picker Modal ──────────────────────────────────────────────────────

function ProductPickerModal({
  visible,
  products,
  onSelect,
  onClose,
  allowNone = true,
}: {
  visible: boolean;
  products: Product[];
  onSelect: (p: Product | null) => void;
  onClose: () => void;
  allowNone?: boolean;
}) {
  const colors = useColors();
  return (
    <Modal transparent animationType="slide" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={ppStyles.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[ppStyles.sheet, { backgroundColor: colors.card }]}>
            <View style={[ppStyles.handle, { backgroundColor: colors.border }]} />
            <View style={ppStyles.headerRow}>
              <Text style={[ppStyles.title, { color: colors.foreground }]}>Select Product</Text>
              <Pressable onPress={onClose} style={[ppStyles.closeBtn, { backgroundColor: colors.background }]}>
                <X size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {allowNone && (
              <Pressable
                onPress={() => { Haptics.selectionAsync(); onSelect(null); onClose(); }}
                style={[ppStyles.row, { borderBottomColor: colors.border }]}
              >
                <View style={[ppStyles.rowIcon, { backgroundColor: colors.muted }]}>
                  <ShoppingCart size={16} color={colors.mutedForeground} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[ppStyles.rowName, { color: colors.foreground }]}>No specific product</Text>
                  <Text style={[ppStyles.rowSub, { color: colors.mutedForeground }]}>Generic / manual sale</Text>
                </View>
              </Pressable>
            )}

            <FlatList
              data={products.filter(product => !product.archived)}
              keyExtractor={p => p.id}
              style={{ maxHeight: 380 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); onSelect(item); onClose(); }}
                  style={({ pressed }) => [
                    ppStyles.row,
                    { borderBottomColor: colors.border, backgroundColor: pressed ? colors.secondary : 'transparent' },
                  ]}
                >
                  <View style={[ppStyles.rowIcon, { backgroundColor: colors.secondary }]}>
                    <Package size={16} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[ppStyles.rowName, { color: colors.foreground }]} numberOfLines={1}>{item.name}</Text>
                    <Text style={[ppStyles.rowSub, { color: colors.mutedForeground }]}>
                      Sell: {fmt(item.suggestedPrice)} · Stock: {item.stockQty} units
                    </Text>
                  </View>
                  <ChevronRight size={14} color={colors.mutedForeground} />
                </Pressable>
              )}
              ListEmptyComponent={
                <View style={ppStyles.empty}>
                  <Text style={[ppStyles.emptyTxt, { color: colors.mutedForeground }]}>
                    No products yet. Add a Purchase first.
                  </Text>
                </View>
              }
            />
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const ppStyles = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:    { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32 },
  handle:   { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  title:    { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold' },
  closeBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon:  { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  rowName:  { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  rowSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  empty:    { paddingVertical: 24, alignItems: 'center' },
  emptyTxt: { fontSize: 13, fontFamily: 'Inter_400Regular' },
});

// ── Markup Suggestion Popup ───────────────────────────────────────────────────

interface SavedPurchaseInfo {
  itemName: string;
  baseCost: number;
  otherCosts: number[];
  carriageInward: number;
  handlingCost: number;
  totalLandedCost: number;
  industry: string;
  markup: number;
  date: string;
}

interface MarkupPopupProps {
  visible: boolean;
  info: SavedPurchaseInfo;
  onUsePrice: (markup: number, sellingPrice: number) => void;
  onSkip: () => void;
}

function MarkupPopup({ visible, info, onUsePrice, onSkip }: MarkupPopupProps) {
  const colors = useColors();
  const [editingMarkup, setEditingMarkup] = useState(false);
  const [markupStr, setMarkupStr] = useState(String(info.markup));

  const markupNum   = parseFloat(markupStr) || 0;
  const selling     = calculateSuggestedPrice(info.totalLandedCost, markupNum);
  const vatAmount   = extractVATAmount(selling);
  const preVatPrice = selling - vatAmount;
  const profit      = preVatPrice - info.totalLandedCost;
  const otherTotal  = info.otherCosts.reduce((s, c) => s + c, 0);

  const handleUse = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onUsePrice(markupNum, selling);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={styles.overlay}>
        <Animated.View entering={FadeInUp.springify()} style={[styles.popup, { backgroundColor: colors.card }]}>
          <View style={[styles.popupHeader, { backgroundColor: colors.headerBg }]}>
            <View style={styles.popupIconWrap}>
              <Text style={styles.popupIconText}>₦</Text>
            </View>
            <Text style={styles.popupTitle}>Suggested Selling Price</Text>
            <Text style={styles.popupSubtitle}>Based on industry markup</Text>
          </View>

          <View style={[styles.popupBody, { borderColor: colors.border }]}>
            <PopupRow label="Item"              value={info.itemName}                colors={colors} />
            <PopupRow label="Base Cost"         value={fmt(info.baseCost)}           colors={colors} />
            {otherTotal > 0 && (
              <PopupRow label={`Other Costs (${info.otherCosts.length})`} value={fmt(otherTotal)} colors={colors} />
            )}
            {info.carriageInward > 0 && (
              <PopupRow label="Carriage Inward"  value={fmt(info.carriageInward)}     colors={colors} />
            )}
            {info.handlingCost > 0 && (
              <PopupRow label="Handling Cost"    value={fmt(info.handlingCost)}       colors={colors} />
            )}
            <PopupRow label="Total Landed Cost" value={fmt(info.totalLandedCost)}    colors={colors} bold />
            <PopupRow label="Industry"          value={info.industry}                colors={colors} />

            <View style={[styles.popupRow, { borderBottomColor: colors.border }]}>
              <Text style={[styles.popupRowLabel, { color: colors.mutedForeground }]}>Markup %</Text>
              {editingMarkup ? (
                <View style={[styles.markupEditBox, { borderColor: colors.primary }]}>
                  <TextInput
                    style={[styles.markupEditInput, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}
                    value={markupStr}
                    onChangeText={setMarkupStr}
                    keyboardType="decimal-pad"
                    autoFocus
                    selectTextOnFocus
                  />
                  <Text style={[styles.markupEditPct, { color: colors.mutedForeground }]}>%</Text>
                </View>
              ) : (
                <Text style={[styles.popupRowValue, { color: colors.foreground }]}>{markupStr}%</Text>
              )}
            </View>
          </View>

          <View style={[styles.priceBox, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.priceBoxLabel, { color: colors.primary }]}>Suggested Selling Price</Text>
            <Text style={[styles.priceBoxAmount, { color: colors.primary }]}>{fmt(selling)}</Text>
            <View style={styles.vatBadge}>
              <Text style={[styles.vatBadgeText, { color: colors.primary }]}>
                Excluding VAT · VAT {(VAT_RATE * 100).toFixed(1)}%: {fmt(vatAmount)} · Total: {fmt(selling + vatAmount)}
              </Text>
            </View>
            <Text style={[styles.priceBoxProfit, { color: colors.accent }]}>
              Profit per unit: {fmt(profit)} (+{markupNum.toFixed(1)}% markup)
            </Text>
          </View>

          <View style={styles.popupActions}>
            <Pressable
              onPress={handleUse}
              style={({ pressed }) => [
                styles.popupBtn, styles.popupBtnPrimary,
                { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <CheckCircle size={16} color="#fff" />
              <Text style={styles.popupBtnPrimaryText}>Use This Price</Text>
            </Pressable>

            {!editingMarkup && (
              <Pressable
                onPress={() => { Haptics.selectionAsync(); setEditingMarkup(true); }}
                style={({ pressed }) => [
                  styles.popupBtn, styles.popupBtnOutline,
                  { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <Pencil size={15} color={colors.primary} />
                <Text style={[styles.popupBtnOutlineText, { color: colors.primary }]}>Change Markup %</Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => { Haptics.selectionAsync(); onSkip(); }}
              style={({ pressed }) => [styles.popupSkip, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[styles.popupSkipText, { color: colors.mutedForeground }]}>Skip</Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function PopupRow({ label, value, colors, bold = false }: {
  label: string; value: string; colors: any; bold?: boolean;
}) {
  return (
    <View style={[styles.popupRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.popupRowLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text
        style={[
          styles.popupRowValue,
          { color: bold ? colors.primary : colors.foreground },
          bold && { fontFamily: 'Inter_700Bold' },
        ]}
        numberOfLines={2}
      >
        {value}
      </Text>
    </View>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState { message: string; type: 'success' | 'error' }

function Toast({ toast, onHide }: { toast: ToastState; onHide: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timerRef.current = setTimeout(onHide, toast.type === 'success' ? 2000 : 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [toast, onHide]);

  const bg   = toast.type === 'success' ? '#15803D' : '#B91C1C';
  const Icon = toast.type === 'success' ? CheckCircle : AlertCircle;

  return (
    <Animated.View entering={FadeInDown.springify()} style={[styles.toast, { backgroundColor: bg }]}>
      <Icon size={16} color="#fff" />
      <Text style={styles.toastText} numberOfLines={3}>{toast.message}</Text>
    </Animated.View>
  );
}

// ── Amount input row ──────────────────────────────────────────────────────────

function AmountInput({
  value, onChangeText, placeholder = '0.00', color, hasError = false, testID, editable = true,
}: {
  value: string; onChangeText: (v: string) => void;
  placeholder?: string; color: string; hasError?: boolean; testID?: string; editable?: boolean;
}) {
  const colors = useColors();
  return (
    <View style={[styles.amountRow, { borderColor: hasError ? colors.destructive : colors.input, backgroundColor: colors.background }]}>
      <Text style={[styles.nairaSign, { color }]}>{NAIRA}</Text>
      <TextInput
        style={[styles.amountInput, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        keyboardType="decimal-pad"
        testID={testID}
        editable={editable}
      />
    </View>
  );
}

// ── Qty Stepper ───────────────────────────────────────────────────────────────

function QtyStepper({
  value, onChange, color, max = 1000,
}: {
  value: number; onChange: (n: number) => void; color: string; max?: number;
}) {
  const colors = useColors();
  const set = (n: number) => { Haptics.selectionAsync(); onChange(Math.min(max, Math.max(0, n))); };
  return (
    <View style={[qStyles.row, { borderColor: colors.input, backgroundColor: colors.background }]}>
      <Pressable
        onPress={() => set(value - 1)}
        style={({ pressed }) => [qStyles.btn, { backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 }]}
      >
        <Minus size={16} color={value <= 0 ? colors.mutedForeground : color} />
      </Pressable>
      <TextInput
        style={[qStyles.input, { color: colors.foreground }]}
        value={String(value)}
        onChangeText={(t) => { const n = parseInt(t.replace(/\D/g, '')) || 0; set(n); }}
        keyboardType="number-pad"
        selectTextOnFocus
      />
      <Pressable
        onPress={() => set(value + 1)}
        style={({ pressed }) => [qStyles.btn, { backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 }]}
      >
        <Plus size={16} color={value >= max ? colors.mutedForeground : color} />
      </Pressable>
    </View>
  );
}

const qStyles = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1.5, overflow: 'hidden' },
  btn:   { width: 44, height: 52, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, textAlign: 'center', fontSize: 22, fontFamily: 'Inter_700Bold', paddingVertical: 12 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function AddEntryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addEntry, addProduct, addPurchaseWithProduct, products, entries } = useEntries();
  const { customers, resolveOrUpsertCustomer } = useCustomers();

  // General
  const [uiType, setUiType]           = useState<UiEntryType>('sale');
  const [payMode, setPayMode]         = useState<'cash' | 'bank' | 'credit'>('cash');
  const [modeOpen, setModeOpen]       = useState(false);
  const [creditAction, setCreditAction] = useState<'transaction' | 'payment'>('transaction');
  const [stockSubType, setStockSubType] = useState<'opening_stock' | 'closing_stock'>('opening_stock');
  const [amount, setAmount]           = useState('');
  const [category, setCategory]       = useState('');
  const [notes, setNotes]             = useState('');
  const [date, setDate]               = useState(getTodayString());
  const [recordItemName, setRecordItemName] = useState('');
  const [partyName, setPartyName]     = useState('');
  const [partyPhone, setPartyPhone]   = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyEmail, setPartyEmail] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [saveCustomer, setSaveCustomer] = useState(true);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [selectedCreditEntryId, setSelectedCreditEntryId] = useState('');

  // Sale-specific
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [saleQty, setSaleQty]         = useState(1);
  const [unitPrice, setUnitPrice]     = useState('');
  const [showProductPicker, setShowProductPicker] = useState(false);

  // Return-specific
  const [returnQty, setReturnQty]             = useState(1);
  const [returnUnitPrice, setReturnUnitPrice] = useState('');
  const [returnProduct, setReturnProduct]     = useState<Product | null>(null);
  const [showReturnPicker, setShowReturnPicker] = useState(false);

  // Purchase-specific
  const [purchaseCategory, setPurchaseCategory] = useState('RESTOCK');
  const [selectedPurchaseProduct, setSelectedPurchaseProduct] = useState<Product | null>(null);
  const [showPurchaseProductPicker, setShowPurchaseProductPicker] = useState(false);
  const [itemName, setItemName]       = useState('');
  const [purchaseQty, setPurchaseQty] = useState(1);
  const [baseCost, setBaseCost]       = useState('');
  const [otherCosts, setOtherCosts]   = useState<string[]>([]);
  const [carriageInward, setCarriageInward] = useState('');
  const [handlingCost, setHandlingCost] = useState('');
  const [industry, setIndustry]       = useState('');
  const [markup, setMarkup]           = useState('');

  // Popup / toast
  const [showPopup, setShowPopup]     = useState(false);
  const [savedPurchase, setSavedPurchase] = useState<SavedPurchaseInfo | null>(null);
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [saving, setSaving]           = useState(false);
  const savingProductRef              = useRef(false);
  const [toast, setToast]             = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => setToast({ message, type }), []);
  const hideToast = useCallback(() => setToast(null), []);

  const isPurchase    = uiType === 'purchase' && payMode !== 'credit';
  const isSale        = uiType === 'sale' && payMode !== 'credit';
  const isExpenseType = uiType === 'expense';
  const isDepreciation = isExpenseType && category.trim().toLowerCase() === 'depreciation';
  const isCreditExpense = isExpenseType && !isDepreciation && payMode === 'credit';
  const isStock       = uiType === 'stock';
  const isReturn      = uiType === 'return_inward' || uiType === 'return_outward';
  const isReturnOutward = uiType === 'return_outward';
  const isCreditTab   = uiType === 'credit_sale' || uiType === 'credit_purchase';
  const isCreditSale  = uiType === 'credit_sale' || (uiType === 'sale' && payMode === 'credit');
  const isCreditPurch = uiType === 'credit_purchase' || (uiType === 'purchase' && payMode === 'credit');
  const isCreditSalePayment = isCreditSale && creditAction === 'payment';
  const isCreditPurchasePayment = isCreditPurch && creditAction === 'payment';
  const isCreditSaleTransaction = isCreditSale && !isCreditSalePayment;
  const isCreditPurchaseTransaction = isCreditPurch && !isCreditPurchasePayment;
  const outstandingCredits = useMemo(
    () => getOutstandingCredits(entries, isCreditSale ? 'sale' : 'purchase'),
    [entries, isCreditSale],
  );
  const selectedCredit = outstandingCredits.find(item => item.originalEntry.id === selectedCreditEntryId);
  const actualEntryType: EntryType = isStock
    ? stockSubType
    : isCreditSalePayment
      ? 'credit_sale_payment'
      : isCreditPurchasePayment
        ? 'credit_purchase_payment'
        : uiType === 'sale' && payMode === 'credit' ? 'credit_sale'
        : uiType === 'purchase' && payMode === 'credit' ? 'credit_purchase'
        : (uiType as EntryType);
  const isPaymentRecord = isCreditSalePayment || isCreditPurchasePayment;
  const showModeSelect = (uiType === 'sale' || uiType === 'purchase' || isExpenseType || isPaymentRecord) && !isDepreciation;
  const modeOptions: { value: 'cash' | 'bank' | 'credit'; label: string }[] = isPaymentRecord
    ? [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }]
    : uiType === 'sale'
      ? [{ value: 'cash', label: 'Cash Sales' }, { value: 'bank', label: 'Bank Sales' }, { value: 'credit', label: 'Credit Sales' }]
      : uiType === 'purchase'
        ? [{ value: 'cash', label: 'Cash Purchases' }, { value: 'bank', label: 'Bank Purchases' }, { value: 'credit', label: 'Credit Purchases' }]
        : [{ value: 'cash', label: 'Cash' }, { value: 'bank', label: 'Bank' }, { value: 'credit', label: 'Credit (pay later)' }];
  const effectiveMode: 'cash' | 'bank' | 'credit' = isPaymentRecord && payMode === 'credit' ? 'cash' : payMode;

  const primaryColor = isSale || isCreditSale
    ? colors.revenue
    : isPurchase || isCreditPurch ? colors.primary
    : isStock    ? '#7C3AED'
    : isReturn   ? (isReturnOutward ? '#D97706' : '#F97316')
    : colors.expense;

  // ── Purchase computed ──────────────────────────────────────────────────────
  const baseCostNum    = useMemo(() => parseAmt(baseCost), [baseCost]);
  const otherCostsNums = useMemo(() => otherCosts.map(parseAmt), [otherCosts]);
  const otherCostsSum  = useMemo(() => otherCostsNums.reduce((s, n) => s + n, 0), [otherCostsNums]);
  const carriageNum    = useMemo(() => parseAmt(carriageInward), [carriageInward]);
  const handlingNum    = useMemo(() => parseAmt(handlingCost), [handlingCost]);
  const basePurchaseTotal = baseCostNum * purchaseQty;
  const [purchaseVatCharged, setPurchaseVatCharged] = useState(false);
  const purchaseVAT = purchaseVatCharged ? Math.round(basePurchaseTotal * 7.5) / 100 : 0;
  const withholdingTax = purchaseVatCharged ? Math.round(basePurchaseTotal * 5) / 100 : 0;
  const purchaseAmount = basePurchaseTotal + otherCostsSum;
  const totalLanded    = purchaseAmount + carriageNum + handlingNum;
  const supplierPayable = totalLanded + purchaseVAT - withholdingTax;
  const landedCostPerUnit = purchaseQty > 0 ? totalLanded / purchaseQty : 0;
  const carriagePerUnit = purchaseQty > 0 && carriageNum > 0 ? carriageNum / purchaseQty : 0;
  const markupNum      = parseFloat(markup) || 0;
  const computedSuggested = calculateSuggestedPrice(landedCostPerUnit, markupNum);

  // ── Sale computed ──────────────────────────────────────────────────────────
  const unitPriceNum  = useMemo(() => parseAmt(unitPrice), [unitPrice]);
  const saleAmount    = saleQty * unitPriceNum;
  const vatPayable = saleQty > 0 && unitPriceNum > 0
    ? Math.round(saleAmount * 7.5) / 100
    : 0;

  // ── Return Inward computed ─────────────────────────────────────────────────
  const returnUnitPriceNum = useMemo(
    () => isReturnOutward && returnProduct ? returnProduct.costPrice : parseAmt(returnUnitPrice),
    [isReturnOutward, returnProduct, returnUnitPrice],
  );
  const returnAmount       = returnQty * returnUnitPriceNum;
  const hasLaterProductMovement = isReturnOutward && !!returnProduct && entries.some(entry =>
    entry.productId === returnProduct.id && entry.date > date &&
    ['purchase', 'credit_purchase', 'sale', 'credit_sale', 'return_inward', 'return_outward'].includes(entry.type));
  const returnLandedUnitCost = returnProduct && returnProduct.stockQty > 0
    ? (getStockValueBreakdown(products, entries).find(row => row.productId === returnProduct.id)?.totalCost ?? 0) / returnProduct.stockQty
    : 0;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const resetPurchaseDetails = useCallback(() => {
    setSelectedPurchaseProduct(null);
    setShowPurchaseProductPicker(false);
    setItemName('');
    setPurchaseQty(1);
    setBaseCost('');
    setOtherCosts([]);
    setCarriageInward('');
    setHandlingCost('');
    setIndustry('');
    setMarkup('');
  }, []);

  const handleTypeToggle = useCallback((type: UiEntryType) => {
    Haptics.selectionAsync();
    setUiType(type);
    setPayMode('cash');
    setModeOpen(false);
    setCreditAction('transaction');
    setCategory(
      type === 'sale' ? SALE_CATEGORIES[0]
      : type === 'credit_sale' ? CREDIT_SALE_CATEGORIES[0]
      : type === 'purchase' || type === 'credit_purchase' ? PURCHASE_CATEGORIES[0]
      : type === 'return_inward' ? RETURN_INWARD_CATEGORIES[0]
      : type === 'return_outward' ? RETURN_OUTWARD_CATEGORIES[0]
      : '',
    );
    setPurchaseCategory(PURCHASE_CATEGORIES[0]);
    resetPurchaseDetails();
    setAmount('');
    setRecordItemName('');
    setPartyName('');
    setPartyPhone('');
    setPartyAddress('');
    setPartyEmail('');
    setCustomerId('');
    setSaveCustomer(true);
    setSelectedCreditEntryId('');
    setErrors({});
  }, [resetPurchaseDetails]);

  const handleProductSelect = useCallback((p: Product | null) => {
    setSelectedProduct(p);
    if (p) {
      setUnitPrice(String(p.suggestedPrice));
      setRecordItemName(p.name);
    }
  }, []);

  const handlePurchaseProductSelect = useCallback((p: Product | null) => {
    setSelectedPurchaseProduct(p);
    if (p) {
      setItemName(p.name);
      setBaseCost(String(Math.round(p.costPrice)));
      if (p.industry) setIndustry(p.industry);
      if (typeof p.markup === 'number') setMarkup(String(p.markup));
    } else {
      setItemName('');
    }
    setErrors((e) => ({ ...e, itemName: '' }));
  }, []);

  const handlePurchaseCategorySelect = useCallback((nextCategory: string) => {
    Haptics.selectionAsync();
    if (nextCategory !== purchaseCategory) resetPurchaseDetails();
    setPurchaseCategory(nextCategory);
    setErrors((e) => ({ ...e, itemName: '', purchaseCategory: '' }));
  }, [purchaseCategory, resetPurchaseDetails]);

  const handleIndustrySelect = useCallback((ind: string) => {
    Haptics.selectionAsync();
    setIndustry(ind);
    const def = INDUSTRY_MARKUP[ind as Industry];
    if (def !== undefined) setMarkup(String(def));
    setErrors((e) => ({ ...e, industry: '' }));
  }, []);

  const addOtherCost = () => {
    Haptics.selectionAsync();
    setOtherCosts((prev) => [...prev, '']);
  };
  const updateOtherCost = (index: number, value: string) =>
    setOtherCosts((prev) => prev.map((v, i) => (i === index ? value : v)));
  const removeOtherCost = (index: number) => {
    Haptics.selectionAsync();
    setOtherCosts((prev) => prev.filter((_, i) => i !== index));
  };

  const topInset    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  // ── Validation ─────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) e.date = 'Use format YYYY-MM-DD';

    if (isPurchase || isCreditPurchaseTransaction) {
      if (!purchaseCategory) e.purchaseCategory = 'Select a purchase category';
      if (purchaseCategory === 'RESTOCK' && !selectedPurchaseProduct) e.itemName = 'Select an existing product to restock';
      if (purchaseCategory !== 'RESTOCK' && !itemName.trim()) e.itemName = 'Enter a product name';
      if (!baseCost || baseCostNum <= 0) e.baseCost = 'Enter a valid base cost';
      if (!industry) e.industry = 'Select an industry';
      if (!markup || markupNum < 0) e.markup = 'Enter a valid markup %';
    } else if (isStock) {
      if (!amount || parseAmt(amount) <= 0) e.amount = 'Enter a valid stock value';
    } else if (isSale || isCreditSaleTransaction) {
      if (unitPriceNum <= 0) e.unitPrice = 'Enter a unit price';
      if (saleQty <= 0) e.saleQty = 'Enter a quantity';
      if (!category) e.category = 'Select a category';
      if (selectedProduct && saleQty > selectedProduct.stockQty) {
        e.saleQty = `Only ${selectedProduct.stockQty} unit${selectedProduct.stockQty === 1 ? '' : 's'} available`;
      }
    } else if (isReturn) {
      if (isReturnOutward
        ? (!returnProduct || !Number.isFinite(returnProduct.costPrice) || returnProduct.costPrice <= 0)
        : (!returnUnitPrice.trim() || !Number.isFinite(returnUnitPriceNum) || returnUnitPriceNum <= 0)) {
        e.returnUnitPrice = isReturnOutward
          ? 'The selected product has an invalid base cost. Refresh products and try again.'
          : 'Enter a valid unit price';
      }
      if (returnQty <= 0) e.returnQty = 'Enter a quantity';
      if (!category) e.category = 'Select a category';
      if (!(returnProduct?.name || recordItemName.trim())) e.recordItemName = 'Enter the item or product name';
      if (isReturnOutward && !returnProduct) e.returnProduct = 'Select the product being returned';
      if (isReturnOutward && returnProduct && returnQty > returnProduct.stockQty) {
        e.returnQty = `Only ${returnProduct.stockQty} unit${returnProduct.stockQty === 1 ? '' : 's'} available`;
      }
      if (hasLaterProductMovement) e.returnQty = 'This product has later stock activity. Record the return after its latest movement.';
      if (isReturnOutward && returnAmount > Math.round(returnLandedUnitCost * returnQty * 100) / 100 + 0.005) {
        e.returnUnitPrice = 'Supplier credit exceeds landed return cost. Record additional compensation separately.';
      }
    } else {
      if (!amount || parseAmt(amount) <= 0) e.amount = 'Enter a valid amount';
      if (!category) e.category = 'Select a category';
    }
    if ((isCreditSale || isCreditPurch) && creditAction === 'transaction') {
      const creditItem = isCreditPurchaseTransaction ? itemName.trim() : recordItemName.trim();
      if (!creditItem) e.recordItemName = 'Enter the item or product name';
      if (!partyName.trim()) e.partyName = isCreditSale ? 'Enter the customer name' : 'Enter the supplier name';
      if (!partyPhone.trim()) e.partyPhone = 'Enter the phone number';
    }

    if (isCreditExpense) {
      if (!partyName.trim()) e.partyName = 'Enter the creditor name';
      if (!partyPhone.trim()) e.partyPhone = 'Enter the creditor phone number';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const addWithMode = (data: any) => {
    const t = data.type as EntryType;
    let paymentMode: string | undefined;
    if (t === 'credit_sale' || t === 'credit_purchase') paymentMode = 'credit';
    else if (t === 'expense') paymentMode = data.category === 'VAT Paid' ? undefined : isDepreciation ? 'non_cash' : effectiveMode;
    else if (t === 'sale' || t === 'purchase' || t === 'credit_sale_payment' || t === 'credit_purchase_payment') paymentMode = effectiveMode === 'bank' ? 'bank' : 'cash';
    return addEntry({
      ...data,
      ...(paymentMode ? { paymentMode } : {}),
      ...(t === 'expense' && isCreditExpense && data.category !== 'VAT Paid' ? { partyName: partyName.trim(), partyPhone: partyPhone.trim() } : {}),
    });
  };

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    if ((isCreditSaleTransaction || isCreditPurchaseTransaction) &&
      duplicatePartyEntry(entries, isCreditSaleTransaction ? 'customer' : 'supplier', partyName, partyPhone)) {
      Alert.alert(
        'Phone number already used',
        `This phone number is already registered to a different ${isCreditSaleTransaction ? 'customer' : 'supplier'}. Use that party's name, or enter a different number.`,
      );
      return;
    }
    setSaving(true);
    try {
      let resolvedCustomerId = customerId || undefined;
      if (!resolvedCustomerId && saveCustomer && (isCreditSaleTransaction || isSale) && (partyName.trim() || partyPhone.trim())) {
        resolvedCustomerId = partyPhone.trim()
          ? `phone_${normalizeNigerianPhone(partyPhone)}`
          : `customer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      }
      if ((isCreditSaleTransaction || isSale) && saveCustomer && (partyName.trim() || partyPhone.trim())) {
        try {
          resolvedCustomerId = await resolveOrUpsertCustomer({
            customerId: customerId || undefined,
            fullName: partyName.trim(), phone: partyPhone.trim(),
            homeAddress: partyAddress.trim(), email: partyEmail.trim(),
          });
        } catch (error: any) {
          console.warn('[customer] enrichment deferred until sync', error?.message ?? error);
        }
      }
      if (isPurchase || isCreditPurchaseTransaction) {
        const matchingProduct = purchaseCategory === 'RESTOCK' ? selectedPurchaseProduct : null;
        const purchaseEntry = {
          type: actualEntryType,
          paymentMode: (isCreditPurchaseTransaction ? 'credit' : effectiveMode === 'bank' ? 'bank' : 'cash') as 'credit' | 'bank' | 'cash',
          // Keep the purchase amount separate from carriage and handling so Cost
          // follows: purchase + carriage + handling.
          amount: supplierPayable,
          category: purchaseCategory,
          notes,
          date,
          itemName: itemName.trim(),
          ...(isCreditPurchaseTransaction ? {
            partyName: partyName.trim(),
            partyPhone: partyPhone.trim(),
          } : {}),
          baseCost: baseCostNum,
          unitPurchasePrice: baseCostNum,
          materialCosts: otherCostsNums,  // stored as materialCosts for backward compat
          purchaseAmount,
          carriageInward: carriageNum,
          handlingCost: handlingNum,
          totalLandedCost: totalLanded,
          purchaseVatCharged,
          purchaseVAT,
          withholdingTax,
          supplierPayable,
          unitsPurchased: purchaseQty,
          industry,
          markup: markupNum,
          suggestedPrice: computedSuggested,
          ...(matchingProduct ? { productId: matchingProduct.id } : {}),
          stockDelta: purchaseQty,
          stockMovementReason: isCreditPurchaseTransaction ? 'Creditors' : 'Purchase',
        } as Omit<import('@/context/EntriesContext').Entry, 'id' | 'createdAt'>;
        if (matchingProduct) {
          await addWithMode(purchaseEntry);
        } else {
          await addPurchaseWithProduct(purchaseEntry, {
            name: itemName.trim(),
            costPrice: baseCostNum,
            industry,
            markup: markupNum,
            suggestedPrice: computedSuggested,
            date,
            vat: extractVATAmount(computedSuggested),
            vatExclusive: true,
          });
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(isCreditPurchaseTransaction ? 'Creditors entry saved and stock updated!' : 'Purchase saved and stock updated!', 'success');
        setTimeout(() => router.back(), 1200);
        return;

      } else if (isStock) {
        await addWithMode({
          type: actualEntryType,
          amount: parseAmt(amount),
          category: stockSubType === 'opening_stock' ? 'Opening Stock' : 'Closing Stock',
          notes,
          date,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Saved successfully!', 'success');
        setTimeout(() => router.back(), 1200);

      } else if (isCreditSalePayment || isCreditPurchasePayment) {
        if (!selectedCredit) throw new Error('Select an outstanding credit transaction.');
        const paymentAmount = parseAmt(amount);
        if (paymentAmount <= 0) throw new Error('Enter a valid payment amount.');
        if (paymentAmount > selectedCredit.remainingBalance + 0.005) throw new Error('Payment cannot exceed the remaining balance.');
        const isSalePayment = isCreditSalePayment;
        const original = selectedCredit.originalEntry;
        const allocatedVat = isSalePayment
          ? (Math.abs(paymentAmount - selectedCredit.remainingBalance) < 0.005
            ? Math.max(0, getEntryVAT(original) - selectedCredit.vatPaidToDate)
            : Math.floor((paymentAmount / selectedCredit.grossAmount) * getEntryVAT(original) * 100) / 100)
          : undefined;
        await addWithMode({
          type: actualEntryType,
          amount: paymentAmount,
          category,
          notes,
          date,
          itemName: original.itemName,
          partyName: original.partyName,
          partyPhone: original.partyPhone,
          linkedCreditEntryId: original.id,
          linkedCreditKind: original.type === 'expense' ? 'expense' : isCreditSalePayment ? 'sale' : 'purchase',
          ...(allocatedVat !== undefined ? { allocatedVat } : {}),
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Payment saved!', 'success');
        setTimeout(() => router.back(), 1200);
      } else if (isSale || isCreditSaleTransaction) {
        // Keep the customer's entered total unchanged; record VAT separately.
        // Credit sale: goods have left the store — stock deducted same as a regular sale.
        const saleId = Date.now().toString();
        await addWithMode({
          type: actualEntryType,
          amount: saleAmount + vatPayable,
          vatExclusive: true,
          unitSalesPrice: unitPriceNum,
          unitsSold: saleQty,
          vatPaid: vatPayable,
          cogsAmount: selectedProduct ? saleQty * selectedProduct.costPrice : 0,
          category: category || 'Goods',
          notes,
          date,
          itemName: selectedProduct?.name ?? recordItemName.trim(),
          ...((isCreditSaleTransaction || isSale) && (partyName.trim() || partyPhone.trim() || partyAddress.trim() || partyEmail.trim()) ? {
            partyName: partyName.trim(),
            partyPhone: partyPhone.trim(),
            ...(partyAddress.trim() ? { partyAddress: partyAddress.trim() } : {}),
            ...(partyEmail.trim() ? { partyEmail: partyEmail.trim() } : {}),
            ...(resolvedCustomerId ? { customerId: resolvedCustomerId } : {}),
          } : {}),
          ...(selectedProduct ? {
            productId: selectedProduct.id,
            stockDelta: -saleQty,
            stockMovementReason: isCreditSaleTransaction ? 'Debtors' : 'Sale',
          } : {}),
        });
        // Auto-create VAT entry for the separate VAT report. It is not a direct expense.
        if (vatPayable > 0) {
          await addWithMode({
            type: 'expense',
            amount: vatPayable,
            category: 'VAT Paid',
            notes: `VAT on Sale ID: ${saleId}`,
            date,
          });
        }
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(isCreditSaleTransaction ? 'Debtors entry saved!' : 'Sale saved!', 'success');
        setTimeout(() => router.back(), 1200);

      } else if (isReturn) {
        await addWithMode({
          type: actualEntryType,
          amount: isReturnOutward ? returnAmount : returnAmount + Math.round(returnAmount * 7.5) / 100,
          unitSalesPrice: returnUnitPriceNum,
          unitsSold: returnQty,
          ...(isReturnOutward ? {} : {
            vatExclusive: true,
            vatPaid: Math.round(returnAmount * 7.5) / 100,
            returnVat: Math.round(returnAmount * 7.5) / 100,
          }),
          ...(!isReturnOutward && returnProduct ? { baseCostSnapshot: returnProduct.costPrice } : {}),
          ...(isReturnOutward && returnProduct ? {
            baseCostSnapshot: returnProduct.costPrice,
            returnLandedCost: Math.round(returnLandedUnitCost * returnQty * 100) / 100,
          } : {}),
          cogsAmount: returnProduct ? returnQty * returnProduct.costPrice : undefined,
          category,
          notes,
          date,
          itemName: returnProduct?.name ?? recordItemName.trim(),
          ...(returnProduct ? {
            productId: returnProduct.id,
            stockDelta: isReturnOutward ? -returnQty : returnQty,
            stockMovementReason: isReturnOutward ? 'Return Outward' : 'Return Inward',
          } : {}),
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast(isReturnOutward ? 'Return outward recorded and product units reduced!' : 'Return inward recorded and product restocked!', 'success');
        setTimeout(() => router.back(), 1200);

      } else {
        await addWithMode({
          type: actualEntryType,
          amount: parseAmt(amount),
          category,
          notes,
          date,
          ...((isCreditSalePayment || isCreditPurchasePayment) ? {
            itemName: recordItemName.trim(),
            partyName: partyName.trim(),
            partyPhone: partyPhone.trim(),
          } : {}),
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Saved successfully!', 'success');
        setTimeout(() => router.back(), 1200);
      }
    } catch (err: any) {
      if (err?.savedOffline) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Saved offline. Will sync when online.', 'success');
        setSaving(false);
        setTimeout(() => router.back(), 1400);
        return;
      }
      console.log('[handleSave] error.code:', err?.code, '| message:', err?.message);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Save Failed', err?.code ?? err?.message ?? 'Unknown error');
      setSaving(false);
    }
  };

  // ── Popup handlers ─────────────────────────────────────────────────────────

  const handleUsePrice = async (finalMarkup: number, finalPrice: number) => {
    if (!savedPurchase || savingProductRef.current) return;
    savingProductRef.current = true;
    try {
      await addProduct({
        name: savedPurchase.itemName,
        costPrice: savedPurchase.totalLandedCost / Math.max(1, purchaseQty),
        industry: savedPurchase.industry,
        markup: finalMarkup,
        suggestedPrice: finalPrice,
        date: savedPurchase.date,
        stockQty: purchaseQty,
        vat: extractVATAmount(finalPrice),
      });
    } catch (e: any) {
      console.error(e);
      Alert.alert('Error', e?.message ?? 'Could not save product info.');
    } finally {
      savingProductRef.current = false;
    }
    setShowPopup(false);
    router.back();
  };

  const handleSkip = () => { setShowPopup(false); router.back(); };

  const categories = isSale                 ? SALE_CATEGORIES
    : isCreditSalePayment                   ? CREDIT_SALE_PAYMENT_CATEGORIES
    : isCreditSaleTransaction               ? CREDIT_SALE_CATEGORIES
    : isCreditPurchasePayment               ? CREDIT_PURCHASE_PAYMENT_CATEGORIES
    : isCreditPurchaseTransaction           ? PURCHASE_CATEGORIES
    : isReturnOutward                        ? RETURN_OUTWARD_CATEGORIES
    : isReturn                              ? RETURN_INWARD_CATEGORIES
    : EXPENSE_CATEGORIES;

  // ── Type icon map ───────────────────────────────────────────────────────────
  const typeIconMap: Record<string, React.ComponentType<any>> = {
    sale:             TrendingUp,
    credit_sale:      TrendingUp,
    credit_sale_payment: TrendingUp,
    purchase:         ShoppingCart,
    credit_purchase:  ShoppingCart,
    credit_purchase_payment: ShoppingCart,
    expense:          TrendingDown,
    stock:            Archive,
    return_inward:    RotateCcw,
    return_outward:   RotateCcw,
  };
  const SaveIcon = typeIconMap[actualEntryType] ?? TrendingUp;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, paddingTop: topInset + 12, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
          disabled={saving}
        >
          <X size={22} color={colors.mutedForeground} />
        </Pressable>
        <View style={styles.headerCenter}>
          <SaveIcon size={16} color={primaryColor} />
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>New Entry</Text>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        <Pressable testID="link-owner-equity" onPress={() => router.push('/equity')} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: primaryColor, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Owner contribution or drawings? Record them under Opening Balances & Equity</Text>
        </Pressable>
        <Pressable testID="link-finance" onPress={() => router.push('/finance')} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={{ color: primaryColor, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Fixed asset, tax payment or bank statement? Use Financial Controls</Text>
        </Pressable>

        {/* ── Entry Type Toggle ─────────────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(40).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Entry Type</Text>
          <View style={[styles.toggleGrid, { backgroundColor: colors.muted }]}>
            {(
              [
                { type: 'sale'            as UiEntryType, label: 'Sale',         Icon: TrendingUp,  color: colors.revenue  },
                { type: 'credit_sale'     as UiEntryType, label: 'Debtors',  Icon: TrendingUp,  color: '#10B981'       },
                { type: 'purchase'        as UiEntryType, label: 'Purchase',     Icon: ShoppingCart, color: colors.primary  },
                { type: 'credit_purchase' as UiEntryType, label: 'Credit Buy',   Icon: ShoppingCart, color: '#6366F1'       },
                { type: 'return_inward'   as UiEntryType, label: 'Return In',    Icon: RotateCcw,   color: '#F97316'       },
                { type: 'return_outward'  as UiEntryType, label: 'Return Outward', Icon: RotateCcw, color: '#D97706'       },
                { type: 'expense'         as UiEntryType, label: 'Expense',      Icon: TrendingDown, color: colors.expense  },
                { type: 'stock'           as UiEntryType, label: 'Stock',        Icon: Archive,      color: '#7C3AED'       },
              ] as const
            ).map(({ type, label, Icon, color }) => {
              const active = uiType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => handleTypeToggle(type)}
                  style={[styles.toggleBtn2, active && { backgroundColor: color }]}
                  testID={`toggle-${type}`}
                  accessibilityHint={type === 'credit_sale'
                    ? 'Debtors. People that are owing me.'
                    : type === 'credit_purchase'
                      ? 'Creditors. people that I am owing.'
                      : undefined}
                >
                  <Icon size={13} color={active ? '#fff' : colors.mutedForeground} />
                  <Text style={[styles.toggleText, { color: active ? '#fff' : colors.mutedForeground }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.creditChoiceHint, { color: colors.mutedForeground }]}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>Debtors</Text>
            {' — People that are owing me\n'}
            <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.foreground }}>Creditors</Text>
            {' — people that I am owing'}
          </Text>

          {isCreditTab && <>
            <View style={[styles.stockSubRow, { backgroundColor: colors.background, borderColor: '#F59E0B44' }]}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setCreditAction('transaction');
                  setCategory(isCreditSale ? CREDIT_SALE_CATEGORIES[0] : PURCHASE_CATEGORIES[0]);
                  if (isCreditPurch) {
                    setPurchaseCategory(PURCHASE_CATEGORIES[0]);
                    resetPurchaseDetails();
                  }
                  setAmount('');
                  setRecordItemName('');
                  setPartyName('');
                  setPartyPhone('');
                  setPartyAddress(''); setPartyEmail(''); setCustomerId(''); setSaveCustomer(true);
                  setSelectedCreditEntryId('');
                }}
                style={[styles.stockSubBtn, { borderColor: creditAction === 'transaction' ? primaryColor : colors.border, backgroundColor: creditAction === 'transaction' ? primaryColor : 'transparent' }]}
                accessibilityHint={isCreditSale ? 'People that are owing me' : 'people that I am owing'}
              >
                <Text style={[styles.stockSubText, { color: creditAction === 'transaction' ? '#fff' : colors.mutedForeground }]}>
                  {isCreditSale ? 'Debtors' : 'Creditors'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setCreditAction('payment');
                  setCategory(isCreditSale ? CREDIT_SALE_PAYMENT_CATEGORIES[0] : CREDIT_PURCHASE_PAYMENT_CATEGORIES[0]);
                  if (isCreditPurch) resetPurchaseDetails();
                  setAmount('');
                  setRecordItemName('');
                  setPartyName('');
                  setPartyPhone('');
                  setPartyAddress(''); setPartyEmail(''); setCustomerId(''); setSaveCustomer(true);
                  setSelectedCreditEntryId('');
                }}
                style={[styles.stockSubBtn, { borderColor: creditAction === 'payment' ? primaryColor : colors.border, backgroundColor: creditAction === 'payment' ? primaryColor : 'transparent' }]}
                accessibilityHint="Record a payment against an existing balance"
              >
                <Text style={[styles.stockSubText, { color: creditAction === 'payment' ? '#fff' : colors.mutedForeground }]}>Record Payment</Text>
              </Pressable>
            </View>
            {creditAction === 'transaction' && (
              <Text style={[styles.creditChoiceHint, { color: colors.mutedForeground }]}>
                {isCreditSale ? 'People that are owing me' : 'people that I am owing'}
              </Text>
            )}
            <View style={[styles.creditNote, { backgroundColor: '#FFF8E1', borderColor: '#F59E0B44' }]}>
              <Text style={{ fontSize: 12, fontFamily: 'Inter_400Regular', color: '#92400E' }}>
                {isCreditSale
                  ? isCreditSalePayment
                    ? 'Payment received for a past debtors entry. This settles the receivable; revenue is not counted again.'
                    : 'Customer owes you. Revenue is recognized when the sale is recorded, regardless of when payment is received. Stock is reduced now.'
                  : isCreditPurchasePayment
                    ? '💳 Payment made for a past creditors entry. This settles the balance; product stock and Stock Value stay unchanged.'
                    : '💳 Goods received on credit. This increases product stock and Stock Value, and Cost is recognized when received.'}
              </Text>
            </View>
          </>}

          {showModeSelect && (
            <View style={{ marginTop: 12 }}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{isPaymentRecord ? 'Payment Mode' : 'Mode of Payment'}</Text>
              <Pressable
                onPress={() => setModeOpen(o => !o)}
                accessibilityRole="button"
                accessibilityLabel="Mode of Payment"
                style={[styles.textInput, { justifyContent: 'center', borderColor: colors.input, backgroundColor: colors.background }]}
              >
                <Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>
                  {(modeOptions.find(o => o.value === effectiveMode) ?? modeOptions[0]).label}  ▾
                </Text>
              </Pressable>
              {modeOpen && modeOptions.map(o => (
                <Pressable
                  key={o.value}
                  onPress={() => { Haptics.selectionAsync(); setPayMode(o.value); setModeOpen(false); if (!isPaymentRecord && uiType !== 'expense') { setCategory(o.value === 'credit' ? (uiType === 'sale' ? CREDIT_SALE_CATEGORIES[0] : PURCHASE_CATEGORIES[0]) : (uiType === 'sale' ? SALE_CATEGORIES[0] : PURCHASE_CATEGORIES[0])); } }}
                  style={[styles.textInput, { justifyContent: 'center', marginTop: 4, borderColor: o.value === effectiveMode ? primaryColor : colors.input, backgroundColor: colors.card }]}
                >
                  <Text style={{ color: colors.foreground }}>{o.label}</Text>
                </Pressable>
              ))}
              {isCreditExpense && (
                <Text style={{ fontSize: 12, color: '#92400E', marginTop: 6 }}>Credit expense: enter the creditor below. It appears under Creditors payments and is not counted as a purchase.</Text>
              )}
            </View>
          )}
          {isDepreciation && (
            <View style={[styles.creditNote, { backgroundColor: '#F1F5F9', borderColor: colors.border }]}>
              <Text style={{ fontSize: 12, color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Mode: Non-cash</Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>Depreciation is an accounting charge. No cash, bank or credit money leaves the business, so the mode is fixed.</Text>
            </View>
          )}

          {isStock && (
            <View style={[styles.stockSubRow, { backgroundColor: colors.background, borderColor: '#7C3AED33' }]}>
              {(['opening_stock', 'closing_stock'] as const).map((sub) => {
                const active = stockSubType === sub;
                const label  = sub === 'opening_stock' ? '↑ Opening Stock' : '↓ Closing Stock';
                return (
                  <Pressable
                    key={sub}
                    onPress={() => { Haptics.selectionAsync(); setStockSubType(sub); }}
                    style={[styles.stockSubBtn, { borderColor: active ? '#7C3AED' : colors.border, backgroundColor: active ? '#7C3AED' : 'transparent' }]}
                  >
                    <Text style={[styles.stockSubText, { color: active ? '#fff' : colors.mutedForeground }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Animated.View>

        {(isCreditSalePayment || isCreditPurchasePayment) && (
          <Animated.View entering={FadeInDown.delay(55).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              Select outstanding {isCreditSalePayment ? 'debtors' : 'creditors'}
            </Text>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
                {isCreditSalePayment ? 'People that are owing me' : 'people that I am owing'}
              </Text>
            <View style={{ borderColor: colors.input, backgroundColor: colors.background, gap: 6 }}>
              {outstandingCredits.map(item => (
                <Pressable
                  key={item.originalEntry.id}
                  onPress={() => setSelectedCreditEntryId(item.originalEntry.id)}
                  style={[styles.categoryChip, selectedCreditEntryId === item.originalEntry.id && { backgroundColor: primaryColor }]}
                >
                  <Text style={{ color: selectedCreditEntryId === item.originalEntry.id ? '#fff' : colors.foreground, fontSize: 12 }}>
                    {(item.originalEntry.itemName || item.originalEntry.category || 'Transaction')} · {item.originalEntry.partyName || 'Unknown'} · {fmt(item.remainingBalance)}
                  </Text>
                </Pressable>
              ))}
            </View>
            {selectedCredit && (
              <Text style={{ color: colors.mutedForeground, fontSize: 12, lineHeight: 18 }}>
                {selectedCredit.originalEntry.partyName} · {selectedCredit.originalEntry.partyPhone}{'\n'}
                Product: {selectedCredit.originalEntry.itemName || 'Transaction'} · Original: {fmt(selectedCredit.grossAmount)} · Paid: {fmt(selectedCredit.paidToDate)} · Remaining: {fmt(selectedCredit.remainingBalance)}
              </Text>
            )}
          </Animated.View>
        )}

        {/* ══════════════ SALE FIELDS ════════════════════════════════════════ */}
        {(isSale || isCreditSaleTransaction) && <>

          {/* VAT Payable banner — shown when qty + price entered */}
          {vatPayable > 0 && (
            <Animated.View entering={FadeInDown.delay(55).springify()}
              style={[styles.vatBanner, { backgroundColor: '#FFF3E0', borderColor: '#FB8C0044' }]}
            >
              <Tag size={14} color="#E65100" />
              <Text style={styles.vatBannerText}>
                VAT ({(VAT_RATE * 100).toFixed(1)}% of base sales): {fmt(vatPayable)} · Customer total: {fmt(saleAmount + vatPayable)}
              </Text>
            </Animated.View>
          )}

          {/* Product picker */}
          <Animated.View entering={FadeInDown.delay(70).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Product (optional)</Text>
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setShowProductPicker(true); }}
              style={({ pressed }) => [
                styles.pickerBtn,
                { borderColor: colors.input, backgroundColor: colors.background, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              {selectedProduct ? (
                <View style={styles.pickerSelected}>
                  <Package size={16} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.pickerSelectedName, { color: colors.foreground }]} numberOfLines={1}>
                      {selectedProduct.name}
                    </Text>
                    <Text style={[styles.pickerSelectedSub, { color: colors.mutedForeground }]}>
                      Suggested: {fmt(selectedProduct.suggestedPrice)} · VAT/unit: {fmt(extractVATAmount(selectedProduct.suggestedPrice))}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => { Haptics.selectionAsync(); setSelectedProduct(null); setUnitPrice(''); }}
                    hitSlop={8}
                  >
                    <X size={16} color={colors.mutedForeground} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.pickerPlaceholder}>
                  <ShoppingCart size={16} color={colors.mutedForeground} />
                  <Text style={[styles.pickerPlaceholderTxt, { color: colors.mutedForeground }]}>
                    Select a product…
                  </Text>
                  <ChevronDown size={16} color={colors.mutedForeground} />
                </View>
              )}
            </Pressable>
          </Animated.View>

          {/* Units sold */}
          <Animated.View entering={FadeInDown.delay(90).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Units Sold</Text>
            <QtyStepper value={saleQty} onChange={setSaleQty} color={primaryColor} />
            {errors.saleQty ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.saleQty}</Text> : null}
          </Animated.View>

          {/* Unit selling price */}
          <Animated.View entering={FadeInDown.delay(110).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.fieldLabelRow}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Unit Selling Price</Text>
              {selectedProduct && (
                <Text style={[styles.suggestedBadge, { color: colors.revenue, backgroundColor: colors.revenueBg }]}>
                  Suggested: {fmt(selectedProduct.suggestedPrice)}
                </Text>
              )}
            </View>
            <AmountInput
              value={unitPrice}
              onChangeText={(t) => { setUnitPrice(t); setErrors(e => ({ ...e, unitPrice: '' })); }}
              color={primaryColor}
              hasError={!!errors.unitPrice}
              testID="input-unit-price"
            />
            {errors.unitPrice ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.unitPrice}</Text> : null}
          </Animated.View>

          {/* Total amount (auto-calculated) */}
          <Animated.View entering={FadeInDown.delay(125).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Sales Amount (excl. VAT)</Text>
            <AmountInput
              value={saleQty > 0 && unitPriceNum > 0 ? String(saleAmount) : ''}
              onChangeText={() => undefined}
              color={colors.revenue}
              editable={false}
              testID="input-sale-total"
            />
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              {saleQty} unit{saleQty !== 1 ? 's' : ''} × {fmt(unitPriceNum)}
            </Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>VAT (7.5%): {fmt(vatPayable)}</Text>
            <Text style={{ color: colors.revenue, marginTop: 4 }}>Customer total: {fmt(saleAmount + vatPayable)}</Text>
          </Animated.View>

          {/* Category — shared by Sale and Credit Sale */}
          <Animated.View entering={FadeInDown.delay(160).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
            {errors.category ? <Text style={[styles.errorText, { color: colors.destructive, marginBottom: 4 }]}>{errors.category}</Text> : null}
            <View style={styles.categoryGrid}>
              {categories.map((cat) => {
                const selected = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => { Haptics.selectionAsync(); setCategory(cat); setErrors(e => ({ ...e, category: '' })); }}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      { backgroundColor: selected ? primaryColor : colors.muted, borderColor: selected ? primaryColor : colors.border, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={[styles.categoryText, { color: selected ? '#fff' : colors.foreground }]}>{formatCategoryLabel(cat)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {/* Date */}
          <Animated.View entering={FadeInDown.delay(180).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Date</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.date ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={date}
              onChangeText={(t) => { setDate(t); setErrors(e => ({ ...e, date: '' })); }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
            />
            {errors.date ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.date}</Text> : null}
          </Animated.View>

          {/* Notes */}
          <Animated.View entering={FadeInDown.delay(200).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.notesInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
            />
          </Animated.View>
        </>}

        {/* ══════════════ RETURN FIELDS ═════════════════════════════════════ */}
        {isReturn && <>

          {/* Product picker (required for outward returns) */}
          <Animated.View entering={FadeInDown.delay(70).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              {isReturnOutward ? 'Product to Return' : 'Product (optional)'}
            </Text>
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setShowReturnPicker(true); }}
              style={({ pressed }) => [
                styles.pickerBtn,
                { borderColor: colors.input, backgroundColor: colors.background, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Package size={15} color={returnProduct ? primaryColor : colors.mutedForeground} />
              <Text style={[styles.pickerBtnText, { color: returnProduct ? colors.foreground : colors.mutedForeground, flex: 1 }]}>
                {returnProduct ? returnProduct.name : isReturnOutward ? 'Select product to return…' : 'Select product to restock…'}
              </Text>
              {returnProduct && (
                <Pressable onPress={() => setReturnProduct(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <X size={14} color={colors.mutedForeground} />
                </Pressable>
              )}
            </Pressable>
          </Animated.View>

          {/* Qty Returned */}
          <Animated.View entering={FadeInDown.delay(85).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              {isReturnOutward ? 'Quantity Returned to Supplier' : 'Quantity Returned'}
            </Text>
            {errors.returnQty ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.returnQty}</Text> : null}
            <QtyStepper value={returnQty} onChange={setReturnQty} color={primaryColor} />
          </Animated.View>

          {/* Unit Price */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>{isReturnOutward ? 'Supplier credit per unit (base cost) (₦)' : 'Unit Price (₦)'}</Text>
            {errors.returnUnitPrice ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.returnUnitPrice}</Text> : null}
            <AmountInput
              value={returnUnitPrice}
              onChangeText={(t) => { setReturnUnitPrice(t); setErrors(e => ({ ...e, returnUnitPrice: '' })); }}
              placeholder="0.00"
              color={primaryColor}
              testID="input-return-price"
              editable={!isReturnOutward || !returnProduct}
            />
            {isReturnOutward && returnProduct ? (
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
                Supplier credit is fixed to this product&apos;s base cost.
              </Text>
            ) : null}
          </Animated.View>
          {isReturnOutward && returnProduct && returnQty > 0 && (
            <View style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>Returned inventory at landed cost: {fmt(Math.round(returnLandedUnitCost * returnQty * 100) / 100)}</Text>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>Supplier credit: {fmt(returnAmount)}</Text>
              <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>Supplier return expense: {fmt(Math.max(0, Math.round(returnLandedUnitCost * returnQty * 100) / 100 - returnAmount))}</Text>
            </View>
          )}

          {/* Total amount (auto-calculated) */}
          <Animated.View entering={FadeInDown.delay(115).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Total Amount</Text>
            <AmountInput
              value={returnQty > 0 && returnUnitPriceNum > 0 ? String(returnAmount) : ''}
              onChangeText={() => undefined}
              color={primaryColor}
              editable={false}
              testID="input-return-total"
            />
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              {returnQty} unit{returnQty !== 1 ? 's' : ''} × {fmt(returnUnitPriceNum)}
            </Text>
          </Animated.View>

          {/* Return category */}
          <Animated.View entering={FadeInDown.delay(125).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
            {errors.category ? <Text style={[styles.errorText, { color: colors.destructive, marginBottom: 4 }]}>{errors.category}</Text> : null}
            <View style={styles.categoryGrid}>
              {categories.map((cat) => {
                const selected = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => { Haptics.selectionAsync(); setCategory(cat); setErrors(e => ({ ...e, category: '' })); }}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      { backgroundColor: selected ? primaryColor : colors.muted, borderColor: selected ? primaryColor : colors.border, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={[styles.categoryText, { color: selected ? '#fff' : colors.foreground }]}>{formatCategoryLabel(cat)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {/* Date */}
          <Animated.View entering={FadeInDown.delay(130).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Date</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.date ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={date}
              onChangeText={(t) => { setDate(t); setErrors(e => ({ ...e, date: '' })); }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
            />
            {errors.date ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.date}</Text> : null}
          </Animated.View>

          {/* Notes */}
          <Animated.View entering={FadeInDown.delay(150).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.notesInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder={isReturnOutward ? 'Reason for returning goods to supplier…' : 'Reason for customer return…'}
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
            />
          </Animated.View>
        </>}

        {/* ══════════════ PURCHASE FIELDS ════════════════════════════════════ */}
        {(isPurchase || isCreditPurchaseTransaction) && <>

          {/* Purchase Category */}
          <Animated.View entering={FadeInDown.delay(55).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
            {errors.purchaseCategory ? <Text style={[styles.errorText, { color: colors.destructive, marginBottom: 4 }]}>{errors.purchaseCategory}</Text> : null}
            <View style={styles.categoryGrid}>
              {PURCHASE_CATEGORIES.map((purchaseCat) => {
                const selected = purchaseCategory === purchaseCat;
                return (
                  <Pressable
                    key={purchaseCat}
                    onPress={() => handlePurchaseCategorySelect(purchaseCat)}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      { backgroundColor: selected ? primaryColor : colors.muted, borderColor: selected ? primaryColor : colors.border, opacity: pressed ? 0.8 : 1 },
                    ]}
                    testID={`purchase-category-${purchaseCat.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    <Text style={[styles.categoryText, { color: selected ? '#fff' : colors.foreground }]}>{formatCategoryLabel(purchaseCat)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {purchaseCategory === 'RESTOCK' ? (
            <Animated.View entering={FadeInDown.delay(70).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Product to Restock</Text>
              <Pressable
                onPress={() => { Haptics.selectionAsync(); setShowPurchaseProductPicker(true); }}
                style={({ pressed }) => [
                  styles.pickerBtn,
                  { borderColor: errors.itemName ? colors.destructive : colors.input, backgroundColor: colors.background, opacity: pressed ? 0.8 : 1 },
                ]}
                testID="purchase-product-picker"
              >
                {selectedPurchaseProduct ? (
                  <View style={styles.pickerSelected}>
                    <Package size={16} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.pickerSelectedName, { color: colors.foreground }]} numberOfLines={1}>
                        {selectedPurchaseProduct.name}
                      </Text>
                      <Text style={[styles.pickerSelectedSub, { color: colors.mutedForeground }]}>
                        Cost: {fmt(selectedPurchaseProduct.costPrice)} · Stock: {selectedPurchaseProduct.stockQty} units
                      </Text>
                    </View>
                    <Pressable onPress={() => { setSelectedPurchaseProduct(null); setItemName(''); }} hitSlop={8}>
                      <X size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                ) : (
                  <View style={styles.pickerPlaceholder}>
                    <Package size={16} color={colors.mutedForeground} />
                    <Text style={[styles.pickerPlaceholderTxt, { color: colors.mutedForeground }]}>Select an existing product…</Text>
                    <ChevronDown size={16} color={colors.mutedForeground} />
                  </View>
                )}
              </Pressable>
              {errors.itemName ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.itemName}</Text> : null}
            </Animated.View>
          ) : (
            <Animated.View entering={FadeInDown.delay(70).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Product Name</Text>
              <TextInput
                style={[styles.textInput, { color: colors.foreground, borderColor: errors.itemName ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
                value={itemName}
                onChangeText={(t) => { setItemName(t); setErrors(e => ({ ...e, itemName: '' })); }}
                placeholder="e.g. Garri 50kg, iPhone 15, Fabric rolls"
                placeholderTextColor={colors.mutedForeground}
                testID="input-product-name"
              />
              {errors.itemName ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.itemName}</Text> : null}
            </Animated.View>
          )}

          {/* Quantity Purchased */}
          <Animated.View entering={FadeInDown.delay(85).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Quantity Purchased (units)</Text>
            <QtyStepper value={purchaseQty} onChange={setPurchaseQty} color={primaryColor} />
            <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
              Sets the initial stock count for this product
            </Text>
          </Animated.View>

          {/* Cost Breakdown */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Cost Breakdown</Text>

            {/* Base Cost */}
            <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Base Cost Price</Text>
            <AmountInput
              value={baseCost}
              onChangeText={(t) => { setBaseCost(t); setErrors(e => ({ ...e, baseCost: '' })); }}
              color={primaryColor}
              hasError={!!errors.baseCost}
              testID="input-base-cost"
            />
            {errors.baseCost ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.baseCost}</Text> : null}

            {/* Other cost rows */}
            {otherCosts.map((val, idx) => (
              <View key={idx} style={styles.materialRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>
                    Other Cost {idx + 1}
                  </Text>
                  <AmountInput
                    value={val}
                    onChangeText={(t) => updateOtherCost(idx, t)}
                    color={primaryColor}
                    testID={`input-other-${idx}`}
                  />
                </View>
                <Pressable
                  onPress={() => removeOtherCost(idx)}
                  style={({ pressed }) => [styles.removeBtn, { backgroundColor: colors.expenseBg, opacity: pressed ? 0.7 : 1 }]}
                >
                  <X size={14} color={colors.expense} />
                </Pressable>
              </View>
            ))}

            {/* Add Other Cost button */}
            <Pressable
              onPress={addOtherCost}
              style={({ pressed }) => [
                styles.addMaterialBtn,
                { borderColor: colors.primary, backgroundColor: pressed ? colors.secondary : 'transparent' },
              ]}
            >
              <Plus size={15} color={colors.primary} />
              <Text style={[styles.addMaterialText, { color: colors.primary }]}>+ Add Other Cost</Text>
            </Pressable>

            {/* Carriage Inward */}
            <Text style={[styles.subLabel, { color: colors.mutedForeground, marginTop: 4 }]}>Carriage Inward ₦</Text>
            <AmountInput
              value={carriageInward}
              onChangeText={setCarriageInward}
              placeholder="0.00"
              color={primaryColor}
              testID="input-carriage"
            />

            {/* Handling Cost */}
            <Text style={[styles.subLabel, { color: colors.mutedForeground, marginTop: 4 }]}>Handling Cost ₦</Text>
            <AmountInput
              value={handlingCost}
              onChangeText={setHandlingCost}
              placeholder="0.00"
              color={primaryColor}
              testID="input-handling"
            />

            {/* Carriage per unit info */}
            {carriagePerUnit > 0 && (
              <View style={[styles.infoBox, { backgroundColor: colors.secondary, borderColor: colors.primary + '33' }]}>
                <Info size={13} color={colors.primary} />
                <Text style={[styles.infoBoxText, { color: colors.primary }]}>
                  Carriage per unit: {fmt(carriagePerUnit)} ({fmt(carriageNum)} ÷ {purchaseQty} units)
                </Text>
              </View>
            )}

            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: purchaseVatCharged }} onPress={() => setPurchaseVatCharged(value => !value)} style={[styles.infoBox, { backgroundColor: colors.secondary, borderColor: colors.primary + '33' }]}>
              <Text style={{ color: colors.primary }}>{purchaseVatCharged ? '✓ ' : '○ '}Supplier charges VAT (7.5%)</Text>
            </Pressable>
            <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Purchase VAT (7.5%) ₦</Text>
            <TextInput accessibilityLabel="Purchase VAT" editable={false} value={purchaseVAT.toFixed(2)} style={{ color: colors.foreground, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }} />
            <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Withholding tax (5%) ₦</Text>
            <TextInput accessibilityLabel="Withholding tax" editable={false} value={withholdingTax.toFixed(2)} style={{ color: colors.foreground, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 8 }} />
            <Text style={{ color: colors.primary, marginVertical: 8 }}>Pay supplier: {fmt(supplierPayable)}</Text>
            {/* Total Landed Cost summary */}
            {totalLanded > 0 && (
              <View style={[styles.totalBox, { backgroundColor: colors.secondary, borderColor: colors.primary + '33' }]}>
                <View style={styles.totalBoxRow}>
                  <Text style={[styles.totalBoxLabel, { color: colors.mutedForeground }]}>Base purchase cost ({purchaseQty} units)</Text>
                  <Text style={[styles.totalBoxValue, { color: colors.foreground }]}>{fmt(basePurchaseTotal)}</Text>
                </View>
                {otherCostsSum > 0 && (
                  <View style={styles.totalBoxRow}>
                    <Text style={[styles.totalBoxLabel, { color: colors.mutedForeground }]}>Other Costs ({otherCosts.length})</Text>
                    <Text style={[styles.totalBoxValue, { color: colors.foreground }]}>{fmt(otherCostsSum)}</Text>
                  </View>
                )}
                {carriageNum > 0 && (
                  <View style={styles.totalBoxRow}>
                    <Text style={[styles.totalBoxLabel, { color: colors.mutedForeground }]}>Carriage Inward</Text>
                    <Text style={[styles.totalBoxValue, { color: colors.foreground }]}>{fmt(carriageNum)}</Text>
                  </View>
                )}
                {handlingNum > 0 && (
                  <View style={styles.totalBoxRow}>
                    <Text style={[styles.totalBoxLabel, { color: colors.mutedForeground }]}>Handling Cost</Text>
                    <Text style={[styles.totalBoxValue, { color: colors.foreground }]}>{fmt(handlingNum)}</Text>
                  </View>
                )}
                <View style={[styles.totalBoxRow, styles.totalBoxFinalRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.totalBoxFinalLabel, { color: colors.primary }]}>Total Landed Cost (excl. VAT)</Text>
                  <Text style={[styles.totalBoxFinalValue, { color: colors.primary }]}>{fmt(totalLanded)}</Text>
                </View>
              </View>
            )}
          </Animated.View>

          {/* Date */}
          <Animated.View entering={FadeInDown.delay(130).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Date</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.date ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={date}
              onChangeText={(t) => { setDate(t); setErrors(e => ({ ...e, date: '' })); }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              testID="input-date"
            />
            {errors.date ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.date}</Text> : null}
          </Animated.View>

          {/* Industry */}
          <Animated.View entering={FadeInDown.delay(160).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Industry</Text>
            {errors.industry ? <Text style={[styles.errorText, { color: colors.destructive, marginBottom: 4 }]}>{errors.industry}</Text> : null}
            <View style={styles.categoryGrid}>
              {INDUSTRIES.map((ind) => {
                const selected = industry === ind;
                return (
                  <Pressable
                    key={ind}
                    onPress={() => handleIndustrySelect(ind)}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      { backgroundColor: selected ? colors.primary : colors.muted, borderColor: selected ? colors.primary : colors.border, opacity: pressed ? 0.8 : 1 },
                    ]}
                    testID={`industry-${ind}`}
                  >
                    <Text style={[styles.categoryText, { color: selected ? '#fff' : colors.foreground }]}>{ind}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {/* Markup % */}
          <Animated.View entering={FadeInDown.delay(190).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.markupLabelRow}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Markup %</Text>
              {industry ? (
                <View style={[styles.defaultBadge, { backgroundColor: colors.secondary }]}>
                  <Text style={[styles.defaultBadgeText, { color: colors.primary }]}>
                    {INDUSTRY_MARKUP[industry as Industry]}% default
                  </Text>
                </View>
              ) : null}
            </View>
            <View style={[styles.amountRow, { borderColor: errors.markup ? colors.destructive : colors.input, backgroundColor: colors.background }]}>
              <TextInput
                style={[styles.amountInput, { color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 24 }]}
                value={markup}
                onChangeText={(t) => { setMarkup(t); setErrors(e => ({ ...e, markup: '' })); }}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                testID="input-markup"
              />
              <Text style={[styles.nairaSign, { color: primaryColor, fontSize: 22 }]}>%</Text>
            </View>
            {errors.markup ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.markup}</Text> : null}

            {totalLanded > 0 && markupNum > 0 && (
              <View style={[styles.suggestedPreview, { backgroundColor: colors.revenueBg }]}>
                <Tag size={15} color={colors.revenue} />
                <Text style={[styles.suggestedPreviewText, { color: colors.revenue }]}>
                  Suggested Price: {fmt(computedSuggested)} · VAT/unit: {fmt(extractVATAmount(computedSuggested))}
                </Text>
              </View>
            )}
          </Animated.View>

          {/* Notes */}
          <Animated.View entering={FadeInDown.delay(220).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.notesInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
            />
          </Animated.View>
        </>}

        {/* ══════════════ STOCK FIELDS ════════════════════════════════════════ */}
        {isStock && <>
          <Animated.View entering={FadeInDown.delay(70).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
              {stockSubType === 'opening_stock' ? 'Opening Stock Value' : 'Closing Stock Value'}
            </Text>
            <Text style={[{ fontSize: 12, fontFamily: 'Inter_400Regular', color: colors.mutedForeground, marginTop: -4 }]}>
              {stockSubType === 'opening_stock'
                ? 'Value of stock on hand at the start of the period'
                : 'Value of stock remaining at the end of the period'}
            </Text>
            <AmountInput
              value={amount}
              onChangeText={(t) => { setAmount(t); setErrors(e => ({ ...e, amount: '' })); }}
              color="#7C3AED"
              hasError={!!errors.amount}
              testID="input-stock-amount"
            />
            {errors.amount ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.amount}</Text> : null}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(100).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Date</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.date ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={date}
              onChangeText={(t) => { setDate(t); setErrors(e => ({ ...e, date: '' })); }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
            />
            {errors.date ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.date}</Text> : null}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(130).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.notesInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="e.g. End of month count…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
            />
          </Animated.View>
        </>}

        {/* ══════════════ EXPENSE FIELDS ══════════════════════════════════════ */}
        {!isPurchase && !isCreditPurchaseTransaction && !isStock && !isSale && !isCreditSaleTransaction && !isReturn && <>
          <Animated.View entering={FadeInDown.delay(100).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Amount</Text>
            <AmountInput
              value={amount}
              onChangeText={(t) => { setAmount(t); setErrors(e => ({ ...e, amount: '' })); }}
              color={primaryColor}
              hasError={!!errors.amount}
              testID="input-amount"
            />
            {errors.amount ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.amount}</Text> : null}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(150).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Date</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.date ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={date}
              onChangeText={(t) => { setDate(t); setErrors(e => ({ ...e, date: '' })); }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
            />
            {errors.date ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.date}</Text> : null}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(200).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
            {errors.category ? <Text style={[styles.errorText, { color: colors.destructive, marginBottom: 8 }]}>{errors.category}</Text> : null}
            <View style={styles.categoryGrid}>
              {categories.map((cat) => {
                const selected = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => { Haptics.selectionAsync(); setCategory(cat); setErrors(e => ({ ...e, category: '' })); }}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      { backgroundColor: selected ? primaryColor : colors.muted, borderColor: selected ? primaryColor : colors.border, opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={[styles.categoryText, { color: selected ? '#fff' : colors.foreground }]}>{formatCategoryLabel(cat)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(250).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Notes (optional)</Text>
            <TextInput
              style={[styles.textInput, styles.notesInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Add a note…"
              placeholderTextColor={colors.mutedForeground}
              multiline
              numberOfLines={3}
            />
          </Animated.View>
        </>}

        {isCreditExpense && (
          <Animated.View entering={FadeInDown.delay(265).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Creditor Name</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.partyName ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={partyName}
              onChangeText={(text) => { setPartyName(text); setErrors(current => ({ ...current, partyName: '' })); }}
              placeholder="Who are you owing?"
              placeholderTextColor={colors.mutedForeground}
            />
            {errors.partyName ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.partyName}</Text> : null}
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Phone Number</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.partyPhone ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={partyPhone}
              onChangeText={(text) => { setPartyPhone(text); setErrors(current => ({ ...current, partyPhone: '' })); }}
              keyboardType="phone-pad"
              placeholder="e.g. 08012345678"
              placeholderTextColor={colors.mutedForeground}
            />
            {errors.partyPhone ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.partyPhone}</Text> : null}
          </Animated.View>
        )}

        {(isReturn || isCreditSale || isCreditPurch) && (
          <Animated.View entering={FadeInDown.delay(265).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {(!isCreditPurchaseTransaction) && (
              <>
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Item / Product Name</Text>
                <TextInput
                  style={[styles.textInput, { color: colors.foreground, borderColor: errors.recordItemName ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
                  value={isReturn && returnProduct ? returnProduct.name : isCreditSaleTransaction && selectedProduct ? selectedProduct.name : recordItemName}
                  onChangeText={(text) => { setRecordItemName(text); setErrors(current => ({ ...current, recordItemName: '' })); }}
                  editable={!(isReturn && returnProduct) && !(isCreditSaleTransaction && selectedProduct)}
                  placeholder="Enter item or product name"
                  placeholderTextColor={colors.mutedForeground}
                />
                {errors.recordItemName ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.recordItemName}</Text> : null}
              </>
            )}
            {(isCreditSale || isCreditPurch) && (
              <>
                {isCreditSale && (
                  <>
                    <Pressable
                      onPress={() => setCustomerPickerOpen(true)}
                      style={[styles.textInput, { justifyContent: 'center', borderColor: colors.input, backgroundColor: colors.background }]}
                    >
                      <Text style={{ color: colors.foreground }}>{customerId ? 'Existing customer selected' : 'Select existing customer or enter New customer below'}</Text>
                    </Pressable>
                    <Modal visible={customerPickerOpen} transparent animationType="slide" onRequestClose={() => setCustomerPickerOpen(false)}>
                      <Pressable style={styles.overlay} onPress={() => setCustomerPickerOpen(false)}>
                        <View style={[styles.sheet, { backgroundColor: colors.card }]}>
                          <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Customers</Text>
                          <FlatList data={customers} keyExtractor={(item) => item.id} renderItem={({ item }) => (
                            <Pressable style={styles.productRow} onPress={() => {
                              setCustomerId(item.id); setPartyName(item.fullName); setPartyPhone(item.phone);
                              setPartyAddress(item.homeAddress); setPartyEmail(item.email ?? ''); setCustomerPickerOpen(false);
                            }}>
                              <Text style={{ color: colors.foreground }}>{item.fullName || 'Unnamed'} · {item.phone}</Text>
                            </Pressable>
                          )} ListEmptyComponent={<Text style={{ color: colors.mutedForeground }}>No saved customers yet.</Text>} />
                        </View>
                      </Pressable>
                    </Modal>
                  </>
                )}
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                  {isCreditSale ? 'Customer Name' : 'Supplier Name'}
                </Text>
                <TextInput
                  style={[styles.textInput, { color: colors.foreground, borderColor: errors.partyName ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
                  value={partyName}
                  onChangeText={(text) => { setPartyName(text); setCustomerId(''); setErrors(current => ({ ...current, partyName: '' })); }}
                  placeholder={isCreditSale ? 'Name of person buying on credit' : 'Name of person selling on credit'}
                  placeholderTextColor={colors.mutedForeground}
                />
                {errors.partyName ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.partyName}</Text> : null}
                <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Phone Number</Text>
                <TextInput
                  style={[styles.textInput, { color: colors.foreground, borderColor: errors.partyPhone ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
                  value={partyPhone}
                  onChangeText={(text) => { setPartyPhone(text); setCustomerId(''); setErrors(current => ({ ...current, partyPhone: '' })); }}
                  keyboardType="phone-pad"
                  placeholder="e.g. 08012345678"
                  placeholderTextColor={colors.mutedForeground}
                />
                {errors.partyPhone ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.partyPhone}</Text> : null}
                {isCreditSale && <>
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Address (optional)</Text>
                  <TextInput style={[styles.textInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]} value={partyAddress} onChangeText={setPartyAddress} placeholder="Customer address" placeholderTextColor={colors.mutedForeground} />
                  <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Email (optional)</Text>
                  <TextInput style={[styles.textInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]} value={partyEmail} onChangeText={setPartyEmail} keyboardType="email-address" placeholder="customer@example.com" placeholderTextColor={colors.mutedForeground} />
                  <Pressable onPress={() => setSaveCustomer(value => !value)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 8 }}>
                    <CheckCircle size={18} color={saveCustomer ? colors.primary : colors.mutedForeground} />
                    <Text style={{ color: colors.foreground }}>Save customer for future sales</Text>
                  </Pressable>
                </>}
              </>
            )}
          </Animated.View>
        )}
        {isSale && (
          <Animated.View entering={FadeInDown.delay(265).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Customer contact (optional)</Text>
            <Pressable onPress={() => setCustomerPickerOpen(true)} style={[styles.textInput, { justifyContent: 'center', borderColor: colors.input, backgroundColor: colors.background }]}>
              <Text style={{ color: colors.foreground }}>{customerId ? 'Existing customer selected' : 'Select existing customer'}</Text>
            </Pressable>
            <Modal visible={customerPickerOpen} transparent animationType="slide" onRequestClose={() => setCustomerPickerOpen(false)}>
              <Pressable style={styles.overlay} onPress={() => setCustomerPickerOpen(false)}><View style={[styles.sheet, { backgroundColor: colors.card }]}>
                <Text style={[styles.fieldLabel, { color: colors.foreground }]}>Customers</Text>
                <FlatList data={customers} keyExtractor={item => item.id} renderItem={({ item }) => <Pressable style={styles.productRow} onPress={() => { setCustomerId(item.id); setPartyName(item.fullName); setPartyPhone(item.phone); setPartyAddress(item.homeAddress); setPartyEmail(item.email ?? ''); setCustomerPickerOpen(false); }}><Text style={{ color: colors.foreground }}>{item.fullName} · {item.phone}</Text></Pressable>} />
              </View></Pressable>
            </Modal>
            <TextInput style={[styles.textInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]} value={partyName} onChangeText={(text) => { setPartyName(text); setCustomerId(''); }} placeholder="Customer name" placeholderTextColor={colors.mutedForeground} />
            <TextInput style={[styles.textInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]} value={partyPhone} onChangeText={(text) => { setPartyPhone(text); setCustomerId(''); }} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor={colors.mutedForeground} />
            <TextInput style={[styles.textInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]} value={partyAddress} onChangeText={setPartyAddress} placeholder="Address (optional)" placeholderTextColor={colors.mutedForeground} />
            <TextInput style={[styles.textInput, { color: colors.foreground, borderColor: colors.input, backgroundColor: colors.background }]} value={partyEmail} onChangeText={setPartyEmail} keyboardType="email-address" placeholder="Email (optional)" placeholderTextColor={colors.mutedForeground} />
            <Pressable onPress={() => setSaveCustomer(value => !value)} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <CheckCircle size={18} color={saveCustomer ? colors.primary : colors.mutedForeground} />
              <Text style={{ color: colors.foreground }}>Save customer for future sales</Text>
            </Pressable>
          </Animated.View>
        )}

        {/* Save Button */}
        <Animated.View entering={FadeInUp.delay(280).springify()} style={styles.saveWrap}>
          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: primaryColor, opacity: saving ? 0.7 : pressed ? 0.88 : 1, transform: [{ scale: pressed && !saving ? 0.98 : 1 }] },
            ]}
            testID="btn-save"
          >
            {saving
              ? <ActivityIndicator color="#fff" style={{ marginRight: 8 }} />
              : <SaveIcon size={18} color="#fff" style={{ marginRight: 8 } as any} />
            }
            <Text style={styles.saveBtnText}>
              {saving
                ? 'Saving…'
                : isSale        ? 'Save Sale'
                : isCreditSalePayment ? 'Save Debtors Payment'
                : isCreditSaleTransaction ? 'Save Debtors'
                : isPurchase    ? 'Save Purchase'
                : isCreditPurchasePayment ? 'Save Creditors Payment'
                : isCreditPurchaseTransaction ? 'Save Creditors'
                : isReturn      ? 'Save Return'
                : isStock
                  ? (stockSubType === 'opening_stock' ? 'Save Opening Stock' : 'Save Closing Stock')
                : 'Save Expense'}
            </Text>
          </Pressable>
        </Animated.View>

      </ScrollView>

      {/* Markup Suggestion Popup */}
      {savedPurchase && (
        <MarkupPopup
          visible={showPopup}
          info={savedPurchase}
          onUsePrice={handleUsePrice}
          onSkip={handleSkip}
        />
      )}

      {/* Product Picker Modal (Sale) */}
      <ProductPickerModal
        visible={showProductPicker}
        products={products}
        onSelect={handleProductSelect}
        onClose={() => setShowProductPicker(false)}
      />

      {/* Product Picker Modal (Purchase Restock) */}
      <ProductPickerModal
        visible={showPurchaseProductPicker}
        products={products}
        onSelect={handlePurchaseProductSelect}
        onClose={() => setShowPurchaseProductPicker(false)}
        allowNone={false}
      />

      {/* Product Picker Modal (Return Inward) */}
      <ProductPickerModal
        visible={showReturnPicker}
        products={products}
        onSelect={(p) => {
          setReturnProduct(p);
          if (p) setReturnUnitPrice(String(isReturnOutward ? p.costPrice : Math.round(p.suggestedPrice)));
        }}
        onClose={() => setShowReturnPicker(false)}
      />

      {/* Toast */}
      {toast && <Toast toast={toast} onHide={hideToast} />}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: '75%' },
  productRow: { paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn:     { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerTitle:  { textAlign: 'center', fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  headerRight:  { width: 36 },
  scroll:       { flex: 1 },
  scrollContent:{ padding: 16, gap: 12 },

  fieldCard:    { borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
  fieldLabel:   { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.6 },
  fieldLabelRow:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fieldHint:    { fontSize: 11, fontFamily: 'Inter_400Regular' },
  subLabel:     { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 2 },

  toggleGrid:   { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, padding: 4, gap: 3 },
  toggleBtn2:   { width: '32%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10, gap: 5 },
  toggleText:   { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  creditChoiceHint: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular' },

  creditNote:   { borderRadius: 12, borderWidth: 1, padding: 12, marginTop: 8 },
  stockSubRow:  { flexDirection: 'row', gap: 8, borderRadius: 12, borderWidth: 1, padding: 6, marginTop: 2 },
  stockSubBtn:  { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1.5 },
  stockSubText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // VAT payable banner
  vatBanner:     { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, padding: 12 },
  vatBannerText: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#E65100' },

  // Product picker
  pickerBtn:          { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 13 },
  pickerBtnText:      { fontSize: 14, fontFamily: 'Inter_400Regular', flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerSelected:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickerSelectedName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  pickerSelectedSub:  { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  pickerPlaceholder:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pickerPlaceholderTxt: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular' },
  suggestedBadge:     { fontSize: 11, fontFamily: 'Inter_600SemiBold', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },

  amountRow:    { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14 },
  nairaSign:    { fontSize: 26, fontFamily: 'Inter_700Bold', marginRight: 4 },
  amountInput:  { flex: 1, fontSize: 28, paddingVertical: 12 },

  materialRow:  { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  removeBtn:    { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },

  addMaterialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 12,
  },
  addMaterialText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  infoBox:     { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 10, borderWidth: 1, padding: 10, marginTop: 4 },
  infoBoxText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium' },

  totalBox:         { borderRadius: 12, borderWidth: 1, padding: 12, gap: 6, marginTop: 4 },
  totalBoxRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalBoxLabel:    { fontSize: 13, fontFamily: 'Inter_400Regular' },
  totalBoxValue:    { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  totalBoxFinalRow: { paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  totalBoxFinalLabel: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  totalBoxFinalValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },

  markupLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  defaultBadge:   { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  defaultBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  suggestedPreview: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  suggestedPreviewText: { fontSize: 13, fontFamily: 'Inter_700Bold' },

  textInput:  { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  notesInput: { height: 80, textAlignVertical: 'top' },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  categoryText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  errorText:  { fontSize: 12, fontFamily: 'Inter_400Regular' },
  saveWrap:   { marginTop: 8 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 16, paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 6,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },

  // ── Popup ─────────────────────────────────────────────────────────────────
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  popup:   { width: '100%', borderRadius: 24, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.3, shadowRadius: 28, elevation: 24 },
  popupHeader:   { padding: 22, alignItems: 'center', gap: 5 },
  popupIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  popupIconText: { fontSize: 26, color: '#fff', fontFamily: 'Inter_700Bold' },
  popupTitle:    { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff', textAlign: 'center' },
  popupSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.7)', textAlign: 'center' },
  popupBody:     { borderTopWidth: StyleSheet.hairlineWidth },
  popupRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  popupRowLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', flexShrink: 0 },
  popupRowValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'right', flex: 1 },
  markupEditBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  markupEditInput: { fontSize: 16, minWidth: 50, textAlign: 'right' },
  markupEditPct: { fontSize: 14, marginLeft: 2 },
  priceBox:      { marginHorizontal: 16, marginVertical: 12, borderRadius: 16, padding: 18, alignItems: 'center', gap: 3 },
  priceBoxLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.6 },
  priceBoxAmount:{ fontSize: 32, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  priceBoxProfit:{ fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
  vatBadge:      { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(27,122,62,0.12)', marginTop: 4, marginBottom: 2 },
  vatBadgeText:  { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  popupActions:  { paddingHorizontal: 16, paddingBottom: 20, paddingTop: 4, gap: 10 },
  popupBtn:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 14, gap: 8 },
  popupBtnPrimary: {},
  popupBtnPrimaryText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold' },
  popupBtnOutline: { borderWidth: 1.5 },
  popupBtnOutlineText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  popupSkip:     { alignItems: 'center', paddingVertical: 6 },
  popupSkipText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  // ── Toast ─────────────────────────────────────────────────────────────────
  toast: {
    position: 'absolute', bottom: 40, left: 20, right: 20,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 10, zIndex: 9999,
  },
  toastText: { flex: 1, color: '#fff', fontSize: 14, fontFamily: 'Inter_500Medium', lineHeight: 20 },
});
