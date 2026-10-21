import React, { useState } from 'react';
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
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { useColors } from '@/hooks/useColors';
import { useEntries, Product } from '@/context/EntriesContext';
import { useProfile } from '@/context/ProfileContext';
import {
  Package, X, TrendingUp, AlertCircle, AlertTriangle,
  Plus, Tag, Info, Pencil, Trash2, Printer, Save, Share2,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { calcStockValue } from '@/lib/utils/formulas';
import { extractVATAmount } from '@/lib/utils/price';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';

const NAIRA = '₦';

function fmt(n: number): string {
  return NAIRA + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Industry colours ──────────────────────────────────────────────────────────

const INDUSTRY_COLORS: Record<string, { bg: string; text: string }> = {
  'Food & Groceries':     { bg: '#E8F5E9', text: '#2E7D32' },
  'Fashion & Clothing':   { bg: '#FCE4EC', text: '#C2185B' },
  'Electronics & Phones': { bg: '#E3F2FD', text: '#1565C0' },
  'Cosmetics & Beauty':   { bg: '#F3E5F5', text: '#7B1FA2' },
  'Pharmacy':             { bg: '#FFF8E1', text: '#F57F17' },
  'General Goods':        { bg: '#ECEFF1', text: '#455A64' },
};
function indStyle(industry: string) {
  return INDUSTRY_COLORS[industry] ?? { bg: '#ECEFF1', text: '#455A64' };
}

function safeBusinessName(value: string): string {
  return (value || 'Business').trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'Business';
}

// ── Product Detail Modal ──────────────────────────────────────────────────────

function ProductPdfControls({ product }: { product: Product }) {
  const [working, setWorking] = useState(false);
  const { profile } = useProfile();
  const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char] ?? char));
  const stockValue = product.stockCost ?? product.stockQty * product.costPrice;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(safeBusinessName(profile.businessName))} — ${escapeHtml(product.name)}</title><style>body{font-family:Arial,sans-serif;padding:36px;color:#172033}h1{color:#16723a}.row{padding:10px 0;border-bottom:1px solid #e5e7eb}.label{color:#64748b;display:inline-block;width:48%}</style></head><body><h1>${escapeHtml(profile.businessName || 'Business')}</h1><h2>${escapeHtml(product.name)}</h2><p>Powered by ProfitNaija</p><div class="row"><span class="label">Units available</span>${product.stockQty}</div><div class="row"><span class="label">Cost price</span>${fmt(product.costPrice)}</div><div class="row"><span class="label">Selling price</span>${fmt(product.suggestedPrice)}</div><div class="row"><span class="label">VAT per unit</span>${fmt(extractVATAmount(product.suggestedPrice))}</div><div class="row"><span class="label">Markup</span>${product.markup}%</div><div class="row"><span class="label">Stock value</span>${fmt(stockValue)}</div></body></html>`;
  const makePdf = async () => Print.printToFileAsync({ html });
  const run = async (action: 'print' | 'save' | 'share') => {
    setWorking(true);
    try {
      if (action === 'print') {
        await Print.printAsync({ html });
      } else if (Platform.OS === 'web') {
        // Browsers can print/save as PDF from the native print dialog; sharing
        // falls back to the product summary because Expo Sharing is native-only.
        await Print.printAsync({ html });
      } else {
        const { uri } = await makePdf();
        if (action === 'save') {
          const safeName = product.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'product';
           const destination = `${FileSystem.documentDirectory}${safeBusinessName(profile.businessName)}-${safeName}.pdf`;
          await FileSystem.copyAsync({ from: uri, to: destination });
          const canShare = await Sharing.isAvailableAsync();
          if (!canShare) throw new Error('Saving PDF is not available on this device.');
           await Sharing.shareAsync(destination, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${safeBusinessName(profile.businessName)} — Save product PDF` });
        } else {
          const canShare = await Sharing.isAvailableAsync();
          if (!canShare) throw new Error('Sharing is not available on this device.');
           await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${safeBusinessName(profile.businessName)} — Share ${product.name}` });
        }
      }
    } catch (error: any) {
      Alert.alert('PDF', error?.message ?? 'Could not complete the PDF action.');
    } finally { setWorking(false); }
  };
  return <View style={detailStyles.pdfActions}>
    <Pressable disabled={working} onPress={() => run('print')} style={detailStyles.pdfBtn}><Printer size={15} color="#fff" /><Text style={detailStyles.pdfTxt}>Print</Text></Pressable>
    <Pressable disabled={working} onPress={() => run('save')} style={detailStyles.pdfBtn}><Save size={15} color="#fff" /><Text style={detailStyles.pdfTxt}>{working ? 'Working…' : 'Save PDF'}</Text></Pressable>
    <Pressable disabled={working} onPress={() => run('share')} style={detailStyles.pdfBtn}><Share2 size={15} color="#fff" /><Text style={detailStyles.pdfTxt}>Share</Text></Pressable>
  </View>;
}

function ProductDetailModal({ product, onClose, onEdit, onDelete }: { product: Product; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const colors = useColors();
  const ind = indStyle(product.industry);
  const isOutOfStock = product.stockQty === 0;
  const stockValue = product.stockCost ?? product.stockQty * product.costPrice;
  const profitPerUnit = product.suggestedPrice - product.costPrice;
  const profitPct = product.costPrice > 0 ? (profitPerUnit / product.costPrice) * 100 : 0;

  function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
    return (
      <View style={[detailStyles.row, { borderBottomColor: colors.border }]}>
        <Text style={[detailStyles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[detailStyles.rowValue, { color: valueColor ?? colors.foreground }]}>{value}</Text>
      </View>
    );
  }

  return (
    <Modal transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={detailStyles.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[detailStyles.sheet, { backgroundColor: colors.card }]}>
            {/* Handle */}
            <View style={[detailStyles.handle, { backgroundColor: colors.border }]} />

            {/* Header */}
            <View style={detailStyles.headerRow}>
              <View style={[detailStyles.iconWrap, { backgroundColor: ind.bg }]}>
                <Package size={24} color={ind.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[detailStyles.productName, { color: colors.foreground }]} numberOfLines={2}>
                  {product.name}
                </Text>
                <View style={[detailStyles.industryBadge, { backgroundColor: ind.bg }]}>
                  <Text style={[detailStyles.industryTxt, { color: ind.text }]}>{product.industry}</Text>
                </View>
              </View>
              <Pressable onPress={onClose} style={[detailStyles.closeBtn, { backgroundColor: colors.background }]}>
                <X size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* OUT OF STOCK banner */}
            {isOutOfStock && (
              <View style={detailStyles.outOfStockBanner}>
                <AlertCircle size={16} color="#fff" />
                <Text style={detailStyles.outOfStockBannerTxt}>OUT OF STOCK — Restock soon!</Text>
              </View>
            )}

            {/* Details */}
            <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false}>
              <Row label="Units Available"       value={`${product.stockQty} units`}
                valueColor={isOutOfStock ? '#D32F2F' : colors.foreground} />
              <Row label="Cost Price (per unit)"  value={fmt(product.costPrice)} valueColor={colors.expense} />
              <Row label="Sell Price"             value={fmt(product.suggestedPrice)} valueColor={colors.revenue} />
              <Row label="VAT per Unit"           value={fmt(extractVATAmount(product.suggestedPrice))} valueColor="#E65100" />
              <Row label="Profit per Unit"        value={`${fmt(profitPerUnit)} (+${profitPct.toFixed(1)}%)`} valueColor={colors.revenue} />
              <Row label="Markup"                 value={`${product.markup}%`} />
              <Row label="Stock Value"            value={fmt(stockValue)} valueColor={colors.primary} />
              <Row label="Date Added"             value={product.date} />
            </ScrollView>
            <ProductPdfControls product={product} />

            {/* Actions */}
            <View style={detailStyles.actions}>
              <Pressable
                onPress={() => { onClose(); router.push('/(tabs)/stock'); }}
                style={({ pressed }) => [detailStyles.actionBtn, { backgroundColor: colors.secondary, opacity: pressed ? 0.75 : 1 }]}
              >
                <Plus size={18} color={colors.primary} />
                <Text style={[detailStyles.actionBtnTxt, { color: colors.primary }]}>Manage Stock</Text>
              </Pressable>
              <Pressable onPress={onEdit} style={[detailStyles.actionBtn, { backgroundColor: colors.secondary }]}>
                <Pencil size={18} color={colors.primary} /><Text style={[detailStyles.actionBtnTxt, { color: colors.primary }]}>Edit</Text>
              </Pressable>
              <Pressable onPress={onDelete} style={[detailStyles.actionBtn, { backgroundColor: '#FEE2E2' }]}>
                <Trash2 size={18} color="#B91C1C" /><Text style={[detailStyles.actionBtnTxt, { color: '#B91C1C' }]}>Delete</Text>
              </Pressable>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [detailStyles.actionBtn, { backgroundColor: colors.background, opacity: pressed ? 0.75 : 1 }]}
              >
                <Text style={[detailStyles.actionBtnTxt, { color: colors.mutedForeground }]}>Close</Text>
              </Pressable>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const detailStyles = StyleSheet.create({
  overlay:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:      { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: '88%' },
  handle:     { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  headerRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  iconWrap:   { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  productName:{ fontSize: 18, fontFamily: 'Inter_700Bold', flex: 1, marginBottom: 4 },
  industryBadge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  industryTxt:{ fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  closeBtn:   { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  outOfStockBanner: { backgroundColor: '#D32F2F', borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, marginBottom: 12 },
  outOfStockBannerTxt: { color: '#fff', fontSize: 13, fontFamily: 'Inter_700Bold' },
  row:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel:   { fontSize: 13, fontFamily: 'Inter_400Regular' },
  rowValue:   { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  actions:    { flexDirection: 'row', gap: 8, marginTop: 16 },
  actionBtn:  { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 14 },
  actionBtnTxt: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  pdfActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  pdfBtn: { flex: 1, flexDirection: 'row', gap: 4, justifyContent: 'center', alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: '#16723A' },
  pdfTxt: { color: '#fff', fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});

// ── Product Card ──────────────────────────────────────────────────────────────

function ProductCard({ item, index, onPress }: { item: Product; index: number; onPress: () => void }) {
  const colors   = useColors();
  const ind      = indStyle(item.industry);
  const isOutOfStock = item.stockQty === 0;
  const isLowStock   = item.stockQty > 0 && item.stockQty < 5;
  const profit   = item.suggestedPrice - item.costPrice;
  const profitPct = item.costPrice > 0 ? (profit / item.costPrice) * 100 : 0;

  return (
    <Animated.View entering={FadeInDown.delay(index * 60 + 100).springify()}>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
        style={({ pressed }) => [styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.88 : 1 }]}
      >
        {/* Card header */}
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.productIcon, { backgroundColor: ind.bg }]}>
              <Package size={18} color={ind.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.productName, { color: colors.foreground }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.productDate, { color: colors.mutedForeground }]}>Added {item.date}</Text>
            </View>
          </View>

          {/* Stock badge */}
          {isOutOfStock ? (
            <View style={styles.outOfStockBadge}>
              <Text style={styles.outOfStockTxt}>OUT OF STOCK</Text>
            </View>
          ) : isLowStock ? (
            <View style={styles.lowStockBadge}>
              <Text style={styles.lowStockTxt}>Low: {item.stockQty} left</Text>
            </View>
          ) : (
            <View style={[styles.inStockBadge, { backgroundColor: '#E8F5E9' }]}>
              <Text style={styles.inStockTxt}>{item.stockQty} units</Text>
            </View>
          )}
        </View>

        {/* Industry badge */}
        <View style={[styles.industryBadge, { backgroundColor: ind.bg }]}>
          <Text style={[styles.industryBadgeText, { color: ind.text }]} numberOfLines={1}>
            {item.industry}
          </Text>
        </View>

        {/* Price row */}
        <View style={[styles.priceRow, { borderTopColor: colors.border }]}>
          <View style={styles.priceCol}>
            <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>Cost Price</Text>
            <Text style={[styles.priceValue, { color: colors.expense }]}>{fmt(item.costPrice)}</Text>
          </View>
          <View style={[styles.priceDivider, { backgroundColor: colors.border }]} />
          <View style={styles.priceCol}>
            <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>Sell At</Text>
            <Text style={[styles.priceValue, { color: colors.revenue }]}>{fmt(item.suggestedPrice)}</Text>
          </View>
          <View style={[styles.priceDivider, { backgroundColor: colors.border }]} />
          <View style={styles.priceCol}>
            <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>VAT/unit</Text>
            <Text style={[styles.priceValue, { color: '#E65100', fontSize: 12 }]}>{fmt(extractVATAmount(item.suggestedPrice))}</Text>
          </View>
          <View style={[styles.priceDivider, { backgroundColor: colors.border }]} />
          <View style={styles.priceCol}>
            <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>Markup</Text>
            <View style={[styles.markupBadge, { backgroundColor: colors.revenueBg }]}>
              <Text style={[styles.markupBadgeText, { color: colors.revenue }]}>{item.markup}%</Text>
            </View>
          </View>
        </View>

        {/* Profit bar */}
        <View style={[styles.profitBar, { backgroundColor: colors.revenueBg }]}>
          <TrendingUp size={13} color={colors.revenue} />
          <Text style={[styles.profitBarText, { color: colors.revenue }]}>
            Profit/unit: {fmt(profit)} (+{profitPct.toFixed(1)}%) · Stock value: {fmt(item.stockCost ?? item.stockQty * item.costPrice)}
          </Text>
        </View>

        <View style={{ paddingHorizontal: 14 }}>
          <ProductPdfControls product={item} />
        </View>
        {/* Tap hint */}
        <Text style={[styles.tapHint, { color: colors.mutedForeground }]}>Tap to view details ›</Text>
      </Pressable>
    </Animated.View>
  );
}

function ProductEditModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const colors = useColors();
  const { updateProduct } = useEntries();
  const [name, setName] = useState(product.name);
  const [industry, setIndustry] = useState(product.industry);
  const [costPrice, setCostPrice] = useState(String(product.costPrice));
  const [suggestedPrice, setSuggestedPrice] = useState(String(product.suggestedPrice));
  const [markup, setMarkup] = useState(String(product.markup));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const cost = Number(costPrice);
    const price = Number(suggestedPrice);
    const nextMarkup = Number(markup);
    if (!name.trim() || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(nextMarkup) || nextMarkup < 0) {
      Alert.alert('Check product details', 'Enter a name and valid non-negative prices and markup.');
      return;
    }
    setSaving(true);
    try {
      await updateProduct(product.id, { name: name.trim(), industry: industry.trim(), costPrice: cost, suggestedPrice: price, markup: nextMarkup });
      onClose();
    } catch (error: any) { Alert.alert('Could not update product', error?.message ?? 'Please try again.'); }
    finally { setSaving(false); }
  };
  return <Modal transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
    <Pressable style={detailStyles.overlay} onPress={onClose}><Pressable onPress={() => {}}>
      <View style={[detailStyles.sheet, { backgroundColor: colors.card }]}>
        <Text style={[detailStyles.productName, { color: colors.foreground, marginBottom: 14 }]}>Edit product</Text>
        {([['Name', name, setName, 'default'], ['Industry', industry, setIndustry, 'default'], ['Cost price', costPrice, setCostPrice, 'decimal-pad'], ['Selling price', suggestedPrice, setSuggestedPrice, 'decimal-pad'], ['Markup %', markup, setMarkup, 'decimal-pad']] as const).map(([label, value, setter, keyboard]) =>
          <View key={label} style={{ marginBottom: 10 }}><Text style={[detailStyles.rowLabel, { color: colors.mutedForeground }]}>{label}</Text><TextInput value={value} onChangeText={setter} keyboardType={keyboard} style={[styles.editInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} /></View>)}
        <View style={detailStyles.actions}><Pressable onPress={onClose} style={[detailStyles.actionBtn, { backgroundColor: colors.background }]}><Text style={[detailStyles.actionBtnTxt, { color: colors.mutedForeground }]}>Cancel</Text></Pressable><Pressable disabled={saving} onPress={save} style={[detailStyles.actionBtn, { backgroundColor: colors.primary }]}><Text style={[detailStyles.actionBtnTxt, { color: '#fff' }]}>{saving ? 'Saving…' : 'Save'}</Text></Pressable></View>
      </View>
    </Pressable></Pressable>
  </Modal>;
}

// ── Products Screen ───────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const { products, productsLoading, entries, deleteProduct } = useEntries();

  const [selected, setSelected] = useState<Product | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
  const visibleProducts = products.filter((product) => {
    if (product.archived) return false;
    const matchesSearch = `${product.name} ${product.industry}`.toLowerCase().includes(search.trim().toLowerCase());
    const matchesStock = stockFilter === 'all'
      || (stockFilter === 'out' && product.stockQty <= 0)
      || (stockFilter === 'low' && product.stockQty > 0 && product.stockQty < 5);
    return matchesSearch && matchesStock;
  });

  const topInset    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const activeProducts  = products.filter(p => !p.archived);
  const totalProducts   = activeProducts.length;
  const outOfStockCount = activeProducts.filter(p => p.stockQty === 0).length;
  const avgMarkup = totalProducts > 0
    ? Math.round(activeProducts.reduce((s, p) => s + p.markup, 0) / totalProducts)
    : 0;
  const totalStockValue = calcStockValue(products, entries);
  const confirmDelete = (product: Product) => {
    Alert.alert('Delete product?', `Delete "${product.name}"? Its remaining stock and stock value will be removed, while historical transactions are kept.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteProduct(product.id); setSelected(null); }
        catch (error: any) { Alert.alert('Could not delete product', error?.message ?? 'Please try again.'); }
      } },
    ]);
  };

  const Header = (
    <View>
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: topInset + 16 }]}>
        <Animated.View entering={FadeInUp.springify()}>
          <Text style={styles.headerTitle}>Products</Text>
          <Text style={styles.headerSubtitle}>
            {totalProducts} products · Stock value: {NAIRA}{totalStockValue.toLocaleString('en-NG', { maximumFractionDigits: 0 })}
          </Text>
        </Animated.View>

        {/* Stats strip */}
        {totalProducts > 0 && (
          <Animated.View entering={FadeInDown.delay(80).springify()} style={styles.statsStrip}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalProducts}</Text>
              <Text style={styles.statLabel}>Products</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{avgMarkup}%</Text>
              <Text style={styles.statLabel}>Avg Markup</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, outOfStockCount > 0 && { color: '#EF5350' }]}>
                {outOfStockCount}
              </Text>
              <Text style={styles.statLabel}>Out of Stock</Text>
            </View>
          </Animated.View>
        )}
      </View>

      {/* FAB hint */}
      <View style={[styles.filterPanel, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <TextInput value={search} onChangeText={setSearch} placeholder="Search products…" placeholderTextColor={colors.mutedForeground} style={[styles.searchInput, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.card }]} />
        <View style={styles.filterRow}>
          {(['all','low','out'] as const).map(value => <Pressable key={value} onPress={() => setStockFilter(value)} style={[styles.filterChip, { backgroundColor: stockFilter === value ? colors.primary : colors.card, borderColor: colors.border }]}><Text style={[styles.filterChipText, { color: stockFilter === value ? '#fff' : colors.foreground }]}>{value === 'all' ? 'All' : value === 'low' ? 'Low stock' : 'Out'}</Text></Pressable>)}
        </View>
      </View>
      <View style={[styles.hintRow, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Plus size={14} color={colors.primary} />
        <Text style={[styles.hintTxt, { color: colors.mutedForeground }]}>
          Add a Purchase and tap "Use This Price" to save a product
        </Text>
      </View>

      {outOfStockCount > 0 && (
        <Animated.View entering={FadeInDown.delay(100).springify()}
          style={[styles.outOfStockAlert, { backgroundColor: '#FFEBEE', borderColor: '#EF9A9A' }]}
        >
          <AlertTriangle size={16} color="#D32F2F" />
          <Text style={styles.outOfStockAlertTxt}>
            {outOfStockCount} product{outOfStockCount !== 1 ? 's' : ''} out of stock — tap to restock
          </Text>
        </Animated.View>
      )}
    </View>
  );

  const Empty = productsLoading ? (
    <View style={styles.centerState}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>Loading products…</Text>
    </View>
  ) : (
    <View style={styles.centerState}>
      <Package size={48} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No products yet</Text>
      <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>
        Add a Purchase and tap "Use This Price" to save a product with its suggested selling price.
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={visibleProducts}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => (
          <ProductCard item={item} index={index} onPress={() => setSelected(item)} />
        )}
        ListHeaderComponent={Header}
        ListEmptyComponent={Empty}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />

      {/* Product detail modal */}
      {selected && (
        <ProductDetailModal product={selected} onClose={() => setSelected(null)} onEdit={() => { setEditing(selected); setSelected(null); }} onDelete={() => confirmDelete(selected)} />
      )}
      {editing && <ProductEditModal product={editing} onClose={() => setEditing(null)} />}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container:  { flex: 1 },
  header:     { paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle:    { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 2, marginBottom: 16 },

  statsStrip: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 14, padding: 14, gap: 4 },
  statItem:   { flex: 1, alignItems: 'center', gap: 2 },
  statValue:  { fontSize: 18, fontFamily: 'Inter_700Bold', color: '#fff' },
  statLabel:  { fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)' },
  statDivider:{ width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 },

  hintRow:    { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  hintTxt:    { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  filterPanel: { paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8 },
  searchInput: { height: 42, borderWidth: 1, borderRadius: 11, paddingHorizontal: 13, fontSize: 14, fontFamily: 'Inter_400Regular' },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  outOfStockAlert: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12 },
  outOfStockAlertTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#D32F2F', flex: 1 },

  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 10 },

  card:       { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 14, paddingBottom: 8, gap: 10 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  productIcon:{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  productName:{ fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  productDate:{ fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },

  outOfStockBadge: { backgroundColor: '#D32F2F', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  outOfStockTxt:   { color: '#fff', fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 },
  lowStockBadge:   { backgroundColor: '#FFF3E0', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  lowStockTxt:     { color: '#E65100', fontSize: 10, fontFamily: 'Inter_700Bold' },
  inStockBadge:    { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  inStockTxt:      { color: '#2E7D32', fontSize: 10, fontFamily: 'Inter_700Bold' },

  industryBadge:     { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, marginHorizontal: 14, marginBottom: 10 },
  industryBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium' },

  priceRow:   { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12, paddingHorizontal: 14 },
  priceCol:   { flex: 1, alignItems: 'center', gap: 4 },
  priceDivider: { width: StyleSheet.hairlineWidth, height: 36, marginHorizontal: 4 },
  priceLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', textTransform: 'uppercase', letterSpacing: 0.4 },
  priceValue: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  markupBadge:{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  markupBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold' },

  profitBar:  { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10 },
  profitBarText: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },

  tapHint:    { fontSize: 10, fontFamily: 'Inter_400Regular', textAlign: 'right', paddingRight: 14, paddingBottom: 10 },

  centerState:{ alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 12, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  emptySubtext: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20 },
  editInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 42, marginTop: 4, fontFamily: 'Inter_400Regular' },
});
