import React, { useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
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
import { useEntries, Product, StockMovement } from '@/context/EntriesContext';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

const NAIRA = '₦';
const LOW_STOCK_THRESHOLD = 5;

const INDUSTRY_COLORS: Record<string, { bg: string; text: string }> = {
  'Food & Groceries':     { bg: '#E8F5E9', text: '#2E7D32' },
  'Fashion & Clothing':   { bg: '#FCE4EC', text: '#C2185B' },
  'Electronics & Phones': { bg: '#E3F2FD', text: '#1565C0' },
  'Cosmetics & Beauty':   { bg: '#F3E5F5', text: '#7B1FA2' },
  'Pharmacy':             { bg: '#FFF8E1', text: '#F57F17' },
  'General Goods':        { bg: '#ECEFF1', text: '#455A64' },
};
function industryStyle(ind: string) {
  return INDUSTRY_COLORS[ind] ?? { bg: '#ECEFF1', text: '#455A64' };
}

// ── Stock Adjust Modal ────────────────────────────────────────────────────────
// Cross-platform replacement for Alert.prompt (iOS-only).

interface AdjustModalProps {
  visible: boolean;
  product: Product | null;
  mode: 'add' | 'sell';
  onClose: () => void;
  onConfirm: (qty: number, reason: string, salePrice: number) => void;
}

const ADD_PRESETS  = [1, 5, 10, 50];
const SELL_PRESETS = [1, 5, 10, 20];

function StockAdjustModal({ visible, product, mode, onClose, onConfirm }: AdjustModalProps) {
  const colors = useColors();
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [salePrice, setSalePrice] = useState('');

  if (!product) return null;

  const isAdd   = mode === 'add';
  const accent  = isAdd ? '#1B7A3E' : '#C62828';
  const label   = isAdd ? 'Add Stock' : 'Sell Stock';
  const presets = isAdd ? ADD_PRESETS : SELL_PRESETS;
  const defaultSellPrice = product.suggestedPrice > 0
    ? String(Math.round(product.suggestedPrice))
    : '';

  const handlePreset = (n: number) => {
    Haptics.selectionAsync();
    setQty(String(n));
  };

  const handleConfirm = () => {
    const n = parseInt(qty, 10);
    if (!n || n <= 0) { Alert.alert('Enter a quantity', 'Please enter a valid number of units.'); return; }
    if (!isAdd && n > product.stockQty) {
      Alert.alert('Not enough stock', `Only ${product.stockQty} unit${product.stockQty !== 1 ? 's' : ''} on hand.`);
      return;
    }
    const price = !isAdd ? (parseFloat(salePrice) || product.suggestedPrice || 0) : 0;
    onConfirm(n, reason.trim(), price);
    setQty('');
    setReason('');
    setSalePrice('');
  };

  const handleClose = () => {
    setQty('');
    setReason('');
    setSalePrice('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
      statusBarTranslucent
    >
      <Pressable style={styles.modalOverlay} onPress={handleClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalAvoid}
        >
          <Pressable onPress={() => {}}>
            <View style={[styles.modalSheet, { backgroundColor: colors.card }]}>
              {/* Handle bar */}
              <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />

              {/* Header */}
              <View style={styles.modalHeader}>
                <View>
                  <Text style={[styles.modalTitle, { color: colors.foreground }]}>{label}</Text>
                  <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
                    {product.name} · {product.stockQty} on hand
                  </Text>
                </View>
                <Pressable
                  onPress={handleClose}
                  style={[styles.modalCloseBtn, { backgroundColor: colors.background }]}
                  hitSlop={8}
                >
                  <Feather name="x" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>

              {/* Preset buttons */}
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                QUICK QTY
              </Text>
              <View style={styles.presetRow}>
                {presets.map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => handlePreset(n)}
                    style={({ pressed }) => [
                      styles.presetBtn,
                      {
                        backgroundColor: qty === String(n) ? accent : colors.background,
                        borderColor: qty === String(n) ? accent : colors.border,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <Text style={[
                      styles.presetBtnText,
                      { color: qty === String(n) ? '#fff' : colors.foreground },
                    ]}>
                      {isAdd ? '+' : '−'}{n}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Custom input */}
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                CUSTOM QTY
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder="Enter units…"
                placeholderTextColor={colors.mutedForeground}
                value={qty}
                onChangeText={(v) => setQty(v.replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                returnKeyType="next"
              />

              {/* Sale price (sell mode only) */}
              {!isAdd && (
                <>
                  <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                    SALE PRICE PER UNIT
                  </Text>
                  <View style={[styles.priceInputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={[styles.priceInputSymbol, { color: accent }]}>₦</Text>
                    <TextInput
                      style={[styles.priceInputField, { color: colors.foreground }]}
                      placeholder={defaultSellPrice || '0'}
                      placeholderTextColor={colors.mutedForeground}
                      value={salePrice}
                      onChangeText={(v) => setSalePrice(v.replace(/[^0-9.]/g, ''))}
                      keyboardType="decimal-pad"
                      returnKeyType="next"
                    />
                  </View>
                </>
              )}

              {/* Reason input */}
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                REASON <Text style={{ fontFamily: 'Inter_400Regular' }}>(optional)</Text>
              </Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                placeholder={isAdd ? 'Restocked, new delivery…' : 'Direct sale, damage…'}
                placeholderTextColor={colors.mutedForeground}
                value={reason}
                onChangeText={setReason}
                returnKeyType="done"
                onSubmitEditing={handleConfirm}
              />

              {/* Confirm button */}
              <Pressable
                onPress={handleConfirm}
                style={({ pressed }) => [
                  styles.confirmBtn,
                  { backgroundColor: accent, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <MaterialCommunityIcons
                  name={isAdd ? 'plus-circle-outline' : 'minus-circle-outline'}
                  size={18}
                  color="#fff"
                />
                <Text style={styles.confirmBtnText}>{label}</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ── Movement row ──────────────────────────────────────────────────────────────

function MovementRow({ mov }: { mov: StockMovement }) {
  const colors = useColors();
  const isIn = mov.type === 'IN';
  return (
    <View style={[styles.movRow, { borderBottomColor: colors.border }]}>
      <View style={[styles.movBadge, { backgroundColor: isIn ? '#E8F5E9' : '#FFEBEE' }]}>
        <MaterialCommunityIcons
          name={isIn ? 'arrow-down-circle' : 'arrow-up-circle'}
          size={14}
          color={isIn ? '#2E7D32' : '#C62828'}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.movQty, { color: isIn ? '#2E7D32' : '#C62828' }]}>
          {isIn ? '+' : '−'}{mov.qty} units
          {mov.reason ? <Text style={[styles.movReason, { color: colors.mutedForeground }]}> · {mov.reason}</Text> : null}
        </Text>
        <Text style={[styles.movDate, { color: colors.mutedForeground }]}>{mov.date}</Text>
      </View>
    </View>
  );
}

// ── Stock card ────────────────────────────────────────────────────────────────

function StockCard({
  item,
  index,
  movements,
  onAdd,
  onSell,
}: {
  item: Product;
  index: number;
  movements: StockMovement[];
  onAdd: () => void;
  onSell: () => void;
}) {
  const colors = useColors();
  const [historyOpen, setHistoryOpen] = useState(false);
  const indStyle = industryStyle(item.industry);
  const isLow = item.stockQty > 0 && item.stockQty < LOW_STOCK_THRESHOLD;
  const isOut = item.stockQty <= 0;

  const statusBg    = isOut  ? '#FFEBEE' : isLow  ? '#FFF8E1' : '#E8F5E9';
  const statusText  = isOut  ? '#C62828' : isLow  ? '#F57F17' : '#2E7D32';
  const statusLabel = isOut  ? 'Out of stock' : isLow ? 'Low stock' : 'In stock';

  const productMoves = movements.filter((m) => m.productId === item.id).slice(0, 8);

  return (
    <Animated.View entering={FadeInDown.delay(index * 60 + 100).springify()}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>

        {/* ── Top: name + status ── */}
        <View style={styles.cardTop}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.productIcon, { backgroundColor: indStyle.bg }]}>
              <MaterialCommunityIcons name="package-variant-closed" size={18} color={indStyle.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.productName, { color: colors.foreground }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={[styles.industryBadge, { backgroundColor: indStyle.bg }]}>
                <Text style={[styles.industryBadgeText, { color: indStyle.text }]} numberOfLines={1}>
                  {item.industry}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.statusBadge, { backgroundColor: statusBg }]}>
            {(isLow || isOut) && (
              <Feather
                name={isOut ? 'alert-octagon' : 'alert-triangle'}
                size={11}
                color={statusText}
                style={{ marginRight: 3 }}
              />
            )}
            <Text style={[styles.statusText, { color: statusText }]}>{statusLabel}</Text>
          </View>
        </View>

        {/* ── Stats row ── */}
        <View style={[styles.qtyRow, { borderTopColor: colors.border, borderBottomColor: colors.border }]}>
          <View style={styles.qtyBlock}>
            <Text style={[styles.qtyLabel, { color: colors.mutedForeground }]}>ON HAND</Text>
            <Text style={[styles.qtyValue, { color: isOut ? '#C62828' : isLow ? '#F57F17' : colors.foreground }]}>
              {item.stockQty}
            </Text>
          </View>
          <View style={[styles.qtyDivider, { backgroundColor: colors.border }]} />
          <View style={styles.qtyBlock}>
            <Text style={[styles.qtyLabel, { color: colors.mutedForeground }]}>COST</Text>
            <Text style={[styles.qtyValue, { color: colors.foreground }]}>
              {NAIRA}{item.costPrice.toLocaleString('en-NG', { maximumFractionDigits: 0 })}
            </Text>
          </View>
          <View style={[styles.qtyDivider, { backgroundColor: colors.border }]} />
          <View style={styles.qtyBlock}>
            <Text style={[styles.qtyLabel, { color: colors.mutedForeground }]}>SELL</Text>
            <Text style={[styles.qtyValue, { color: colors.revenue }]}>
              {NAIRA}{item.suggestedPrice.toLocaleString('en-NG', { maximumFractionDigits: 0 })}
            </Text>
          </View>
          <View style={[styles.qtyDivider, { backgroundColor: colors.border }]} />
          <View style={styles.qtyBlock}>
            <Text style={[styles.qtyLabel, { color: colors.mutedForeground }]}>VALUE</Text>
            <Text style={[styles.qtyValue, { color: colors.primary }]}>
              {NAIRA}{(item.stockQty * item.costPrice).toLocaleString('en-NG', { maximumFractionDigits: 0 })}
            </Text>
          </View>
        </View>

        {/* ── Actions ── */}
        <View style={styles.actions}>
          <Pressable
            onPress={onAdd}
            style={({ pressed }) => [styles.actionBtn, styles.addBtn, { opacity: pressed ? 0.8 : 1 }]}
          >
            <MaterialCommunityIcons name="plus-circle-outline" size={16} color="#fff" />
            <Text style={styles.addBtnText}>Add Stock</Text>
          </Pressable>
          <Pressable
            onPress={onSell}
            disabled={isOut}
            style={({ pressed }) => [
              styles.actionBtn,
              styles.sellBtn,
              { opacity: isOut ? 0.35 : pressed ? 0.75 : 1, borderColor: colors.expense + '66' },
            ]}
          >
            <MaterialCommunityIcons name="minus-circle-outline" size={16} color={colors.expense} />
            <Text style={[styles.sellBtnText, { color: colors.expense }]}>Sell</Text>
          </Pressable>

          {/* History toggle */}
          {productMoves.length > 0 && (
            <Pressable
              onPress={() => { Haptics.selectionAsync(); setHistoryOpen((v) => !v); }}
              style={({ pressed }) => [
                styles.historyToggle,
                { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <MaterialCommunityIcons
                name={historyOpen ? 'history' : 'history'}
                size={15}
                color={colors.mutedForeground}
              />
              <Text style={[styles.historyToggleText, { color: colors.mutedForeground }]}>
                {productMoves.length}
              </Text>
            </Pressable>
          )}
        </View>

        {/* ── History ── */}
        {historyOpen && productMoves.length > 0 && (
          <View style={[styles.historySection, { borderTopColor: colors.border }]}>
            <Text style={[styles.historyTitle, { color: colors.mutedForeground }]}>
              MOVEMENT HISTORY
            </Text>
            {productMoves.map((mov) => (
              <MovementRow key={mov.id} mov={mov} />
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ── Stock Screen ───────────────────────────────────────────────────────────────

export default function StockScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    products, productsLoading,
    stockMovements,
    addStockMovement,
    addEntry,
  } = useEntries();

  const topInset    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  // Modal state
  const [modalProduct, setModalProduct] = useState<Product | null>(null);
  const [modalMode, setModalMode]       = useState<'add' | 'sell'>('add');
  const [saving, setSaving]             = useState(false);

  // Summary stats
  const totalUnits    = products.reduce((s, p) => s + p.stockQty, 0);
  const totalValue    = products.reduce((s, p) => s + p.stockQty * p.costPrice, 0);
  const lowStockCount = products.filter((p) => p.stockQty > 0 && p.stockQty < LOW_STOCK_THRESHOLD).length;
  const outOfStock    = products.filter((p) => p.stockQty <= 0).length;

  const openModal = (product: Product, mode: 'add' | 'sell') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setModalProduct(product);
    setModalMode(mode);
  };

  const handleConfirm = async (qty: number, reason: string, salePrice: number) => {
    if (!modalProduct) return;
    setSaving(true);
    const p = modalProduct;
    const isSell = modalMode === 'sell';
    setModalProduct(null); // close modal immediately for responsiveness
    try {
      await addStockMovement(p.id, p.name, qty, isSell ? 'OUT' : 'IN', reason);
      // For sells: create a sale entry so Revenue & Net Profit update on the dashboard
      if (isSell && salePrice > 0) {
        const d = new Date();
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        await addEntry({
          type: 'sale',
          amount: qty * salePrice,
          cogsAmount: qty * p.costPrice,  // COGS tracked per sale for Net Profit
          category: 'Retail',
          notes: `${qty} × ${p.name}`,
          date: dateStr,
        });
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('Failed to update stock', e?.message ?? 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  // ── Header ──────────────────────────────────────────────────────────────────

  const Header = (
    <View>
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: topInset + 16 }]}>
        <Animated.View entering={FadeInUp.springify()}>
          <Text style={styles.headerTitle}>Stock</Text>
          <Text style={styles.headerSubtitle}>Tap + to add a product · manage stock below</Text>
        </Animated.View>

        {products.length > 0 && (
          <Animated.View entering={FadeInDown.delay(80).springify()} style={styles.statsStrip}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalUnits}</Text>
              <Text style={styles.statLabel}>Total Units</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {NAIRA}{totalValue.toLocaleString('en-NG', { maximumFractionDigits: 0 })}
              </Text>
              <Text style={styles.statLabel}>Cost Value</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, lowStockCount > 0 && { color: '#FFD54F' }]}>
                {lowStockCount}
              </Text>
              <Text style={styles.statLabel}>Low Stock</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, outOfStock > 0 && { color: '#EF9A9A' }]}>
                {outOfStock}
              </Text>
              <Text style={styles.statLabel}>Out of Stock</Text>
            </View>
          </Animated.View>
        )}
      </View>

      {/* Alert banner */}
      {(lowStockCount > 0 || outOfStock > 0) && (
        <Animated.View
          entering={FadeInDown.delay(160).springify()}
          style={[styles.alertBanner, { backgroundColor: '#FFF8E1', borderColor: '#FFB300' + '55' }]}
        >
          <Feather name="alert-triangle" size={15} color="#F57F17" />
          <Text style={styles.alertText}>
            {outOfStock > 0 && `${outOfStock} product${outOfStock > 1 ? 's' : ''} out of stock`}
            {outOfStock > 0 && lowStockCount > 0 && ' · '}
            {lowStockCount > 0 && `${lowStockCount} running low (< ${LOW_STOCK_THRESHOLD} units)`}
          </Text>
        </Animated.View>
      )}
    </View>
  );

  const Empty = productsLoading ? (
    <View style={styles.centerState}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>Loading stock…</Text>
    </View>
  ) : (
    <View style={styles.centerState}>
      <MaterialCommunityIcons name="warehouse" size={52} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No products yet</Text>
      <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>
        Add a Purchase on the Dashboard and tap "Use This Price" to save a product — it will appear here.
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {saving && (
        <View style={styles.savingOverlay}>
          <ActivityIndicator color={colors.primary} size="small" />
          <Text style={[styles.savingText, { color: colors.foreground }]}>Updating…</Text>
        </View>
      )}

      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <StockCard
            item={item}
            index={index}
            movements={stockMovements}
            onAdd={() => openModal(item, 'add')}
            onSell={() => openModal(item, 'sell')}
          />
        )}
        ListHeaderComponent={Header}
        ListEmptyComponent={Empty}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />

      {/* Add Product FAB */}
      <Animated.View
        entering={FadeInUp.delay(400).springify()}
        style={[styles.fab, { backgroundColor: colors.primary, bottom: bottomInset + 24 }]}
      >
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/add-entry'); }}
          style={styles.fabInner}
          testID="fab-add-product"
        >
          <Feather name="plus" size={26} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      <StockAdjustModal
        visible={!!modalProduct}
        product={modalProduct}
        mode={modalMode}
        onClose={() => setModalProduct(null)}
        onConfirm={handleConfirm}
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // ── Header ──
  header: { paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 2, marginBottom: 16 },
  statsStrip: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 4,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 15, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)' },
  statDivider: { width: 1, height: '80%', backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' },

  alertBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth,
  },
  alertText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#E65100', lineHeight: 17 },

  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16 },

  // ── Card ──
  card: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardTop: { padding: 14, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, flex: 1, marginRight: 8 },
  productIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  productName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 4 },
  industryBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  industryBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, flexShrink: 0 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  qtyRow: {
    flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12,
  },
  qtyBlock: { flex: 1, alignItems: 'center', gap: 4 },
  qtyDivider: { width: 1, marginVertical: 4 },
  qtyLabel: { fontSize: 9, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  qtyValue: { fontSize: 14, fontFamily: 'Inter_700Bold' },

  actions: { flexDirection: 'row', gap: 8, padding: 12 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, borderRadius: 10,
  },
  addBtn: { backgroundColor: '#1B7A3E' },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  sellBtn: { backgroundColor: 'transparent', borderWidth: 1.5 },
  sellBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  historyToggle: {
    width: 38, height: 38, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    flexDirection: 'column', gap: 1,
  },
  historyToggleText: { fontSize: 9, fontFamily: 'Inter_600SemiBold' },

  // ── History ──
  historySection: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingBottom: 6, paddingTop: 10 },
  historyTitle: { fontSize: 9, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.6, marginBottom: 8 },
  movRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  movBadge: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 },
  movQty: { fontSize: 13, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },
  movReason: { fontSize: 12, fontFamily: 'Inter_400Regular' },
  movDate: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },

  // ── Saving overlay ──
  savingOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.55)', flexDirection: 'row', gap: 8,
  },
  savingText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  // ── Empty state ──
  centerState: { alignItems: 'center', paddingTop: 60, gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginTop: 8 },
  emptySubtext: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },

  // ── Modal ──
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
  },
  modalAvoid: { width: '100%' },
  modalSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  modalTitle: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  modalSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 2 },
  modalCloseBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.6, marginBottom: 8 },
  presetRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  presetBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10,
    alignItems: 'center', borderWidth: 1.5,
  },
  presetBtnText: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  input: {
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, fontFamily: 'Inter_400Regular', marginBottom: 16,
  },
  confirmBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 14, marginTop: 4,
  },
  confirmBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  // ── Sale price input ──
  priceInputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, marginBottom: 16,
  },
  priceInputSymbol: { fontSize: 22, fontFamily: 'Inter_700Bold', marginRight: 4 },
  priceInputField: { flex: 1, fontSize: 22, fontFamily: 'Inter_700Bold', paddingVertical: 12 },

  // ── Add Product FAB ──
  fab: {
    position: 'absolute', right: 24, width: 60, height: 60, borderRadius: 30,
    shadowColor: '#1B7A3E', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  fabInner: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
});
