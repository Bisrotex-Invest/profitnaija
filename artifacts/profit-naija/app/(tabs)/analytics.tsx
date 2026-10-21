import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useEntries } from '@/context/EntriesContext';
import { calcCostForEntries, calcDirectExpensesForEntries, calcNetRevenue, calcStockValue, calcTotalSales, formatDirectExpenseDescription, getSaleValue, isDirectExpenseEntry } from '@/lib/utils/formulas';

function pad(n: number) { return String(n).padStart(2, '0'); }

/** Formats a naira value preserving its sign. */
function fmt(v: number) {
  const abs = Math.abs(v);
  const str = abs.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (v < 0 ? '−' : '') + '₦' + str;
}

export default function AnalyticsScreen() {
  const colors = useColors();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const { entries, products, loading, netProfit, totalCOGS } = useEntries();

  // ── All-time KPIs — net sales revenue recognized when sales are made ─────
  const allTimeSales = useMemo(() => calcTotalSales(entries), [entries]);
  const allTimeRevenue = useMemo(() => calcNetRevenue(entries), [entries]);
  const allTimeCost = totalCOGS;
  const allTimeExpenses = useMemo(() => calcDirectExpensesForEntries(entries), [entries]);
  const allTimeNet       = netProfit;
  const margin           = allTimeRevenue > 0 ? ((allTimeNet / allTimeRevenue) * 100).toFixed(1) : '0';
  const stockValue       = useMemo(
    () => calcStockValue(products, entries),
    [products, entries],
  );

  // ── Last 6-month trend — same formula as report.tsx, labeled pre-tax ─────
  // Per-month PIT diverges from aggregate PIT due to progressive bands, so we
  // plot pre-tax profit and label it "Pre-tax Profit" to avoid misleading users.
  const months = useMemo(() => {
    const now = new Date();
    const ms = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`, label: d.toLocaleDateString('en-NG', { month: 'short' }), revenue: 0, cost: 0, expenses: 0, pretaxProfit: 0 };
    });
    ms.forEach(m => {
      const monthEntries = entries.filter(e => e.date?.startsWith(m.key));
      m.revenue = calcNetRevenue(monthEntries);
      m.cost = calcCostForEntries(monthEntries, products);
      m.expenses = calcDirectExpensesForEntries(monthEntries);
      m.pretaxProfit = m.revenue - m.cost - m.expenses;
    });
    return ms;
  }, [entries, products]);

  const maxForChart = Math.max(...months.map(m => Math.max(m.revenue, Math.abs(m.pretaxProfit))), 1);
  const UPPER_H = 70;
  const LOWER_H = 36;

  // ── Expense breakdown ─────────────────────────────────────────────────────
  const expenseCats = useMemo(() => {
    const cats: Record<string, number> = {};
    entries.filter(isDirectExpenseEntry).forEach(e => {
      const c = formatDirectExpenseDescription(e);
      cats[c] = (cats[c] || 0) + e.amount;
    });
    return Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [entries]);
  const maxCat = Math.max(...expenseCats.map(c => c[1]), 1);

  // ── Top products by Sales ─────────────────────────────────────────────────
  const topProducts = useMemo(() => {
    const prods: Record<string, { name: string; revenue: number; units: number }> = {};
    entries.filter(e => e.type === 'sale' || e.type === 'credit_sale').forEach(e => {
      const name = e.itemName || e.category || e.notes || 'Unnamed';
      if (!prods[name]) prods[name] = { name, revenue: 0, units: 0 };
      prods[name].revenue += getSaleValue(e);
      prods[name].units   += e.unitsSold || 1;
    });
    return Object.values(prods).sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  }, [entries]);
  const maxProd = Math.max(...topProducts.map(p => p.revenue), 1);

  const hasData = entries.length > 0;

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View style={[s.header, { backgroundColor: colors.headerBg, paddingTop: topInset + 16 }]}>
        <Animated.View entering={FadeInUp.springify()}>
          <Text style={s.headerTitle}>Analytics</Text>
          <Text style={s.headerSub}>Business insights across all your data</Text>
        </Animated.View>
      </View>

      {loading ? (
        <View style={s.loader}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : !hasData ? (
        <View style={s.empty}>
          <MaterialCommunityIcons name="chart-line" size={48} color={colors.mutedForeground} />
          <Text style={[s.emptyTitle, { color: colors.foreground }]}>No data yet</Text>
          <Text style={[s.emptySub, { color: colors.mutedForeground }]}>
            Record your first sale or expense to see analytics here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: bottomInset + 100, paddingTop: 16 }} showsVerticalScrollIndicator={false}>

          {/* KPI Grid — uses the same formula as report.tsx */}
          <Animated.View entering={FadeInDown.delay(50).springify()} style={s.kpiGrid}>
            {[
              { label: 'Total Sales',    value: fmt(allTimeSales),    icon: 'trending-up',     color: '#1B7A3E' },
              { label: 'Revenue',        value: fmt(allTimeRevenue),  icon: 'cash-check',      color: '#047857' },
              { label: 'Net Profit',     value: fmt(allTimeNet),      icon: allTimeNet >= 0 ? 'cash-plus' : 'cash-minus', color: allTimeNet >= 0 ? '#1B7A3E' : '#EF4444' },
              { label: 'Profit Margin',  value: `${margin}%`,         icon: 'percent',         color: '#2563EB' },
               { label: 'Cost of Sales',   value: fmt(allTimeCost),     icon: 'cart-outline',    color: '#F59E0B' },
              { label: 'Expenses',       value: fmt(allTimeExpenses), icon: 'receipt',         color: '#EF4444' },
              { label: 'Stock Value',    value: fmt(stockValue),      icon: 'package-variant', color: '#8B5CF6' },
            ].map(({ label, value, icon, color }) => (
              <View key={label} style={[s.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={[s.kpiIcon, { backgroundColor: color + '18' }]}>
                  <MaterialCommunityIcons name={icon as any} size={22} color={color} />
                </View>
                <Text style={[s.kpiLabel, { color: colors.mutedForeground }]}>{label}</Text>
                <Text style={[s.kpiValue, { color: value.startsWith('−') ? '#EF4444' : colors.foreground }]}>{value}</Text>
              </View>
            ))}
          </Animated.View>

          {/* 6-Month Revenue vs Pre-tax Profit — zero-baseline chart */}
          <Animated.View entering={FadeInDown.delay(100).springify()}
            style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <View style={s.cardHeader}>
              <MaterialCommunityIcons name="chart-bar" size={18} color={colors.primary} />
              <Text style={[s.cardTitle, { color: colors.foreground }]}>Monthly Revenue vs Pre-tax Profit</Text>
            </View>

            {/* Upper zone: positive bars grow upward */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: UPPER_H, gap: 4 }}>
              {months.map(m => {
                const revH  = m.revenue > 0 ? Math.max((m.revenue / maxForChart) * (UPPER_H - 4), 6) : 0;
                const profH = m.pretaxProfit > 0 ? Math.max((m.pretaxProfit / maxForChart) * (UPPER_H - 4), 4) : 0;
                return (
                  <View key={m.key} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 1 }}>
                    <View style={{ flex: 1, justifyContent: 'flex-end', height: UPPER_H }}>
                      <View style={{ height: revH, backgroundColor: colors.primary, borderRadius: 3 }} />
                    </View>
                    <View style={{ flex: 1, justifyContent: 'flex-end', height: UPPER_H }}>
                      <View style={{ height: profH, backgroundColor: '#2563EB', borderRadius: 3 }} />
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Zero line */}
            <View style={{ height: 1, backgroundColor: colors.border }} />

            {/* Lower zone: negative profit bars grow downward */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', height: LOWER_H, gap: 4, marginBottom: 4 }}>
              {months.map(m => {
                const lossH = m.pretaxProfit < 0 ? Math.max((Math.abs(m.pretaxProfit) / maxForChart) * (LOWER_H - 4), 4) : 0;
                return (
                  <View key={m.key} style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 1 }}>
                    <View style={{ flex: 1 }} />
                    <View style={{ flex: 1, justifyContent: 'flex-start', height: LOWER_H }}>
                      {lossH > 0 && <View style={{ height: lossH, backgroundColor: '#EF4444', borderRadius: 3 }} />}
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Month labels */}
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {months.map(m => (
                <Text key={m.key} style={[s.barLabel, { flex: 1, textAlign: 'center', color: colors.mutedForeground }]}>{m.label}</Text>
              ))}
            </View>

            <View style={[s.legend, { marginTop: 8 }]}>
              <View style={s.legendItem}><View style={[s.dot, { backgroundColor: colors.primary }]} /><Text style={[s.legendTxt, { color: colors.mutedForeground }]}>Revenue</Text></View>
              <View style={s.legendItem}><View style={[s.dot, { backgroundColor: '#2563EB' }]} /><Text style={[s.legendTxt, { color: colors.mutedForeground }]}>Pre-tax Profit</Text></View>
              <View style={s.legendItem}><View style={[s.dot, { backgroundColor: '#EF4444' }]} /><Text style={[s.legendTxt, { color: colors.mutedForeground }]}>Loss</Text></View>
            </View>
          </Animated.View>

          {/* Expense Breakdown */}
          {expenseCats.length > 0 && (
            <Animated.View entering={FadeInDown.delay(150).springify()}
              style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={s.cardHeader}>
                <MaterialCommunityIcons name="format-list-bulleted" size={18} color={colors.primary} />
                <Text style={[s.cardTitle, { color: colors.foreground }]}>Expense Breakdown</Text>
              </View>
              {expenseCats.map(([cat, val]) => (
                <View key={cat} style={s.catRow}>
                  <Text style={[s.catLabel, { color: colors.foreground }]} numberOfLines={1}>{cat}</Text>
                  <View style={[s.catTrack, { backgroundColor: colors.secondary }]}>
                    <View style={[s.catFill, { width: `${(val / maxCat) * 100}%`, backgroundColor: '#EF4444' }]} />
                  </View>
                  <Text style={[s.catAmt, { color: colors.mutedForeground }]}>{fmt(val)}</Text>
                </View>
              ))}
            </Animated.View>
          )}

          {/* Top Products */}
          {topProducts.length > 0 && (
            <Animated.View entering={FadeInDown.delay(200).springify()}
              style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <View style={s.cardHeader}>
                <MaterialCommunityIcons name="trophy-outline" size={18} color={colors.primary} />
                <Text style={[s.cardTitle, { color: colors.foreground }]}>Top Products by Sales</Text>
              </View>
              {topProducts.map((p, i) => (
                <View key={p.name} style={s.prodRow}>
                  <Text style={[s.prodRank, { color: colors.mutedForeground }]}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.prodName, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
                    <View style={[s.catTrack, { backgroundColor: colors.secondary, marginTop: 4 }]}>
                      <View style={[s.catFill, { width: `${(p.revenue / maxProd) * 100}%`, backgroundColor: colors.primary }]} />
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[s.prodRev, { color: colors.foreground }]}>{fmt(p.revenue)}</Text>
                    <Text style={[s.prodUnits, { color: colors.mutedForeground }]}>{p.units} sold</Text>
                  </View>
                </View>
              ))}
            </Animated.View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header:    { paddingHorizontal: 20, paddingBottom: 20 },
  headerTitle: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.5 },
  headerSub:   { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 3 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:  { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', textAlign: 'center' },
  emptySub:   { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 10, marginBottom: 6 },
  kpiCard: { width: '47%', flexGrow: 1, borderRadius: 16, padding: 14, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  kpiIcon:  { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  kpiLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 3 },
  kpiValue: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  card: { margin: 12, marginTop: 6, borderRadius: 18, padding: 18, borderWidth: StyleSheet.hairlineWidth, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  cardTitle:  { fontSize: 14, fontFamily: 'Inter_600SemiBold', textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 },
  barLabel: { fontSize: 10, fontFamily: 'Inter_500Medium' },
  legend:     { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot:        { width: 8, height: 8, borderRadius: 4 },
  legendTxt:  { fontSize: 12, fontFamily: 'Inter_400Regular' },
  catRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  catLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', width: 90 },
  catTrack: { flex: 1, height: 7, borderRadius: 4, overflow: 'hidden' },
  catFill:  { height: '100%', borderRadius: 4 },
  catAmt:   { fontSize: 11, fontFamily: 'Inter_500Medium', width: 68, textAlign: 'right' },
  prodRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  prodRank:  { fontSize: 14, fontFamily: 'Inter_700Bold', width: 20, textAlign: 'center' },
  prodName:  { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  prodRev:   { fontSize: 13, fontFamily: 'Inter_700Bold' },
  prodUnits: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
});
