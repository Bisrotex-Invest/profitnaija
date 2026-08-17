import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { useEntries, EntryType } from '@/context/EntriesContext';

// UI type includes a 'stock' pseudo-type that maps to opening_stock / closing_stock
type UiEntryType = 'sale' | 'purchase' | 'expense' | 'stock';
import { INDUSTRIES, INDUSTRY_MARKUP, Industry } from '@/constants/markup';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

const NAIRA = '₦';

const SALE_CATEGORIES = ['Goods', 'Services', 'Online', 'Wholesale', 'Retail', 'Other'];
const EXPENSE_CATEGORIES = ['Rent', 'Transport', 'Supplies', 'Utilities', 'Marketing', 'Salaries', 'Equipment', 'Other'];

function getTodayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmt(n: number): string {
  return NAIRA + fmtNum(n);
}

function parseAmt(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0;
}

// ── Markup Suggestion Popup ───────────────────────────────────────────────────

interface SavedPurchaseInfo {
  itemName: string;
  baseCost: number;
  materialCosts: number[];
  carriageInward: number;
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

  const markupNum = parseFloat(markupStr) || 0;
  const selling = info.totalLandedCost * (1 + markupNum / 100);
  const profit = selling - info.totalLandedCost;
  const materialsTotal = info.materialCosts.reduce((s, c) => s + c, 0);

  const handleUse = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onUsePrice(markupNum, selling);
  };

  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent>
      <View style={styles.overlay}>
        <Animated.View entering={FadeInUp.springify()} style={[styles.popup, { backgroundColor: colors.card }]}>

          {/* Header */}
          <View style={[styles.popupHeader, { backgroundColor: colors.headerBg }]}>
            <View style={styles.popupIconWrap}>
              <Text style={styles.popupIconText}>₦</Text>
            </View>
            <Text style={styles.popupTitle}>Suggested Selling Price</Text>
            <Text style={styles.popupSubtitle}>Based on industry markup</Text>
          </View>

          {/* Cost breakdown */}
          <View style={[styles.popupBody, { borderColor: colors.border }]}>
            <PopupRow label="Item" value={info.itemName} colors={colors} />
            <PopupRow label="Base Cost" value={fmt(info.baseCost)} colors={colors} />
            {materialsTotal > 0 && (
              <PopupRow
                label={`Material Costs (${info.materialCosts.length})`}
                value={fmt(materialsTotal)}
                colors={colors}
              />
            )}
            {info.carriageInward > 0 && (
              <PopupRow label="Carriage Inward" value={fmt(info.carriageInward)} colors={colors} />
            )}
            <PopupRow
              label="Total Landed Cost"
              value={fmt(info.totalLandedCost)}
              colors={colors}
              bold
            />
            <PopupRow label="Industry" value={info.industry} colors={colors} />

            {/* Editable markup row */}
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

          {/* Suggested price highlight */}
          <View style={[styles.priceBox, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.priceBoxLabel, { color: colors.primary }]}>Suggested Selling Price</Text>
            <Text style={[styles.priceBoxAmount, { color: colors.primary }]}>{fmt(selling)}</Text>
            <Text style={[styles.priceBoxProfit, { color: colors.accent }]}>
              Profit per unit: {fmt(profit)} (+{markupNum.toFixed(1)}%)
            </Text>
          </View>

          {/* Buttons */}
          <View style={styles.popupActions}>
            <Pressable
              onPress={handleUse}
              style={({ pressed }) => [
                styles.popupBtn, styles.popupBtnPrimary,
                { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <Feather name="check-circle" size={16} color="#fff" />
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
                <Feather name="edit-2" size={15} color={colors.primary} />
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

function PopupRow({
  label, value, colors, bold = false,
}: {
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

// ── Toast notification ────────────────────────────────────────────────────────

interface ToastState { message: string; type: 'success' | 'error' }

function Toast({ toast, onHide }: { toast: ToastState; onHide: () => void }) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    timerRef.current = setTimeout(onHide, toast.type === 'success' ? 2000 : 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [toast, onHide]);

  const bg = toast.type === 'success' ? '#15803D' : '#B91C1C';
  const icon: 'check-circle' | 'alert-circle' =
    toast.type === 'success' ? 'check-circle' : 'alert-circle';

  return (
    <Animated.View entering={FadeInDown.springify()} style={[styles.toast, { backgroundColor: bg }]}>
      <Feather name={icon} size={16} color="#fff" />
      <Text style={styles.toastText} numberOfLines={3}>{toast.message}</Text>
    </Animated.View>
  );
}

// ── Amount input row (reusable) ───────────────────────────────────────────────

function AmountInput({
  value, onChangeText, placeholder = '0.00', color, hasError = false, testID,
}: {
  value: string; onChangeText: (v: string) => void;
  placeholder?: string; color: string; hasError?: boolean; testID?: string;
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
      />
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function AddEntryScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addEntry, addProduct } = useEntries();

  // General fields
  const [uiType, setUiType] = useState<UiEntryType>('sale');
  const [stockSubType, setStockSubType] = useState<'opening_stock' | 'closing_stock'>('opening_stock');
  const [amount, setAmount] = useState('');         // sale/expense/stock amount
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState(getTodayString());

  // Purchase-specific fields
  const [itemName, setItemName] = useState('');
  const [purchaseQty, setPurchaseQty] = useState('1');  // units bought
  const [baseCost, setBaseCost] = useState('');
  const [materialCosts, setMaterialCosts] = useState<string[]>([]);
  const [carriageInward, setCarriageInward] = useState('');
  const [industry, setIndustry] = useState('');
  const [markup, setMarkup] = useState('');

  // Popup state
  const [showPopup, setShowPopup] = useState(false);
  const [savedPurchase, setSavedPurchase] = useState<SavedPurchaseInfo | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Ref-based lock for the product-save popup — prevents multiple taps on
  // "Use This Price" from firing addProduct more than once.
  const savingProductRef = useRef(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
  }, []);
  const hideToast = useCallback(() => setToast(null), []);

  const isPurchase = uiType === 'purchase';
  const isSale = uiType === 'sale';
  const isStock = uiType === 'stock';
  // The actual EntryType saved to Firestore
  const actualEntryType: EntryType = isStock ? stockSubType : (uiType as EntryType);
  const primaryColor = isSale
    ? colors.revenue
    : isPurchase
    ? colors.primary
    : isStock
    ? '#7C3AED'
    : colors.expense;

  // ── Computed totals (purchase) ─────────────────────────────────────────────
  const baseCostNum = useMemo(() => parseAmt(baseCost), [baseCost]);
  const materialCostsNums = useMemo(() => materialCosts.map(parseAmt), [materialCosts]);
  const materialsSum = useMemo(() => materialCostsNums.reduce((s, n) => s + n, 0), [materialCostsNums]);
  const carriageNum = useMemo(() => parseAmt(carriageInward), [carriageInward]);
  const totalLanded = baseCostNum + materialsSum + carriageNum;
  const markupNum = parseFloat(markup) || 0;
  const computedSuggested = totalLanded * (1 + markupNum / 100);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleTypeToggle = useCallback((type: UiEntryType) => {
    Haptics.selectionAsync();
    setUiType(type);
    setCategory('');
    setAmount('');
    setErrors({});
  }, []);

  const handleIndustrySelect = useCallback((ind: string) => {
    Haptics.selectionAsync();
    setIndustry(ind);
    const def = INDUSTRY_MARKUP[ind as Industry];
    if (def !== undefined) setMarkup(String(def));
    setErrors((e) => ({ ...e, industry: '' }));
  }, []);

  const addMaterialCost = () => {
    Haptics.selectionAsync();
    setMaterialCosts((prev) => [...prev, '']);
  };

  const updateMaterialCost = (index: number, value: string) => {
    setMaterialCosts((prev) => prev.map((v, i) => (i === index ? value : v)));
  };

  const removeMaterialCost = (index: number) => {
    Haptics.selectionAsync();
    setMaterialCosts((prev) => prev.filter((_, i) => i !== index));
  };

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  // ── Validation ─────────────────────────────────────────────────────────────

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) newErrors.date = 'Use format YYYY-MM-DD';

    if (isPurchase) {
      if (!itemName.trim()) newErrors.itemName = 'Enter item name';
      if (!baseCost || baseCostNum <= 0) newErrors.baseCost = 'Enter a valid base cost';
      if (!industry) newErrors.industry = 'Select an industry';
      if (!markup || markupNum < 0) newErrors.markup = 'Enter a valid markup %';
    } else if (isStock) {
      const parsed = parseAmt(amount);
      if (!amount || parsed <= 0) newErrors.amount = 'Enter a valid stock value';
    } else {
      const parsed = parseAmt(amount);
      if (!amount || parsed <= 0) newErrors.amount = 'Enter a valid amount';
      if (!category) newErrors.category = 'Select a category';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // ── Save ───────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!validate()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    setSaving(true);
    try {
      if (isPurchase) {
        await addEntry({
          type: 'purchase',
          amount: totalLanded,           // primary amount = total landed cost
          category: industry,
          notes,
          date,
          itemName: itemName.trim(),
          baseCost: baseCostNum,
          materialCosts: materialCostsNums,
          carriageInward: carriageNum,
          totalLandedCost: totalLanded,
          industry,
          markup: markupNum,
          suggestedPrice: computedSuggested,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSavedPurchase({
          itemName: itemName.trim(),
          baseCost: baseCostNum,
          materialCosts: materialCostsNums,
          carriageInward: carriageNum,
          totalLandedCost: totalLanded,
          industry,
          markup: markupNum,
          date,
        });
        // Reset saving so the button isn't stuck disabled while the popup is open.
        setSaving(false);
        setShowPopup(true);
      } else if (isStock) {
        await addEntry({
          type: actualEntryType,
          amount: parseAmt(amount),
          category: stockSubType === 'opening_stock' ? 'Opening Stock' : 'Closing Stock',
          notes,
          date,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Saved successfully!', 'success');
        setTimeout(() => router.back(), 1200);
      } else {
        await addEntry({
          type: actualEntryType,
          amount: parseAmt(amount),
          category,
          notes,
          date,
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast('Saved successfully!', 'success');
        setTimeout(() => router.back(), 1200);
      }
    } catch (err: any) {
      // Offline fallback — entry queued to AsyncStorage, treat as success
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
    // Ref guard prevents double-saves when the user taps the button rapidly.
    if (!savedPurchase || savingProductRef.current) return;
    savingProductRef.current = true;
    const initialQty = parseInt(purchaseQty, 10) || 1;
    try {
      await addProduct({
        name: savedPurchase.itemName,
        costPrice: savedPurchase.totalLandedCost,
        industry: savedPurchase.industry,
        markup: finalMarkup,
        suggestedPrice: finalPrice,
        date: savedPurchase.date,
        stockQty: initialQty,  // units bought — set from quantity field
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

  const handleSkip = () => {
    setShowPopup(false);
    router.back();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const categories = isSale ? SALE_CATEGORIES : EXPENSE_CATEGORIES;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.card, paddingTop: topInset + 12, borderBottomColor: colors.border }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.closeBtn, { opacity: pressed ? 0.6 : 1 }]}
          disabled={saving}
          testID="close-add-entry"
        >
          <Feather name="x" size={22} color={colors.mutedForeground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>New Entry</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Type Toggle (2 × 2 grid) ──────────────────────────────────────── */}
        <Animated.View entering={FadeInDown.delay(40).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Entry Type</Text>
          <View style={[styles.toggleGrid, { backgroundColor: colors.muted }]}>
            {(
              [
                { type: 'sale' as UiEntryType, label: 'Sale', icon: 'trending-up', color: colors.revenue },
                { type: 'purchase' as UiEntryType, label: 'Purchase', icon: 'shopping-bag', color: colors.primary },
                { type: 'expense' as UiEntryType, label: 'Expense', icon: 'trending-down', color: colors.expense },
                { type: 'stock' as UiEntryType, label: 'Stock', icon: 'archive', color: '#7C3AED' },
              ] as const
            ).map(({ type, label, icon, color }) => {
              const active = uiType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => handleTypeToggle(type)}
                  style={[styles.toggleBtn2, active && { backgroundColor: color }]}
                  testID={`toggle-${type}`}
                >
                  <Feather name={icon as any} size={13} color={active ? '#fff' : colors.mutedForeground} />
                  <Text style={[styles.toggleText, { color: active ? '#fff' : colors.mutedForeground }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Stock sub-toggle: Opening / Closing */}
          {isStock && (
            <View style={[styles.stockSubRow, { backgroundColor: colors.background, borderColor: '#7C3AED33' }]}>
              {(['opening_stock', 'closing_stock'] as const).map((sub) => {
                const active = stockSubType === sub;
                const label = sub === 'opening_stock' ? '↑ Opening Stock' : '↓ Closing Stock';
                return (
                  <Pressable
                    key={sub}
                    onPress={() => { Haptics.selectionAsync(); setStockSubType(sub); }}
                    style={[
                      styles.stockSubBtn,
                      { borderColor: active ? '#7C3AED' : colors.border, backgroundColor: active ? '#7C3AED' : 'transparent' },
                    ]}
                  >
                    <Text style={[styles.stockSubText, { color: active ? '#fff' : colors.mutedForeground }]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </Animated.View>

        {/* ══════════════════ PURCHASE FIELDS ══════════════════════════════════ */}
        {isPurchase && <>

          {/* Item Name */}
          <Animated.View entering={FadeInDown.delay(70).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Item Name</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.itemName ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={itemName}
              onChangeText={(t) => { setItemName(t); setErrors((e) => ({ ...e, itemName: '' })); }}
              placeholder="e.g. Garri 50kg, iPhone 15, Fabric rolls"
              placeholderTextColor={colors.mutedForeground}
              testID="input-item-name"
            />
            {errors.itemName ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.itemName}</Text> : null}
          </Animated.View>

          {/* Quantity purchased */}
          <Animated.View entering={FadeInDown.delay(85).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Quantity Purchased (units)</Text>
            <View style={[styles.amountRow, { borderColor: colors.input, backgroundColor: colors.background }]}>
              <MaterialCommunityIcons name="package-variant-closed" size={20} color={colors.primary} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.amountInput, { color: colors.foreground, fontFamily: 'Inter_700Bold', fontSize: 24 }]}
                value={purchaseQty}
                onChangeText={(t) => setPurchaseQty(t.replace(/[^0-9]/g, '') || '1')}
                placeholder="1"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                testID="input-purchase-qty"
              />
              <Text style={[styles.nairaSign, { color: colors.mutedForeground, fontSize: 16 }]}>units</Text>
            </View>
            <Text style={[{ fontSize: 11, fontFamily: 'Inter_400Regular', color: colors.mutedForeground }]}>
              Sets the initial stock count for this product in the Stock tab
            </Text>
          </Animated.View>

          {/* Base Cost + material costs + carriage all in one card */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Cost Breakdown</Text>

            {/* Base Cost */}
            <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>Base Cost Price</Text>
            <AmountInput
              value={baseCost}
              onChangeText={(t) => { setBaseCost(t); setErrors((e) => ({ ...e, baseCost: '' })); }}
              color={primaryColor}
              hasError={!!errors.baseCost}
              testID="input-base-cost"
            />
            {errors.baseCost ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.baseCost}</Text> : null}

            {/* Material cost rows */}
            {materialCosts.map((val, idx) => (
              <View key={idx} style={styles.materialRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.subLabel, { color: colors.mutedForeground }]}>
                    Material Cost {idx + 1}
                  </Text>
                  <AmountInput
                    value={val}
                    onChangeText={(t) => updateMaterialCost(idx, t)}
                    color={primaryColor}
                    testID={`input-material-${idx}`}
                  />
                </View>
                <Pressable
                  onPress={() => removeMaterialCost(idx)}
                  style={({ pressed }) => [styles.removeBtn, { backgroundColor: colors.expenseBg, opacity: pressed ? 0.7 : 1 }]}
                >
                  <Feather name="x" size={14} color={colors.expense} />
                </Pressable>
              </View>
            ))}

            {/* Add Material Cost button */}
            <Pressable
              onPress={addMaterialCost}
              style={({ pressed }) => [
                styles.addMaterialBtn,
                { borderColor: colors.primary, backgroundColor: pressed ? colors.secondary : 'transparent' },
              ]}
            >
              <Feather name="plus" size={15} color={colors.primary} />
              <Text style={[styles.addMaterialText, { color: colors.primary }]}>+ Add Material Cost</Text>
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

            {/* Total Landed Cost summary */}
            {totalLanded > 0 && (
              <View style={[styles.totalBox, { backgroundColor: colors.secondary, borderColor: colors.primary + '33' }]}>
                <View style={styles.totalBoxRow}>
                  <Text style={[styles.totalBoxLabel, { color: colors.mutedForeground }]}>Base Cost</Text>
                  <Text style={[styles.totalBoxValue, { color: colors.foreground }]}>{fmt(baseCostNum)}</Text>
                </View>
                {materialsSum > 0 && (
                  <View style={styles.totalBoxRow}>
                    <Text style={[styles.totalBoxLabel, { color: colors.mutedForeground }]}>Materials ({materialCosts.length})</Text>
                    <Text style={[styles.totalBoxValue, { color: colors.foreground }]}>{fmt(materialsSum)}</Text>
                  </View>
                )}
                {carriageNum > 0 && (
                  <View style={styles.totalBoxRow}>
                    <Text style={[styles.totalBoxLabel, { color: colors.mutedForeground }]}>Carriage Inward</Text>
                    <Text style={[styles.totalBoxValue, { color: colors.foreground }]}>{fmt(carriageNum)}</Text>
                  </View>
                )}
                <View style={[styles.totalBoxRow, styles.totalBoxFinalRow, { borderTopColor: colors.border }]}>
                  <Text style={[styles.totalBoxFinalLabel, { color: colors.primary }]}>Total Landed Cost</Text>
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
              onChangeText={(t) => { setDate(t); setErrors((e) => ({ ...e, date: '' })); }}
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
                onChangeText={(t) => { setMarkup(t); setErrors((e) => ({ ...e, markup: '' })); }}
                placeholder="0"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
                testID="input-markup"
              />
              <Text style={[styles.nairaSign, { color: primaryColor, fontSize: 22 }]}>%</Text>
            </View>
            {errors.markup ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.markup}</Text> : null}

            {/* Suggested price live preview */}
            {totalLanded > 0 && markupNum > 0 && (
              <View style={[styles.suggestedPreview, { backgroundColor: colors.revenueBg }]}>
                <MaterialCommunityIcons name="tag-outline" size={15} color={colors.revenue} />
                <Text style={[styles.suggestedPreviewText, { color: colors.revenue }]}>
                  Suggested Price: {fmt(computedSuggested)}
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

        {/* ══════════════════ STOCK FIELDS ═════════════════════════════════════ */}
        {isStock && <>
          {/* Stock value */}
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
              onChangeText={(t) => { setAmount(t); setErrors((e) => ({ ...e, amount: '' })); }}
              color="#7C3AED"
              hasError={!!errors.amount}
              testID="input-stock-amount"
            />
            {errors.amount ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.amount}</Text> : null}
          </Animated.View>

          {/* Date */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Date</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.date ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={date}
              onChangeText={(t) => { setDate(t); setErrors((e) => ({ ...e, date: '' })); }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              testID="input-stock-date"
            />
            {errors.date ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.date}</Text> : null}
          </Animated.View>

          {/* Notes */}
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

          {/* Formula reminder */}
          <View style={[styles.formulaBox, { backgroundColor: '#7C3AED11', borderColor: '#7C3AED33' }]}>
            <MaterialCommunityIcons name="information-outline" size={16} color="#7C3AED" />
            <Text style={[styles.formulaText, { color: '#7C3AED' }]}>
              Total Cost Price = Opening + Purchases + Carriage − Closing
            </Text>
          </View>
        </>}

        {/* ══════════════════ SALE / EXPENSE FIELDS ════════════════════════════ */}
        {!isPurchase && !isStock && <>

          {/* Amount */}
          <Animated.View entering={FadeInDown.delay(100).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Amount</Text>
            <AmountInput
              value={amount}
              onChangeText={(t) => { setAmount(t); setErrors((e) => ({ ...e, amount: '' })); }}
              color={primaryColor}
              hasError={!!errors.amount}
              testID="input-amount"
            />
            {errors.amount ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.amount}</Text> : null}
          </Animated.View>

          {/* Date */}
          <Animated.View entering={FadeInDown.delay(150).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Date</Text>
            <TextInput
              style={[styles.textInput, { color: colors.foreground, borderColor: errors.date ? colors.destructive : colors.input, backgroundColor: colors.background, fontFamily: 'Inter_400Regular' }]}
              value={date}
              onChangeText={(t) => { setDate(t); setErrors((e) => ({ ...e, date: '' })); }}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.mutedForeground}
              testID="input-date"
            />
            {errors.date ? <Text style={[styles.errorText, { color: colors.destructive }]}>{errors.date}</Text> : null}
          </Animated.View>

          {/* Category */}
          <Animated.View entering={FadeInDown.delay(200).springify()} style={[styles.fieldCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>Category</Text>
            {errors.category ? <Text style={[styles.errorText, { color: colors.destructive, marginBottom: 8 }]}>{errors.category}</Text> : null}
            <View style={styles.categoryGrid}>
              {categories.map((cat) => {
                const selected = category === cat;
                return (
                  <Pressable
                    key={cat}
                    onPress={() => { Haptics.selectionAsync(); setCategory(cat); setErrors((e) => ({ ...e, category: '' })); }}
                    style={({ pressed }) => [
                      styles.categoryChip,
                      { backgroundColor: selected ? primaryColor : colors.muted, borderColor: selected ? primaryColor : colors.border, opacity: pressed ? 0.8 : 1 },
                    ]}
                    testID={`category-${cat}`}
                  >
                    <Text style={[styles.categoryText, { color: selected ? '#fff' : colors.foreground }]}>{cat}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Animated.View>

          {/* Notes */}
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

        {/* Validation save error (non-toast field errors are still inline) */}

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
              : <Feather
                  name={
                    isSale ? 'trending-up'
                    : isPurchase ? 'shopping-bag'
                    : isStock ? 'archive'
                    : 'trending-down'
                  }
                  size={18}
                  color="#fff"
                  style={{ marginRight: 8 }}
                />
            }
            <Text style={styles.saveBtnText}>
              {saving
                ? 'Saving…'
                : isSale ? 'Save Sale'
                : isPurchase ? 'Save Purchase'
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

      {/* Toast overlay */}
      {toast && <Toast toast={toast} onHide={hideToast} />}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  headerRight: { width: 36 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },

  fieldCard: { borderRadius: 16, padding: 16, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
  fieldLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.6 },
  subLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 2 },

  // 2×2 toggle grid
  toggleGrid: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 12, padding: 4, gap: 3 },
  toggleBtn2: { width: '48.5%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 10, gap: 5 },
  // Keep old single-row toggle style for backward compat (unused now)
  toggleRow: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 3 },
  toggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 9, borderRadius: 10, gap: 5 },
  toggleText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  // Stock sub-toggle
  stockSubRow: { flexDirection: 'row', gap: 8, borderRadius: 12, borderWidth: 1, padding: 6, marginTop: 2 },
  stockSubBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1.5 },
  stockSubText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },

  // Formula reminder
  formulaBox: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, padding: 12 },
  formulaText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', lineHeight: 17 },

  amountRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14 },
  nairaSign: { fontSize: 26, fontFamily: 'Inter_700Bold', marginRight: 4 },
  amountInput: { flex: 1, fontSize: 28, paddingVertical: 12 },

  materialRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  removeBtn: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 0 },

  addMaterialBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 12,
    paddingVertical: 12,
  },
  addMaterialText: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  totalBox: {
    borderRadius: 12, borderWidth: 1, padding: 12, gap: 6, marginTop: 4,
  },
  totalBoxRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalBoxLabel: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  totalBoxValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  totalBoxFinalRow: { paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  totalBoxFinalLabel: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  totalBoxFinalValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },

  markupLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  defaultBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  defaultBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  suggestedPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10,
  },
  suggestedPreviewText: { fontSize: 13, fontFamily: 'Inter_700Bold' },

  textInput: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  notesInput: { height: 80, textAlignVertical: 'top' },

  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  categoryText: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  saveWrap: { marginTop: 8 },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    borderRadius: 16, paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 10, elevation: 6,
  },
  saveBtnText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 },

  // ── Popup ──────────────────────────────────────────────────────────────────
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  popup: {
    width: '100%', borderRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.3, shadowRadius: 28, elevation: 24,
  },
  popupHeader: { padding: 22, alignItems: 'center', gap: 5 },
  popupIconWrap: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  popupIconText: { fontSize: 26, color: '#fff', fontFamily: 'Inter_700Bold' },
  popupTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff', textAlign: 'center' },
  popupSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.7)', textAlign: 'center' },

  popupBody: { borderTopWidth: StyleSheet.hairlineWidth },
  popupRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  popupRowLabel: { fontSize: 13, fontFamily: 'Inter_400Regular', flexShrink: 0 },
  popupRowValue: { fontSize: 14, fontFamily: 'Inter_600SemiBold', textAlign: 'right', flex: 1 },

  markupEditBox: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  markupEditInput: { fontSize: 16, minWidth: 50, textAlign: 'right' },
  markupEditPct: { fontSize: 14, marginLeft: 2 },

  priceBox: { marginHorizontal: 16, marginVertical: 12, borderRadius: 16, padding: 18, alignItems: 'center', gap: 3 },
  priceBoxLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.6 },
  priceBoxAmount: { fontSize: 32, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  priceBoxProfit: { fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },

  popupActions: { paddingHorizontal: 16, paddingBottom: 20, paddingTop: 4, gap: 10 },
  popupBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 14, paddingVertical: 14, gap: 8 },
  popupBtnPrimary: {},
  popupBtnPrimaryText: { color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold' },
  popupBtnOutline: { borderWidth: 1.5 },
  popupBtnOutlineText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  popupSkip: { alignItems: 'center', paddingVertical: 6 },

  // ── Toast ──────────────────────────────────────────────────────────────────
  toast: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 9999,
  },
  toastText: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    lineHeight: 20,
  },
  popupSkipText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
