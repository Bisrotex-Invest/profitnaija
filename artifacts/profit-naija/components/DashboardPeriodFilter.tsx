import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import {
  DASHBOARD_PERIOD_OPTIONS,
  dashboardDate,
  dashboardRangeError,
  type DashboardDateRange,
  type DashboardPeriodSelection,
} from '@/lib/dashboardPeriod';

interface Props {
  selection: DashboardPeriodSelection;
  range: DashboardDateRange;
  onChange: (selection: DashboardPeriodSelection) => void;
}

export function DashboardPeriodFilter({ selection, range, onChange }: Props) {
  const colors = useColors();
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(selection.customStart);
  const [end, setEnd] = useState(selection.customEnd);
  const [error, setError] = useState<string | undefined>();

  const choose = (value: DashboardPeriodSelection['period']) => {
    setError(undefined);
    if (value === 'custom') {
      setStart(selection.customStart);
      setEnd(selection.customEnd);
      setEditing(true);
      return;
    }
    setEditing(false);
    onChange({ ...selection, period: value });
  };

  const apply = () => {
    const err = dashboardRangeError(start.trim(), end.trim(), dashboardDate());
    if (err) { setError(err); return; }
    setError(undefined);
    setEditing(false);
    onChange({ period: 'custom', customStart: start.trim(), customEnd: end.trim() });
  };

  const cancel = () => { setEditing(false); setError(undefined); };
  const active = editing ? 'custom' : selection.period;

  const inputStyle = [styles.input, { backgroundColor: colors.input, borderColor: colors.border, color: colors.foreground }];

  return (
    <View style={styles.wrap} accessibilityLabel="Dashboard period">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {DASHBOARD_PERIOD_OPTIONS.map(o => {
          const on = active === o.value;
          return (
            <Pressable
              key={o.value}
              testID={`period-${o.value}`}
              accessibilityRole="button"
              accessibilityLabel={o.label}
              accessibilityState={{ selected: on }}
              onPress={() => choose(o.value)}
              style={[styles.chip, { backgroundColor: on ? colors.primary : colors.card, borderColor: on ? colors.primary : colors.border }]}
            >
              <Text style={[styles.chipTxt, { color: on ? colors.primaryForeground : colors.foreground }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {editing && (
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.foreground }]}>Start date (YYYY-MM-DD)</Text>
          <TextInput
            testID="period-start"
            accessibilityLabel="Start date, format year-month-day"
            value={start}
            onChangeText={setStart}
            placeholder="2025-01-31"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            autoCorrect={false}
            style={inputStyle}
          />
          <Text style={[styles.label, { color: colors.foreground }]}>End date (YYYY-MM-DD)</Text>
          <TextInput
            testID="period-end"
            accessibilityLabel="End date, format year-month-day"
            value={end}
            onChangeText={setEnd}
            placeholder="2025-01-31"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            autoCorrect={false}
            style={inputStyle}
          />
          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
          <View style={styles.row}>
            <Pressable testID="period-apply" accessibilityRole="button" accessibilityLabel="Apply custom range" onPress={apply}
              style={[styles.btn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.btnTxt, { color: colors.primaryForeground }]}>Apply</Text>
            </Pressable>
            <Pressable testID="period-cancel" accessibilityRole="button" accessibilityLabel="Cancel custom range" onPress={cancel}
              style={[styles.btn, { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1 }]}>
              <Text style={[styles.btnTxt, { color: colors.foreground }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text accessibilityLiveRegion="polite" style={[styles.range, { color: colors.foreground }]}>{range.label}</Text>
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>
        Stock Value, Debtors and Creditors are balances as of the end date.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  chips: { gap: 8, paddingVertical: 2 },
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, justifyContent: 'center' },
  chipTxt: { fontSize: 14, fontWeight: '600' },
  panel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 8 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, fontSize: 16 },
  error: { fontSize: 13 },
  row: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnTxt: { fontSize: 15, fontWeight: '700' },
  range: { fontSize: 14, fontWeight: '600' },
  hint: { fontSize: 12 },
});
