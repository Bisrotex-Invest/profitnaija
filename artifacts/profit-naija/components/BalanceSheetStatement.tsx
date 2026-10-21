import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import type { Entry, Product } from '@/context/EntriesContext';
import { buildBalanceSheet } from '@/lib/utils/balanceSheet';

type Row = { key: string; label: string; value: number | null; section?: boolean; total?: boolean; grandTotal?: boolean };

export function formatBalance(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Not available';
  const abs = '₦' + Math.abs(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? '−' + abs : abs;
}

function formatAsAt(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  return Number.isNaN(dt.getTime()) ? date : dt.toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
}

function rowsWithEquity(rows: Row[]): Row[] {
  if (rows.some(r => /equity/i.test(r.label) || /equity/i.test(r.key))) return rows;
  return [
    ...rows,
    { key: 'equity-section', label: 'Equity', value: null, section: true },
    { key: 'equity-owner', label: "Owner's equity (capital, drawings, retained earnings)", value: null },
  ];
}

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function buildBalanceSheetHTML(
  businessName: string, businessAddress: string, businessPhone: string,
  entries: Entry[], products: Product[], asOfDate: string,
): string {
  const sheet = buildBalanceSheet(entries, products, asOfDate);
  const rows = rowsWithEquity(sheet.rows as Row[]);
  const generated = new Date().toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' });
  const body = rows.map(r => r.section
    ? `<tr class="section"><td colspan="2">${esc(r.label)}</td></tr>`
    : `<tr class="${r.grandTotal ? 'grand' : r.total ? 'total' : ''} ${r.value === null ? 'na' : r.value < 0 ? 'neg' : ''}"><td>${esc(r.label)}</td><td>${esc(formatBalance(r.value))}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @page { size: A4; margin: 20mm; }
  body { font-family: Arial, Helvetica, sans-serif; color: #17221b; font-size: 13px; line-height: 1.6; margin: 0; }
  .header { border-bottom: 3px solid #13733a; padding-bottom: 20px; margin-bottom: 24px; display: flex; justify-content: space-between; gap: 24px; }
  .brand { color: #13733a; font-size: 24px; font-weight: 800; }
  .meta { color: #5f6b63; font-size: 12px; }
  h1 { font-size: 22px; margin: 0 0 6px; text-align: right; }
  .header .r { text-align: right; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  tr { page-break-inside: avoid; }
  td { padding: 10px 14px; border-bottom: 1px solid #e8ede9; }
  td:last-child { text-align: right; white-space: nowrap; font-weight: 700; }
  .section td { background: #f1f6f2; font-weight: 800; text-transform: uppercase; font-size: 12px; letter-spacing: 1px; text-align: left; }
  .total td { border-top: 1px solid #cddbd0; font-weight: 800; }
  .grand td { background: #e8f5e9; border-top: 2px solid #15803D; font-weight: 800; font-size: 15px; }
  .neg td:last-child { color: #B91C1C; }
  .na td:last-child { color: #7b887e; font-style: italic; font-weight: 400; }
  ul { font-size: 11px; color: #5f6b63; padding-left: 18px; }
  .warn { color: #7a4b00; }
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #d9e2db; color: #7b887e; font-size: 11px; text-align: center; }
</style></head><body>
<div class="header"><div><div class="brand">${esc(businessName || 'Business')}</div><div class="meta">Powered by ProfitNaija<br/>${businessAddress ? esc(businessAddress) + '<br/>' : ''}${businessPhone ? esc(businessPhone) : ''}</div></div>
<div class="r"><h1>Balance Sheet / Statement of Financial Position (Provisional)</h1><div class="meta"><strong>As at ${esc(formatAsAt(sheet.asOfDate))}</strong><br/>Generated: ${esc(generated)}</div></div></div>
<table><tbody>${body}</tbody></table>
<div class="footer">Powered by ProfitNaija · Balance Sheet as at ${esc(formatAsAt(sheet.asOfDate))} · Generated ${esc(generated)}</div>
</body></html>`;
}

export function BalanceSheetStatement({ entries, products, asOfDate }: { entries: Entry[]; products: Product[]; asOfDate: string }) {
  const colors = useColors();
  const sheet = React.useMemo(() => buildBalanceSheet(entries, products, asOfDate), [entries, products, asOfDate]);
  const rows = rowsWithEquity(sheet.rows as Row[]);
  return (
    <View testID="report-balance-sheet">
      <Text style={[s.title, { color: colors.foreground }]}>Balance Sheet / Statement of Financial Position</Text>
      <Text style={[s.asAt, { color: colors.foreground }]}>As at {formatAsAt(sheet.asOfDate)}</Text>
      {rows.map(row => row.section ? (
        <Text key={row.key} style={[s.section, { color: colors.foreground, backgroundColor: colors.muted }]}>{row.label}</Text>
      ) : (
        <View key={row.key} style={[s.row, { borderColor: colors.border }, row.grandTotal && { backgroundColor: colors.secondary }]}>
          <Text style={[s.label, { color: colors.foreground }, (row.total || row.grandTotal) && s.bold]}>{row.label}</Text>
          <Text style={[s.value, { color: row.value === null ? colors.mutedForeground : row.value < 0 ? colors.destructive : colors.foreground }, row.value === null && s.italic, (row.total || row.grandTotal) && s.bold]}>
            {formatBalance(row.value)}
          </Text>
        </View>
      ))}
      <Pressable testID="link-manage-equity" onPress={() => router.push('/equity')} style={[s.callout, { borderColor: colors.primary, backgroundColor: colors.muted }]}>
        <Text style={{ color: colors.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>Manage opening balances, owner capital and drawings</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  title: { fontSize: 17, fontFamily: 'Inter_700Bold', marginBottom: 4 },
  asAt: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  note: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_400Regular', marginTop: 6 },
  section: { fontSize: 12, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.8, paddingVertical: 8, paddingHorizontal: 10, marginTop: 14, borderRadius: 6, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { flex: 1, paddingRight: 12, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  value: { maxWidth: '45%', textAlign: 'right', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  bold: { fontFamily: 'Inter_700Bold' },
  italic: { fontStyle: 'italic', fontFamily: 'Inter_400Regular' },
  callout: { marginTop: 14, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  warn: { marginTop: 8, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, fontSize: 12, lineHeight: 17, fontFamily: 'Inter_400Regular' },
});
