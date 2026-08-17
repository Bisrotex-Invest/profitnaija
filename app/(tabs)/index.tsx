import React, { useState, useMemo } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useEntries, Entry, Product } from '@/context/EntriesContext';
import { useAuth } from '@/context/AuthContext';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';

// ── Constants & helpers ───────────────────────────────────────────────────────

const NAIRA = '₦';
type Period = 'all' | 'daily' | 'weekly' | 'monthly';

const PERIOD_OPTIONS: { key: Period; label: string }[] = [
  { key: 'all',     label: 'All'   },
  { key: 'daily',   label: 'Today' },
  { key: 'weekly',  label: 'Week'  },
  { key: 'monthly', label: 'Month' },
];

function fmt(n: number): string {
  return NAIRA + n.toLocaleString('en-NG');
}
const formatAmount = fmt;

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-NG', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch { return dateStr; }
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function filterByPeriod(items: Entry[], period: Period): Entry[] {
  if (period === 'all') return items;
  const now = new Date();
  if (period === 'daily') return items.filter(e => e.date === todayStr());
  const cutoff = period === 'weekly'
    ? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  return items.filter(e => e.date >= cutoff);
}

// ── Shared modal styles ───────────────────────────────────────────────────────

const ms = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet:        { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: '88%' },
  handle:       { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  headerRow:    { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  iconWrap:     { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  titleCol:     { flex: 1 },
  title:        { fontSize: 18, fontFamily: 'Inter_700Bold' },
  totalValue:   { fontSize: 22, fontFamily: 'Inter_700Bold', marginTop: 2 },
  closeX:       { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  listRow:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  listMain:     { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  listSub:      { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  listDate:     { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 },
  listAmt:      { fontSize: 15, fontFamily: 'Inter_700Bold', marginLeft: 8, flexShrink: 0 },
  emptyTxt:     { textAlign: 'center', paddingVertical: 32, fontFamily: 'Inter_400Regular', fontSize: 13 },
  closeBtn:     { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  closeBtnTxt:  { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  periodBar:    { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 3, marginBottom: 12 },
  periodBtn:    { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },
  periodBtnTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
});

// ── PeriodBar ─────────────────────────────────────────────────────────────────

function PeriodBar({ value, onChange, activeColor }: {
  value: Period; onChange: (p: Period) => void; activeColor: string;
}) {
  const colors = useColors();
  return (
    <View style={[ms.periodBar, { backgroundColor: colors.muted }]}>
      {PERIOD_OPTIONS.map(p => {
        const active = value === p.key;
        return (
          <Pressable
            key={p.key}
            onPress={() => { Haptics.selectionAsync(); onChange(p.key); }}
            style={[ms.periodBtn, active && { backgroundColor: activeColor }]}
          >
            <Text style={[ms.periodBtnTxt, { color: active ? '#fff' : colors.mutedForeground }]}>
              {p.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Revenue Detail Modal ──────────────────────────────────────────────────────

function RevenueDetailModal({ visible, onClose, entries }: {
  visible: boolean; onClose: () => void; entries: Entry[];
}) {
  const colors = useColors();
  const [period, setPeriod] = useState<Period>('all');
  const sales    = useMemo(() => entries.filter(e => e.type === 'sale'), [entries]);
  const filtered = useMemo(() => filterByPeriod(sales, period), [sales, period]);
  const total    = filtered.reduce((s, e) => s + e.amount, 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={ms.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[ms.sheet, { backgroundColor: colors.card }]}>
            <View style={[ms.handle, { backgroundColor: colors.border }]} />
            <View style={ms.headerRow}>
              <View style={[ms.iconWrap, { backgroundColor: colors.revenueBg }]}>
                <MaterialCommunityIcons name="cash-multiple" size={20} color={colors.revenue} />
              </View>
              <View style={ms.titleCol}>
                <Text style={[ms.title, { color: colors.foreground }]}>Revenue</Text>
                <Text style={[ms.totalValue, { color: colors.revenue }]}>{fmt(total)}</Text>
              </View>
              <Pressable onPress={onClose} style={[ms.closeX, { backgroundColor: colors.background }]}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <PeriodBar value={period} onChange={setPeriod} activeColor={colors.revenue} />
            <FlatList
              data={filtered}
              keyExtractor={e => e.id}
              style={{ flexShrink: 1 }}
              renderItem={({ item }) => (
                <View style={[ms.listRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[ms.listMain, { color: colors.foreground }]} numberOfLines={1}>
                      {item.notes || item.category || 'Sale'}
                    </Text>
                    <Text style={[ms.listDate, { color: colors.mutedForeground }]}>{formatDate(item.date)}</Text>
                  </View>
                  <Text style={[ms.listAmt, { color: colors.revenue }]}>+{fmt(item.amount)}</Text>
                </View>
              )}
              ListEmptyComponent={<Text style={[ms.emptyTxt, { color: colors.mutedForeground }]}>No sales in this period</Text>}
            />
            <Pressable onPress={onClose} style={({ pressed }) => [ms.closeBtn, { backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[ms.closeBtnTxt, { color: colors.foreground }]}>Close</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Expenses Detail Modal ─────────────────────────────────────────────────────

function ExpensesDetailModal({ visible, onClose, entries }: {
  visible: boolean; onClose: () => void; entries: Entry[];
}) {
  const colors = useColors();
  const [period, setPeriod] = useState<Period>('all');
  const expenses = useMemo(() => entries.filter(e => e.type === 'expense'), [entries]);
  const filtered = useMemo(() => filterByPeriod(expenses, period), [expenses, period]);
  const total    = filtered.reduce((s, e) => s + e.amount, 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={ms.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[ms.sheet, { backgroundColor: colors.card }]}>
            <View style={[ms.handle, { backgroundColor: colors.border }]} />
            <View style={ms.headerRow}>
              <View style={[ms.iconWrap, { backgroundColor: colors.expenseBg }]}>
                <MaterialCommunityIcons name="minus-circle-outline" size={20} color={colors.expense} />
              </View>
              <View style={ms.titleCol}>
                <Text style={[ms.title, { color: colors.foreground }]}>Total Expenses</Text>
                <Text style={[ms.totalValue, { color: colors.expense }]}>{fmt(total)}</Text>
              </View>
              <Pressable onPress={onClose} style={[ms.closeX, { backgroundColor: colors.background }]}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <PeriodBar value={period} onChange={setPeriod} activeColor={colors.expense} />
            <FlatList
              data={filtered}
              keyExtractor={e => e.id}
              style={{ flexShrink: 1 }}
              renderItem={({ item }) => (
                <View style={[ms.listRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[ms.listMain, { color: colors.foreground }]} numberOfLines={1}>
                      {item.category || 'Expense'}
                    </Text>
                    {item.notes ? (
                      <Text style={[ms.listSub, { color: colors.mutedForeground }]} numberOfLines={1}>{item.notes}</Text>
                    ) : null}
                    <Text style={[ms.listDate, { color: colors.mutedForeground }]}>{formatDate(item.date)}</Text>
                  </View>
                  <Text style={[ms.listAmt, { color: colors.expense }]}>−{fmt(item.amount)}</Text>
                </View>
              )}
              ListEmptyComponent={<Text style={[ms.emptyTxt, { color: colors.mutedForeground }]}>No expenses in this period</Text>}
            />
            <Pressable onPress={onClose} style={({ pressed }) => [ms.closeBtn, { backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[ms.closeBtnTxt, { color: colors.foreground }]}>Close</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Cost (COGS) Detail Modal ──────────────────────────────────────────────────

function CostDetailModal({ visible, onClose, entries }: {
  visible: boolean; onClose: () => void; entries: Entry[];
}) {
  const colors = useColors();
  const [period, setPeriod] = useState<Period>('all');
  const sales    = useMemo(() => entries.filter(e => e.type === 'sale' && (e.cogsAmount ?? 0) > 0), [entries]);
  const filtered = useMemo(() => filterByPeriod(sales, period), [sales, period]);
  const total    = filtered.reduce((s, e) => s + (e.cogsAmount ?? 0), 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={ms.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[ms.sheet, { backgroundColor: colors.card }]}>
            <View style={[ms.handle, { backgroundColor: colors.border }]} />
            <View style={ms.headerRow}>
              <View style={[ms.iconWrap, { backgroundColor: '#FFF3E0' }]}>
                <MaterialCommunityIcons name="shopping" size={20} color="#E65100" />
              </View>
              <View style={ms.titleCol}>
                <Text style={[ms.title, { color: colors.foreground }]}>Cost of Goods Sold</Text>
                <Text style={[ms.totalValue, { color: '#E65100' }]}>{fmt(total)}</Text>
              </View>
              <Pressable onPress={onClose} style={[ms.closeX, { backgroundColor: colors.background }]}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <PeriodBar value={period} onChange={setPeriod} activeColor="#E65100" />
            <FlatList
              data={filtered}
              keyExtractor={e => e.id}
              style={{ flexShrink: 1 }}
              renderItem={({ item }) => (
                <View style={[ms.listRow, { borderBottomColor: colors.border }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[ms.listMain, { color: colors.foreground }]} numberOfLines={1}>
                      {item.notes || item.category || 'Sale'}
                    </Text>
                    <Text style={[ms.listDate, { color: colors.mutedForeground }]}>{formatDate(item.date)}</Text>
                  </View>
                  <Text style={[ms.listAmt, { color: '#E65100' }]}>−{fmt(item.cogsAmount ?? 0)}</Text>
                </View>
              )}
              ListEmptyComponent={<Text style={[ms.emptyTxt, { color: colors.mutedForeground }]}>No cost recorded in this period</Text>}
            />
            <Pressable onPress={onClose} style={({ pressed }) => [ms.closeBtn, { backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[ms.closeBtnTxt, { color: colors.foreground }]}>Close</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Stock Value Detail Modal ──────────────────────────────────────────────────

function StockValueDetailModal({ visible, onClose, products }: {
  visible: boolean; onClose: () => void; products: Product[];
}) {
  const colors = useColors();
  const totalValue = products.reduce((s, p) => s + p.stockQty * p.costPrice, 0);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={ms.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[ms.sheet, { backgroundColor: colors.card }]}>
            <View style={[ms.handle, { backgroundColor: colors.border }]} />
            <View style={ms.headerRow}>
              <View style={[ms.iconWrap, { backgroundColor: colors.secondary }]}>
                <MaterialCommunityIcons name="warehouse" size={20} color={colors.primary} />
              </View>
              <View style={ms.titleCol}>
                <Text style={[ms.title, { color: colors.foreground }]}>Stock Value</Text>
                <Text style={[ms.totalValue, { color: colors.primary }]}>{fmt(totalValue)}</Text>
              </View>
              <Pressable onPress={onClose} style={[ms.closeX, { backgroundColor: colors.background }]}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>

            {/* Formula */}
            <View style={[svStyles.formula, { backgroundColor: colors.secondary }]}>
              <Text style={[svStyles.formulaTxt, { color: colors.primary }]}>
                Σ (Qty on hand × Cost price per unit) for all products
              </Text>
            </View>

            <FlatList
              data={products}
              keyExtractor={p => p.id}
              style={{ flexShrink: 1 }}
              renderItem={({ item: p }) => {
                const val = p.stockQty * p.costPrice;
                return (
                  <View style={[ms.listRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={[ms.listMain, { color: colors.foreground }]} numberOfLines={1}>{p.name}</Text>
                      <Text style={[ms.listSub, { color: colors.mutedForeground }]}>
                        {p.stockQty} units × {fmt(p.costPrice)}
                      </Text>
                    </View>
                    <Text style={[ms.listAmt, { color: val > 0 ? colors.primary : colors.mutedForeground }]}>
                      {fmt(val)}
                    </Text>
                  </View>
                );
              }}
              ListEmptyComponent={
                <Text style={[ms.emptyTxt, { color: colors.mutedForeground }]}>
                  No products yet. Add a purchase to get started.
                </Text>
              }
            />
            <Pressable onPress={onClose} style={({ pressed }) => [ms.closeBtn, { backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[ms.closeBtnTxt, { color: colors.foreground }]}>Close</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const svStyles = StyleSheet.create({
  formula:    { borderRadius: 12, padding: 12, marginBottom: 12 },
  formulaTxt: { fontSize: 12, fontFamily: 'Inter_500Medium', textAlign: 'center' },
});

// ── Profit Breakdown Modal ────────────────────────────────────────────────────

function ProfitBreakdownModal({ visible, onClose, entries }: {
  visible: boolean; onClose: () => void; entries: Entry[];
}) {
  const colors = useColors();
  const [period, setPeriod] = useState<Period>('all');

  const filteredSales    = useMemo(() => filterByPeriod(entries.filter(e => e.type === 'sale'),    period), [entries, period]);
  const filteredExpenses = useMemo(() => filterByPeriod(entries.filter(e => e.type === 'expense'), period), [entries, period]);

  const pRevenue  = filteredSales.reduce((s, e) => s + e.amount, 0);
  const pCOGS     = filteredSales.reduce((s, e) => s + (e.cogsAmount ?? 0), 0);
  const pExpenses = filteredExpenses.reduce((s, e) => s + e.amount, 0);
  const pProfit   = pRevenue - pCOGS - pExpenses;
  const isProfit  = pProfit >= 0;

  function BRow({ label, value, color }: { label: string; value: string; color: string }) {
    return (
      <View style={[pbStyles.row, { borderBottomColor: colors.border }]}>
        <Text style={[pbStyles.rowLbl, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[pbStyles.rowVal, { color }]}>{value}</Text>
      </View>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={ms.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[ms.sheet, { backgroundColor: colors.card }]}>
            <View style={[ms.handle, { backgroundColor: colors.border }]} />
            <View style={ms.headerRow}>
              <View style={[ms.iconWrap, { backgroundColor: isProfit ? colors.profit : colors.expenseBg }]}>
                <MaterialCommunityIcons name="chart-line" size={20} color={isProfit ? '#fff' : colors.expense} />
              </View>
              <View style={ms.titleCol}>
                <Text style={[ms.title, { color: colors.foreground }]}>Profit Breakdown</Text>
              </View>
              <Pressable onPress={onClose} style={[ms.closeX, { backgroundColor: colors.background }]}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <PeriodBar value={period} onChange={setPeriod} activeColor={colors.primary} />
            <BRow label="Revenue"                    value={`+${fmt(pRevenue)}`}  color={colors.revenue} />
            <BRow label="COGS (Cost of Goods Sold)"  value={`−${fmt(pCOGS)}`}    color={colors.expense} />
            <BRow label="Operating Expenses"         value={`−${fmt(pExpenses)}`} color={colors.expense} />
            <View style={[pbStyles.totalBox, { backgroundColor: isProfit ? colors.profit : '#C62828' }]}>
              <Text style={pbStyles.totalLbl}>Net Profit</Text>
              <Text style={pbStyles.totalVal}>
                {isProfit ? '+' : '−'}{fmt(Math.abs(pProfit))}
              </Text>
            </View>
            <Pressable onPress={onClose} style={({ pressed }) => [ms.closeBtn, { backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[ms.closeBtnTxt, { color: colors.foreground }]}>Close</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const pbStyles = StyleSheet.create({
  row:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLbl:   { fontSize: 14, fontFamily: 'Inter_400Regular' },
  rowVal:   { fontSize: 15, fontFamily: 'Inter_700Bold' },
  totalBox: { borderRadius: 14, padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 },
  totalLbl: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  totalVal: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff' },
});

// ── Export Modal ──────────────────────────────────────────────────────────────

function ExportModal({ visible, onClose, entries, products }: {
  visible: boolean; onClose: () => void; entries: Entry[]; products: Product[];
}) {
  const colors = useColors();
  const [exporting, setExporting] = useState<'pdf' | 'csv' | 'sheets' | null>(null);

  const makeCSV = (): string => {
    const rows = entries.map(e =>
      `${e.date},${e.type},${e.category || ''},${e.amount},${e.cogsAmount ?? 0},"${(e.notes || '').replace(/"/g, '""')}"`
    );
    const prodRows = products.map(p =>
      `"${p.name.replace(/"/g, '""')}",${p.costPrice},${p.stockQty},${p.stockQty * p.costPrice},${p.suggestedPrice}`
    );
    return [
      'Date,Type,Category,Amount,COGS,Notes',
      ...rows,
      '', '',
      'Products', 'Name,Cost Price,Qty On Hand,Stock Value,Sell Price',
      ...prodRows,
    ].join('\n');
  };

  const makeHTML = (): string => {
    const rev  = entries.filter(e => e.type === 'sale').reduce((s, e) => s + e.amount, 0);
    const cogs = entries.filter(e => e.type === 'sale').reduce((s, e) => s + (e.cogsAmount ?? 0), 0);
    const exp  = entries.filter(e => e.type === 'expense').reduce((s, e) => s + e.amount, 0);
    const net  = rev - cogs - exp;
    const sv   = products.reduce((s, p) => s + p.stockQty * p.costPrice, 0);
    const date = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
    const profitColor = net >= 0 ? '#15803D' : '#B91C1C';

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:20px;color:#111}
      h1{color:#1B7A3E;border-bottom:2px solid #1B7A3E;padding-bottom:10px}
      h2{color:#1B7A3E;margin-top:30px}
      .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:24px}
      .card{background:#f5f5f5;border-radius:8px;padding:14px}
      .lbl{font-size:11px;color:#666;text-transform:uppercase}
      .val{font-size:20px;font-weight:bold;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:12px}
      th{background:#1B7A3E;color:#fff;padding:9px 8px;text-align:left;font-size:12px}
      td{padding:8px;border-bottom:1px solid #eee;font-size:12px}
      tr:nth-child(even){background:#f9f9f9}
    </style></head><body>
    <h1>ProfitNaija Report</h1><p style="color:#666">Generated: ${date}</p>
    <h2>Summary</h2>
    <div class="grid">
      <div class="card"><div class="lbl">Revenue</div><div class="val" style="color:#15803D">₦${rev.toLocaleString('en-NG')}</div></div>
      <div class="card"><div class="lbl">COGS</div><div class="val" style="color:#B91C1C">₦${cogs.toLocaleString('en-NG')}</div></div>
      <div class="card"><div class="lbl">Operating Expenses</div><div class="val" style="color:#B91C1C">₦${exp.toLocaleString('en-NG')}</div></div>
      <div class="card"><div class="lbl">Net Profit</div><div class="val" style="color:${profitColor}">₦${net.toLocaleString('en-NG')}</div></div>
      <div class="card"><div class="lbl">Stock Value</div><div class="val" style="color:#1B7A3E">₦${sv.toLocaleString('en-NG')}</div></div>
    </div>
    <h2>Transactions (${entries.length})</h2>
    <table><tr><th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>COGS</th><th>Notes</th></tr>
    ${entries.map(e => `<tr><td>${e.date}</td><td style="text-transform:capitalize">${e.type.replace('_',' ')}</td><td>${e.category||e.itemName||''}</td><td style="color:${e.type==='sale'?'#15803D':'#B91C1C'}">₦${e.amount.toLocaleString('en-NG')}</td><td>${e.cogsAmount?'₦'+e.cogsAmount.toLocaleString('en-NG'):'—'}</td><td>${e.notes||''}</td></tr>`).join('')}
    </table>
    <h2>Products / Inventory (${products.length})</h2>
    <table><tr><th>Product</th><th>Cost Price</th><th>Qty</th><th>Stock Value</th><th>Sell Price</th></tr>
    ${products.map(p => `<tr><td>${p.name}</td><td>₦${p.costPrice.toLocaleString('en-NG')}</td><td>${p.stockQty}</td><td>₦${(p.stockQty*p.costPrice).toLocaleString('en-NG')}</td><td>₦${p.suggestedPrice.toLocaleString('en-NG')}</td></tr>`).join('')}
    </table></body></html>`;
  };

  const exportCSV = async (filename: string) => {
    const csv  = makeCSV();
    const path = `${FileSystem.cacheDirectory}${filename}.csv`;
    await FileSystem.writeAsStringAsync(path, csv, { encoding: FileSystem.EncodingType.UTF8 });
    await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export CSV' });
  };

  const run = async (key: 'pdf' | 'csv' | 'sheets') => {
    setExporting(key);
    try {
      if (key === 'pdf') {
        const { uri } = await Print.printToFileAsync({ html: makeHTML() });
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Export PDF Report' });
      } else if (key === 'csv') {
        await exportCSV('profitnaija_export');
      } else {
        await exportCSV('profitnaija_for_sheets');
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Could not export.');
    } finally {
      setExporting(null);
    }
  };

  function Option({ icon, title, sub, k }: { icon: string; title: string; sub: string; k: 'pdf' | 'csv' | 'sheets' }) {
    const busy = exporting === k;
    return (
      <Pressable
        onPress={() => run(k)}
        disabled={!!exporting}
        style={({ pressed }) => [exStyles.option, { backgroundColor: colors.background, borderColor: colors.border, opacity: pressed ? 0.7 : exporting && !busy ? 0.4 : 1 }]}
      >
        <View style={[exStyles.optIcon, { backgroundColor: colors.secondary }]}>
          {busy
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <MaterialCommunityIcons name={icon as any} size={22} color={colors.primary} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[exStyles.optTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[exStyles.optSub, { color: colors.mutedForeground }]}>{sub}</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </Pressable>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={ms.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <Animated.View entering={FadeInUp.springify()} style={[ms.sheet, { backgroundColor: colors.card }]}>
            <View style={[ms.handle, { backgroundColor: colors.border }]} />
            <View style={ms.headerRow}>
              <View style={[ms.iconWrap, { backgroundColor: colors.secondary }]}>
                <MaterialCommunityIcons name="export" size={20} color={colors.primary} />
              </View>
              <View style={ms.titleCol}>
                <Text style={[ms.title, { color: colors.foreground }]}>Export Data</Text>
                <Text style={[exStyles.meta, { color: colors.mutedForeground }]}>
                  {entries.length} transactions · {products.length} products
                </Text>
              </View>
              <Pressable onPress={onClose} style={[ms.closeX, { backgroundColor: colors.background }]}>
                <Feather name="x" size={15} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <View style={{ gap: 10 }}>
              <Option icon="file-pdf-box"        title="PDF Report"       sub="Full report with transactions & inventory" k="pdf"    />
              <Option icon="microsoft-excel"      title="Excel / CSV"      sub="Opens in Excel, Numbers, or any spreadsheet" k="csv"  />
              <Option icon="google-spreadsheet"   title="Google Sheets"    sub="Share CSV and import into Google Sheets"    k="sheets" />
            </View>
            <Pressable onPress={onClose} style={({ pressed }) => [ms.closeBtn, { backgroundColor: colors.background, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[ms.closeBtnTxt, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const exStyles = StyleSheet.create({
  meta:     { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  option:   { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 14 },
  optIcon:  { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  optTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  optSub:   { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
});

// ── Logout menu modal ─────────────────────────────────────────────────────────

function MenuModal({
  visible, onClose, displayName, email, onLogout,
}: {
  visible: boolean; onClose: () => void; displayName: string; email: string; onLogout: () => void;
}) {
  const colors = useColors();
  return (
    <Modal transparent animationType="fade" visible={visible} statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.menuOverlay} onPress={onClose}>
        <Animated.View
          entering={FadeInDown.springify()}
          style={[styles.menuCard, { backgroundColor: colors.card, shadowColor: '#000' }]}
        >
          <View style={[styles.menuUserRow, { borderBottomColor: colors.border }]}>
            <View style={[styles.menuAvatar, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.menuAvatarText, { color: colors.primary }]}>
                {displayName ? displayName[0].toUpperCase() : '?'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.menuName, { color: colors.foreground }]} numberOfLines={1}>
                {displayName || 'My Account'}
              </Text>
              <Text style={[styles.menuEmail, { color: colors.mutedForeground }]} numberOfLines={1}>
                {email}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => { onClose(); router.push('/data-recovery'); }}
            style={({ pressed }) => [styles.menuItem, { opacity: pressed ? 0.7 : 1, borderBottomColor: colors.border }]}
          >
            <MaterialCommunityIcons name="database-sync" size={18} color={colors.primary} />
            <Text style={[styles.menuItemText, { color: colors.foreground }]}>Recover Data</Text>
          </Pressable>
          <Pressable
            onPress={onLogout}
            style={({ pressed }) => [styles.menuItem, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Feather name="log-out" size={18} color={colors.expense} />
            <Text style={[styles.menuItemText, { color: colors.expense }]}>Sign Out</Text>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

// ── Summary card ──────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  amount: number;
  bgColor: string;
  textColor: string;
  iconName: string;
  delay: number;
  subtitle?: string;
  onPress?: () => void;
  fullWidth?: boolean;
}

function SummaryCard({ label, amount, bgColor, textColor, iconName, delay, subtitle, onPress, fullWidth }: SummaryCardProps) {
  return (
    <Pressable
      style={({ pressed }) => [fullWidth ? { width: '100%' } : { flex: 1 }, { opacity: onPress && pressed ? 0.82 : 1 }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <Animated.View
        entering={FadeInDown.delay(delay).springify()}
        style={[styles.summaryCard, { backgroundColor: bgColor }]}
      >
        <View style={[styles.cardIconWrap, { backgroundColor: textColor + '22' }]}>
          <MaterialCommunityIcons name={iconName as any} size={18} color={textColor} />
        </View>
        <Text style={[styles.cardLabel, { color: textColor + 'BB' }]}>{label}</Text>
        <Text style={[styles.cardAmount, { color: textColor }]} numberOfLines={1} adjustsFontSizeToFit>
          {formatAmount(amount)}
        </Text>
        {subtitle ? (
          <Text style={[styles.cardSubtitle, { color: textColor + '88' }]} numberOfLines={2}>{subtitle}</Text>
        ) : null}
        {onPress ? (
          <Text style={[styles.cardTapHint, { color: textColor + '66' }]}>Tap for details ›</Text>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({ item, index }: { item: Entry; index: number }) {
  const colors = useColors();
  const isSale     = item.type === 'sale';
  const isPurchase = item.type === 'purchase';

  const iconName  = isSale ? 'trending-up' : isPurchase ? 'package-variant-closed' : 'trending-down';
  const iconBg    = isSale ? colors.revenueBg : isPurchase ? colors.secondary : colors.expenseBg;
  const iconColor = isSale ? colors.revenue   : isPurchase ? colors.primary   : colors.expense;
  const amtColor  = isSale ? colors.revenue   : isPurchase ? colors.primary   : colors.expense;
  const prefix    = isSale ? '+' : '−';
  const label     = isPurchase
    ? (item.itemName || item.category || 'Purchase')
    : item.category;

  return (
    <Animated.View entering={FadeInDown.delay(index * 50 + 300).springify()}>
      <View style={[styles.entryRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.entryIcon, { backgroundColor: iconBg }]}>
          <MaterialCommunityIcons name={iconName as any} size={20} color={iconColor} />
        </View>
        <View style={styles.entryInfo}>
          <Text style={[styles.entryCategory, { color: colors.foreground }]} numberOfLines={1}>
            {label}
          </Text>
          {isPurchase && item.industry ? (
            <Text style={[styles.entryNotes, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.industry} · {item.markup}% markup
            </Text>
          ) : !!item.notes ? (
            <Text style={[styles.entryNotes, { color: colors.mutedForeground }]} numberOfLines={1}>
              {item.notes}
            </Text>
          ) : null}
          <Text style={[styles.entryDate, { color: colors.mutedForeground }]}>
            {formatDate(item.date)}
          </Text>
        </View>
        <View style={styles.entryAmountCol}>
          <Text style={[styles.entryAmount, { color: amtColor }]}>
            {prefix}{formatAmount(item.amount)}
          </Text>
          {isPurchase && item.suggestedPrice ? (
            <Text style={[styles.entrySuggestedPrice, { color: colors.revenue }]}>
              Sell: {NAIRA}{item.suggestedPrice.toLocaleString('en-NG')}
            </Text>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

// ── Error card ────────────────────────────────────────────────────────────────

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  const colors = useColors();
  return (
    <View style={[styles.errorCard, { backgroundColor: colors.expenseBg, borderColor: colors.expense + '44' }]}>
      <Feather name="alert-circle" size={28} color={colors.expense} />
      <Text style={[styles.errorTitle, { color: colors.expense }]}>Could not load data</Text>
      <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>{message}</Text>
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onRetry(); }}
        style={({ pressed }) => [styles.retryBtn, { backgroundColor: colors.expense, opacity: pressed ? 0.8 : 1 }]}
      >
        <Feather name="refresh-cw" size={14} color="#fff" />
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export default function DashboardScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const {
    entries, loading, error, retry,
    totalRevenue, totalExpenses, totalCOGS,
    totalCostPrice,
    netProfit, syncStatus, pendingCount,
    products,
  } = useEntries();
  const { user, signOut } = useAuth();

  const [menuVisible,    setMenuVisible]    = useState(false);
  const [revenueModal,   setRevenueModal]   = useState(false);
  const [costModal,      setCostModal]      = useState(false);
  const [expensesModal,  setExpensesModal]  = useState(false);
  const [stockModal,     setStockModal]     = useState(false);
  const [profitModal,    setProfitModal]    = useState(false);
  const [exportModal,    setExportModal]    = useState(false);

  const { width: screenWidth } = useWindowDimensions();
  const isWide = screenWidth >= 600;

  const topInset    = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const tap = (fn: () => void) => () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fn();
  };

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive',
        onPress: async () => {
          setMenuVisible(false);
          await signOut();
          router.replace('/sign-in');
        },
      },
    ]);
  };

  // ── List header ─────────────────────────────────────────────────────────────

  const ListHeader = (
    <View>
      {/* App header */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: topInset + 16 }]}>
        <Animated.View entering={FadeInUp.springify()} style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>ProfitNaija</Text>
            <View style={styles.headerSubRow}>
              <Text style={styles.headerSubtitle}>
                {new Date().toLocaleDateString('en-NG', { month: 'long', year: 'numeric' })}
              </Text>
              {/* Sync chip */}
              <View style={[
                styles.syncChip,
                syncStatus === 'synced'  && styles.syncChipGreen,
                (syncStatus === 'pending' || syncStatus === 'syncing') && styles.syncChipYellow,
              ]}>
                <View style={[
                  styles.syncDot,
                  syncStatus === 'synced'  && { backgroundColor: '#4CAF50' },
                  (syncStatus === 'pending' || syncStatus === 'syncing') && { backgroundColor: '#FFC107' },
                ]} />
                <Text style={[
                  styles.syncChipText,
                  syncStatus === 'synced'  && { color: '#2E7D32' },
                  (syncStatus === 'pending' || syncStatus === 'syncing') && { color: '#7B5800' },
                ]}>
                  {syncStatus === 'synced'
                    ? 'Synced'
                    : syncStatus === 'syncing' && pendingCount === 0
                    ? 'Connecting…'
                    : syncStatus === 'syncing'
                    ? `Syncing ${pendingCount}…`
                    : `${pendingCount} pending`}
                </Text>
              </View>
            </View>
          </View>

          {/* Export button */}
          <Pressable
            onPress={tap(() => setExportModal(true))}
            style={({ pressed }) => [styles.exportBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <MaterialCommunityIcons name="export" size={20} color="rgba(255,255,255,0.85)" />
          </Pressable>

          {/* User avatar / menu */}
          <Pressable
            onPress={() => { Haptics.selectionAsync(); setMenuVisible(true); }}
            style={({ pressed }) => [styles.menuBtn, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.menuAvatar, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
              <Text style={styles.menuAvatarInitial}>
                {user?.displayName ? user.displayName[0].toUpperCase() : user?.email?.[0]?.toUpperCase() ?? '?'}
              </Text>
            </View>
          </Pressable>
        </Animated.View>
      </View>

      {/* Summary cards — responsive: 3×2 mobile / 2×3 wide */}
      <View style={[styles.cardsContainer, { backgroundColor: colors.headerBg }]}>
        {isWide ? (
          // ── Wide (tablet / web): 2 rows of 3 ──────────────────────────────
          <>
            <View style={styles.cardsRow}>
              <SummaryCard label="Revenue"      amount={totalRevenue}   bgColor={colors.card}       textColor={colors.revenue} iconName="cash-multiple"       delay={50}  onPress={tap(() => setRevenueModal(true))} />
              <SummaryCard label="Cost"         amount={totalCOGS}      bgColor="#FFF3E0"            textColor="#E65100"        iconName="shopping"            delay={100} onPress={tap(() => setCostModal(true))} />
              <SummaryCard label="Expenses"     amount={totalExpenses}  bgColor={colors.expenseBg}  textColor={colors.expense} iconName="minus-circle-outline" delay={150} onPress={tap(() => setExpensesModal(true))} />
            </View>
            <View style={styles.cardsRow}>
              <SummaryCard label="Stock Value"  amount={totalCostPrice} bgColor={colors.card}       textColor={colors.primary} iconName="warehouse"           delay={200} onPress={tap(() => setStockModal(true))} />
              <SummaryCard label="Net Profit"   amount={netProfit}      bgColor={colors.profit}     textColor="#FFFFFF"        iconName="chart-line"          delay={250} onPress={tap(() => setProfitModal(true))} />
            </View>
          </>
        ) : (
          // ── Mobile: 3 rows of 2 ───────────────────────────────────────────
          <>
            <View style={styles.cardsRow}>
              <SummaryCard label="Revenue"     amount={totalRevenue}   bgColor={colors.card}      textColor={colors.revenue} iconName="cash-multiple"       delay={50}  onPress={tap(() => setRevenueModal(true))} />
              <SummaryCard label="Cost"        amount={totalCOGS}      bgColor="#FFF3E0"           textColor="#E65100"        iconName="shopping"            delay={100} onPress={tap(() => setCostModal(true))} />
            </View>
            <View style={styles.cardsRow}>
              <SummaryCard label="Expenses"    amount={totalExpenses}  bgColor={colors.expenseBg} textColor={colors.expense} iconName="minus-circle-outline" delay={150} onPress={tap(() => setExpensesModal(true))} />
              <SummaryCard label="Stock Value" amount={totalCostPrice} bgColor={colors.card}      textColor={colors.primary} iconName="warehouse"           delay={200} onPress={tap(() => setStockModal(true))} />
            </View>
            <View style={styles.cardsRow}>
              <SummaryCard label="Net Profit"  amount={netProfit}      bgColor={colors.profit}    textColor="#FFFFFF"        iconName="chart-line"          delay={250} onPress={tap(() => setProfitModal(true))} fullWidth />
            </View>
          </>
        )}
      </View>

      {/* Section header */}
      <View style={[styles.sectionHeader, { backgroundColor: colors.background, borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Recent Activity</Text>
        {loading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
            {entries.length} {entries.length === 1 ? 'entry' : 'entries'}
          </Text>
        )}
      </View>

      {error && !loading && (
        <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
          <ErrorCard message={error} onRetry={retry} />
        </View>
      )}
    </View>
  );

  const ListEmpty = !error ? (
    loading ? (
      <View style={styles.centerState}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>
          Connecting to Firestore…
        </Text>
      </View>
    ) : (
      <View style={styles.centerState}>
        <Feather name="inbox" size={40} color={colors.mutedForeground} />
        <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No transactions yet</Text>
        <Text style={[styles.emptySubtext, { color: colors.mutedForeground }]}>
          Tap + to record your first sale, purchase, or expense
        </Text>
      </View>
    )
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={entries}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => <EntryRow item={item} index={index} />}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={ListEmpty}
        contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + 90 }]}
        showsVerticalScrollIndicator={false}
      />

      {/* FAB */}
      <Animated.View
        entering={FadeInUp.delay(400).springify()}
        style={[styles.fab, { backgroundColor: colors.primary, bottom: bottomInset + 24 }]}
      >
        <Pressable
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push('/add-entry'); }}
          style={({ pressed }) => [styles.fabInner, { opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
          testID="fab-add-entry"
        >
          <Feather name="plus" size={28} color="#FFFFFF" />
        </Pressable>
      </Animated.View>

      {/* Account menu */}
      <MenuModal
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        displayName={user?.displayName ?? ''}
        email={user?.email ?? ''}
        onLogout={handleLogout}
      />

      {/* Detail modals */}
      <RevenueDetailModal    visible={revenueModal}  onClose={() => setRevenueModal(false)}  entries={entries} />
      <CostDetailModal       visible={costModal}     onClose={() => setCostModal(false)}     entries={entries} />
      <ExpensesDetailModal   visible={expensesModal} onClose={() => setExpensesModal(false)} entries={entries} />
      <StockValueDetailModal visible={stockModal}    onClose={() => setStockModal(false)}    products={products} />
      <ProfitBreakdownModal  visible={profitModal}   onClose={() => setProfitModal(false)}   entries={entries} />
      <ExportModal visible={exportModal} onClose={() => setExportModal(false)} entries={entries} products={products} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header:    { paddingHorizontal: 20, paddingBottom: 0 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 },
  headerTitle:   { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.5 },
  headerSubRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  headerSubtitle:{ fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)' },

  syncChip:       { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  syncChipGreen:  { backgroundColor: 'rgba(76,175,80,0.18)' },
  syncChipYellow: { backgroundColor: 'rgba(255,193,7,0.22)' },
  syncDot:        { width: 6, height: 6, borderRadius: 3 },
  syncChipText:   { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  exportBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 2, marginRight: 4,
  },
  menuBtn:   { marginTop: 2 },
  menuAvatar:{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  menuAvatarInitial: { fontSize: 16, fontFamily: 'Inter_700Bold', color: '#fff' },

  cardsContainer: { paddingHorizontal: 16, paddingBottom: 24, gap: 12 },
  cardsRow:       { flexDirection: 'row', gap: 12 },

  summaryCard: {
    flex: 1, borderRadius: 16, padding: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07, shadowRadius: 8, elevation: 3,
    gap: 4,
  },
  cardIconWrap: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  cardLabel:    { fontSize: 11, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  cardAmount:   { fontSize: 19, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  cardSubtitle: { fontSize: 10, fontFamily: 'Inter_400Regular', lineHeight: 14 },
  cardTapHint:  { fontSize: 9, fontFamily: 'Inter_500Medium', marginTop: 2 },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  sectionCount: { fontSize: 13, fontFamily: 'Inter_400Regular' },

  listContent: { flexGrow: 1 },

  entryRow: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginTop: 10,
    borderRadius: 14, padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  entryIcon:     { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  entryInfo:     { flex: 1, gap: 2 },
  entryCategory: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  entryNotes:    { fontSize: 12, fontFamily: 'Inter_400Regular' },
  entryDate:     { fontSize: 11, fontFamily: 'Inter_400Regular' },
  entryAmountCol:{ alignItems: 'flex-end', gap: 2 },
  entryAmount:   { fontSize: 15, fontFamily: 'Inter_700Bold', letterSpacing: -0.3 },
  entrySuggestedPrice: { fontSize: 10, fontFamily: 'Inter_500Medium' },

  errorCard:  { borderRadius: 16, borderWidth: 1, padding: 20, alignItems: 'center', gap: 8 },
  errorTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 4 },
  errorBody:  { fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 },
  retryBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  retryText:  { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  centerState: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, gap: 10 },
  emptyText:   { fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 8 },
  emptySubtext:{ fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingHorizontal: 40 },

  fab: {
    position: 'absolute', right: 24, width: 60, height: 60, borderRadius: 30,
    shadowColor: '#1B7A3E', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  fabInner: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },

  // Menu modal
  menuOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-start', alignItems: 'flex-end',
    paddingTop: 80, paddingRight: 16,
  },
  menuCard: {
    width: 260, borderRadius: 16, overflow: 'hidden',
    shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 20, elevation: 10,
  },
  menuUserRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuAvatarText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  menuName:       { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  menuEmail:      { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 1 },
  menuItem:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  menuItemText:   { fontSize: 15, fontFamily: 'Inter_500Medium' },
});
