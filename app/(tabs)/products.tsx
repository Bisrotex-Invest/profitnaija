import React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useEntries, Product } from '@/context/EntriesContext';
import { MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

const NAIRA = '₦';

function fmt(n: number): string {
  return NAIRA + n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Industry color map ────────────────────────────────────────────────────────

const INDUSTRY_COLORS: Record<string, { bg: string; text: string }> = {
  'Food & Groceries':     { bg: '#E8F5E9', text: '#2E7D32' },
  'Fashion & Clothing':   { bg: '#FCE4EC', text: '#C2185B' },
  'Electronics & Phones': { bg: '#E3F2FD', text: '#1565C0' },
  'Cosmetics & Beauty':   { bg: '#F3E5F5', text: '#7B1FA2' },
  'Pharmacy':             { bg: '#FFF8E1', text: '#F57F17' },
  'General Goods':        { bg: '#ECEFF1', text: '#455A64' },
};

function industryStyle(industry: string) {
  return INDUSTRY_COLORS[industry] ?? { bg: '#ECEFF1', text: '#455A64' };
}

// ── Product Card ──────────────────────────────────────────────────────────────

function ProductCard({ item, index }: { item: Product; index: number }) {
  const colors = useColors();
  const indStyle = industryStyle(item.industry);
  const profit = item.suggestedPrice - item.costPrice;
  const profitPct = item.costPrice > 0 ? (profit / item.costPrice) * 100 : 0;

  return (
    <Animated.View entering={FadeInDown.delay(index * 60 + 100).springify()}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Card header row */}
        <View style={styles.cardHeader}>
          <View style={styles.cardTitleRow}>
            <View style={[styles.productIcon, { backgroundColor: indStyle.bg }]}>
              <MaterialCommunityIcons name="package-variant-closed" size={18} color={indStyle.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.productName, { color: colors.foreground }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.productDate, { color: colors.mutedForeground }]}>
                {item.date}
              </Text>
            </View>
          </View>
          {/* Industry badge */}
          <View style={[styles.industryBadge, { backgroundColor: indStyle.bg }]}>
            <Text style={[styles.industryBadgeText, { color: indStyle.text }]} numberOfLines={1}>
              {item.industry}
            </Text>
          </View>
        </View>

        {/* Price comparison */}
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
            <Text style={[styles.priceLabel, { color: colors.mutedForeground }]}>Markup</Text>
            <View style={[styles.markupBadge, { backgroundColor: colors.revenueBg }]}>
              <Text style={[styles.markupBadgeText, { color: colors.revenue }]}>
                {item.markup}%
              </Text>
            </View>
          </View>
        </View>

        {/* Profit per unit */}
        <View style={[styles.profitBar, { backgroundColor: colors.revenueBg }]}>
          <Feather name="trending-up" size={13} color={colors.revenue} />
          <Text style={[styles.profitBarText, { color: colors.revenue }]}>
            Profit per unit: {fmt(profit)} (+{profitPct.toFixed(1)}%)
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

// ── Products Screen ───────────────────────────────────────────────────────────

export default function ProductsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { products, productsLoading } = useEntries();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const totalProducts = products.length;
  const avgMarkup = totalProducts > 0
    ? Math.round(products.reduce((s, p) => s + p.markup, 0) / totalProducts)
    : 0;

  // ── Summary strip ──────────────────────────────────────────────────────────

  const Header = (
    <View>
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: topInset + 16 }]}>
        <Animated.View entering={FadeInUp.springify()}>
          <Text style={styles.headerTitle}>Products</Text>
          <Text style={styles.headerSubtitle}>Cost Price vs Suggested Selling Price</Text>
        </Animated.View>

        {/* Stats strip */}
        {totalProducts > 0 && (
          <Animated.View
            entering={FadeInDown.delay(80).springify()}
            style={styles.statsStrip}
          >
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalProducts}</Text>
              <Text style={styles.statLabel}>Products</Text>
            </View>
            <View style={[styles.statDivider]} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{avgMarkup}%</Text>
              <Text style={styles.statLabel}>Avg Markup</Text>
            </View>
            <View style={[styles.statDivider]} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {NAIRA}{(products.reduce((s, p) => s + p.costPrice, 0)).toLocaleString('en-NG', { maximumFractionDigits: 0 })}
              </Text>
              <Text style={styles.statLabel}>Total Cost</Text>
            </View>
          </Animated.View>
        )}
      </View>
    </View>
  );

  const Empty = productsLoading ? (
    <View style={styles.centerState}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>Loading products…</Text>
    </View>
  ) : (
    <View style={styles.centerState}>
      <MaterialCommunityIcons name="package-variant-closed" size={48} color={colors.mutedForeground} />
      <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No products yet</Text>
      <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>
        Add a Purchase and tap "Use This Price" to save a product with its suggested selling price.
      </Text>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => <ProductCard item={item} index={index} />}
        ListHeaderComponent={Header}
        ListEmptyComponent={Empty}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 2, marginBottom: 16 },
  statsStrip: {
    flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, paddingVertical: 12, paddingHorizontal: 4,
  },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#FFFFFF' },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)' },
  statDivider: { width: 1, height: '80%', backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center' },
  listContent: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 16 },
  card: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05, shadowRadius: 6, elevation: 2,
  },
  cardHeader: { padding: 14, gap: 8 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  productIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  productName: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  productDate: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  industryBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  industryBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  priceRow: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  priceCol: { flex: 1, alignItems: 'center', gap: 4 },
  priceLabel: { fontSize: 10, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.4 },
  priceValue: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  priceDivider: { width: 1, marginVertical: 4 },
  markupBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  markupBadgeText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  profitBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  profitBarText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  centerState: { alignItems: 'center', paddingTop: 60, gap: 10, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', marginTop: 8 },
  emptySubtext: { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },
});
