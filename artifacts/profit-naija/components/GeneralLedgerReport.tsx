import React, { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import type { GeneralLedgerReport as LedgerReport } from '@workspace/accounting-core';

const money = (value: number) => `₦${Math.abs(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const balanceText = (value: number) => `${money(value)} ${value < 0 ? 'Cr' : 'Dr'}`;

export function GeneralLedgerReport({ report }: { report: LedgerReport }) {
  const colors = useColors();
  const [accountId, setAccountId] = useState('all');
  const accounts = useMemo(() => report.accounts.filter(account =>
    report.rows.some(row => row.accountId === account.id) ||
    report.balances.some(balance => balance.accountId === account.id),
  ), [report.accounts, report.rows, report.balances]);
  const rows = report.rows.filter(row => accountId === 'all' || row.accountId === accountId);
  const balances = report.balances.filter(balance => accountId === 'all' || balance.accountId === accountId);
  const historical = report.historicalRows.filter(row => accountId === 'all' || row.accountId === accountId);

  const label = (text: string, style?: object) => (
    <Text style={[{ color: colors.foreground, fontSize: 12 }, style]}>{text}</Text>
  );
  const metric = (title: string, value: string) => (
    <View key={title} style={{ width: '48%', backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10 }}>
      {label(title, { color: colors.mutedForeground, fontSize: 11 })}
      {label(value, { fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] })}
    </View>
  );

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 4 }}>
        {label('General Ledger Review', { fontSize: 18, fontWeight: '700' })}
        {label(`${report.startDate} to ${report.endDate}`, { color: colors.mutedForeground })}
        {label(
          `Read-only reconstruction. ${report.openingDate ? `The confirmed opening snapshot on ${report.openingDate} replaces older balances.` : 'No confirmed opening snapshot is recorded.'} Historical costs or accounts that cannot be supported are listed for review, not guessed.`,
          { color: colors.mutedForeground, fontSize: 11, lineHeight: 17 },
        )}
        {label('Bank transactions are grouped into one Bank control account in this report.', { color: colors.mutedForeground, fontSize: 11 })}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
        {metric('Period debits', money(report.periodDebit))}
        {metric('Period credits', money(report.periodCredit))}
        {metric('Closing trial balance · Dr', money(report.trialBalanceDebit))}
        {metric('Closing trial balance · Cr', money(report.trialBalanceCredit))}
      </View>

      <View style={{ backgroundColor: report.isBalanced ? '#eaf7ef' : '#fff4dc', borderColor: report.isBalanced ? '#9fd3ae' : '#e6c16e', borderWidth: 1, borderRadius: 9, padding: 10 }}>
        <Text style={{ color: report.isBalanced ? '#165c32' : '#704c00', fontSize: 12, lineHeight: 18 }}>
          {report.isBalanced ? 'Reconstructed closing debits and credits agree.' : 'The reconstructed closing trial balance does not agree. Review the warnings and suspense accounts.'}
          {report.reviewItems.length > 0 ? ` ${report.reviewItems.length} item(s) need review.` : ''}
        </Text>
      </View>

      <View>
        {label('Account filter', { fontWeight: '700', marginBottom: 7 })}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', gap: 7 }}>
            {[{ id: 'all', code: '', name: 'All accounts' }, ...accounts].map(account => {
              const active = accountId === account.id;
              return (
                <Text
                  key={account.id}
                  onPress={() => setAccountId(account.id)}
                  accessibilityRole="button"
                  style={{
                    overflow: 'hidden', borderRadius: 18, borderWidth: 1,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary : colors.background,
                    color: active ? '#fff' : colors.foreground,
                    paddingHorizontal: 11, paddingVertical: 7, fontSize: 11,
                  }}
                >
                  {account.code ? `${account.code} · ` : ''}{account.name}
                </Text>
              );
            })}
          </View>
        </ScrollView>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{ width: 1050, borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', backgroundColor: colors.background, paddingVertical: 9 }}>
            {[
              ['Date', 90], ['Account', 190], ['Description', 260], ['Reference', 150],
              ['Debit', 120], ['Credit', 120], ['Balance', 120],
            ].map(([heading, width]) => <Text key={String(heading)} style={{ width: Number(width), paddingHorizontal: 8, color: colors.mutedForeground, fontSize: 10, fontWeight: '700' }}>{heading}</Text>)}
          </View>
          {rows.length ? rows.map(row => (
            <LedgerRow key={row.id} row={row} colors={colors} />
          )) : <View style={{ padding: 16 }}>{label('No ledger activity for this period and account.', { color: colors.mutedForeground })}</View>}
        </View>
      </ScrollView>

      <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, overflow: 'hidden' }}>
        {label(`Trial balance by account (${balances.length})`, { fontWeight: '700', padding: 11 })}
        {balances.map(balance => (
          <View key={balance.accountId} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: colors.border, padding: 9 }}>
            <View style={{ flex: 1 }}>
              {label(`${balance.accountCode} · ${balance.accountName}`, { fontWeight: '600' })}
              {label(`Opening ${balanceText(balance.openingBalance)} · Dr ${money(balance.periodDebit)} · Cr ${money(balance.periodCredit)}`, { color: colors.mutedForeground, fontSize: 10, marginTop: 3 })}
            </View>
            {label(balanceText(balance.closingBalance), { fontWeight: '700', alignSelf: 'center' })}
          </View>
        ))}
      </View>

      <View style={{ borderWidth: 1, borderColor: '#e6c16e', borderRadius: 9, overflow: 'hidden' }}>
        {label(`Items needing review (${report.reviewItems.length})`, { color: '#704c00', fontWeight: '700', padding: 11 })}
        {report.reviewItems.length ? report.reviewItems.map((item, index) => (
          <View key={`${item.sourceId}:${index}`} style={{ borderTopWidth: 1, borderTopColor: '#f0d99e', padding: 10, gap: 3 }}>
            {label(`${item.date} · ${item.description}`, { fontWeight: '600' })}
            {label(item.reason, { color: colors.mutedForeground, fontSize: 11, lineHeight: 16 })}
            {label(item.sourceId, { color: colors.mutedForeground, fontSize: 10 })}
          </View>
        )) : <View style={{ borderTopWidth: 1, borderTopColor: '#f0d99e', padding: 10 }}>{label('No source mappings need review.', { color: colors.mutedForeground })}</View>}
      </View>

      {historical.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 11, gap: 8 }}>
          {label(`Historical records superseded by the opening snapshot (${historical.length} lines)`, { fontWeight: '700' })}
          {label('Shown for review only; they do not carry into confirmed opening balances.', { color: colors.mutedForeground, fontSize: 11 })}
          {historical.map(row => (
            <Text key={row.id} style={{ color: colors.mutedForeground, fontSize: 10 }}>
              {row.date} · {row.accountCode} {row.accountName} · {row.description} · Dr {money(row.debit)} / Cr {money(row.credit)}
            </Text>
          ))}
        </View>
      )}

      {report.referenceOnly.length > 0 && (
        <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 9, padding: 11, gap: 7 }}>
          {label(`Source records shown as evidence only (${report.referenceOnly.length})`, { fontWeight: '700' })}
          {report.referenceOnly.map((item, index) => <Text key={`${item.sourceId}:${index}`} style={{ color: colors.mutedForeground, fontSize: 10, lineHeight: 15 }}>{item.date} · {item.description}: {item.reason}</Text>)}
        </View>
      )}
    </View>
  );
}

function LedgerRow({ row, colors }: { row: LedgerReport['rows'][number]; colors: ReturnType<typeof useColors> }) {
  const cell = (value: string, width: number, align: 'left' | 'right' = 'left') => (
    <Text numberOfLines={2} style={{ width, paddingHorizontal: 8, paddingVertical: 9, color: colors.foreground, fontSize: 10, textAlign: align, borderTopWidth: 1, borderTopColor: colors.border }}>
      {value}
    </Text>
  );
  return (
    <View style={{ flexDirection: 'row', backgroundColor: row.openingBalance ? colors.background : colors.card }}>
      {cell(row.date, 90)}
      {cell(`${row.accountCode} · ${row.accountName}`, 190)}
      {cell(`${row.description}${row.openingBalance ? ' · Opening' : ''}${row.needsReview ? ' · Review' : ''}`, 260)}
      {cell(row.reference, 150)}
      {cell(row.debit ? money(row.debit) : '—', 120, 'right')}
      {cell(row.credit ? money(row.credit) : '—', 120, 'right')}
      {cell(balanceText(row.balance), 120, 'right')}
    </View>
  );
}
