import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { router } from 'expo-router';
import { taxControlRows, TAX_LABELS, type TaxControl } from '@workspace/accounting-core';
import { useColors } from '@/hooks/useColors';
import { fmt } from '@/lib/financeUi';

export function TaxControlSummary({ control, end, estimate }: { control: TaxControl; end: string; estimate?: number }) {
  const colors = useColors();
  const open = (action: 'payment' | 'credit' | 'charge', value?: number) => router.push({ pathname: '/finance', params: {
    tab: 'taxes', taxType: control.taxType, action, date: end, ...(value !== undefined ? { amount: String(Math.max(0, value)) } : {}),
  } });
  return <View style={{ padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, gap: 12 }} testID={`tax-control-${control.taxType}`}>
    <Text style={{ color: colors.foreground, fontWeight: '700' }}>{TAX_LABELS[control.taxType]} account</Text>
    {taxControlRows(control, end).map(row => <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={{ color: colors.foreground, flex: 1 }}>{row.label}</Text>
      <Text style={{ color: colors.foreground }}>{row.value === null ? 'Not available' : fmt(row.value)}</Text>
    </View>)}
    {control.closing === null && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Confirm opening tax balances to establish the amount owed.</Text>}
    {control.closing !== null && control.closing < 0 && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>Debit balance / tax credit—not a negative payment due.</Text>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
      <Pressable onPress={() => open('payment', control.closing ?? 0)} testID={`record-tax-payment-${control.taxType}`}><Text style={{ color: colors.primary }}>Record payment</Text></Pressable>
      <Pressable onPress={() => open('credit')}><Text style={{ color: colors.primary }}>Record credit</Text></Pressable>
      {estimate !== undefined && <Pressable onPress={() => open('charge', estimate)} testID="confirm-income-tax"><Text style={{ color: colors.primary }}>Review income-tax assessment</Text></Pressable>}
    </View>
    {estimate !== undefined && <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>PIT estimate: {fmt(estimate)}. Not posted until you confirm an assessment.</Text>}
  </View>;
}
