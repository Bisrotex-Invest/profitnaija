import React, { useMemo } from 'react';
import {
  Alert, Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft, BarChart3, Bell, Calculator, ChevronRight, CloudDownload,
  DollarSign, Lock, MessageCircle, Percent, ShieldCheck, TrendingUp,
} from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';
import { useBilling } from '@/context/BillingContext';
import { useEntries } from '@/context/EntriesContext';
import { getOutstandingCredits } from '@/lib/utils/formulas';

const money = (value: number) => `₦${Math.abs(value).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });
const daysSince = (value: string) => Math.max(0, Math.floor((Date.now() - new Date(`${value}T12:00:00`).getTime()) / 86400000));

type SectionProps = {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  locked?: boolean;
};

function Section({ title, description, icon, children, locked }: SectionProps) {
  const colors = useColors();
  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, opacity: locked ? 0.72 : 1 }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.iconCircle, { backgroundColor: colors.primary + '18' }]}>{icon}</View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
          <Text style={[styles.cardDescription, { color: colors.mutedForeground }]}>{description}</Text>
        </View>
        {locked && <Lock size={17} color={colors.mutedForeground} />}
      </View>
      {children}
    </View>
  );
}

function Row({ label, detail, value, color }: { label: string; detail?: string; value: string; color?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.row, { borderTopColor: colors.border }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, { color: colors.foreground }]} numberOfLines={1}>{label}</Text>
        {detail && <Text style={[styles.rowDetail, { color: colors.mutedForeground }]} numberOfLines={2}>{detail}</Text>}
      </View>
      <Text style={[styles.rowValue, { color: color ?? colors.foreground }]}>{value}</Text>
    </View>
  );
}

export default function ProToolsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { hasProAccess, billing } = useBilling();
  const { entries, products, loading } = useEntries();

  const receivables = useMemo(() => getOutstandingCredits(entries, 'sale'), [entries]);
  const payables = useMemo(() => getOutstandingCredits(entries, 'purchase'), [entries]);
  const inflows = receivables.reduce((sum, item) => sum + item.remainingBalance, 0);
  const outflows = payables.reduce((sum, item) => sum + item.remainingBalance, 0);
  const margins = useMemo(() => products.filter(p => !p.archived).map(product => {
    const cost = Math.max(0, product.costPrice || 0);
    const price = Math.max(0, product.suggestedPrice || cost * (1 + (product.markup || 0) / 100));
    const amount = price - cost;
    return { product, amount, percent: cost > 0 ? (amount / cost) * 100 : price > 0 ? 100 : 0 };
  }).sort((a, b) => a.percent - b.percent), [products]);
  const dueDate = (date: string) => {
    const due = new Date(`${date}T12:00:00`);
    due.setDate(due.getDate() + 30);
    return due;
  };

  const sendReminder = async (item: typeof receivables[number]) => {
    const phone = item.originalEntry.partyPhone?.trim();
    if (!phone) {
      Alert.alert('Phone number needed', 'Add this customer’s phone number to the debtors entry before sending a reminder.');
      return;
    }
    const customer = item.originalEntry.partyName || 'there';
    const message = `Hello ${customer}, this is a friendly reminder from ProfitNaija about your outstanding balance of ${money(item.remainingBalance)} for ${item.originalEntry.itemName || 'your purchase'}. Thank you.`;
    try {
      if (Platform.OS === 'web') {
        await Linking.openURL(`https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`);
      } else {
        await Share.share({ message, title: 'Credit payment reminder' });
      }
    } catch {
      Alert.alert('Could not open reminder', 'Please try again or copy the reminder message manually.');
    }
  };

  const goUpgrade = () => router.push('/subscribe');
  const goReports = () => router.push('/(tabs)/report');
  const goTax = () => router.push('/(tabs)/tax-center');
  const goBackup = () => router.push('/data-backup');

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={10}><ArrowLeft size={22} color="#fff" /></Pressable>
        <Text style={styles.headerTitle}>Pro Tools</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.intro, { backgroundColor: colors.primary + '12' }]}>
          <ShieldCheck size={22} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.introTitle, { color: colors.foreground }]}>{hasProAccess ? 'Your Pro business toolkit' : 'Pro tools are available with Pro'}</Text>
            <Text style={[styles.introText, { color: colors.mutedForeground }]}>
              {hasProAccess ? 'These tools use your live ledger and product data. They never change accounting records.' : billing.accessReason || 'Upgrade to Pro to unlock reminders, planning, margin checks and advanced reporting.'}
            </Text>
          </View>
        </View>

        <Section title="Credit reminders" description="Follow up on outstanding customer balances without changing the ledger." icon={<Bell size={19} color={colors.primary} />} locked={!hasProAccess}>
          {hasProAccess && (loading ? <Text style={[styles.empty, { color: colors.mutedForeground }]}>Loading debtors balances…</Text> : receivables.length === 0 ? <Text style={[styles.empty, { color: colors.mutedForeground }]}>No outstanding debtors.</Text> : receivables.map(item => {
            const entry = item.originalEntry;
            const due = dueDate(entry.date);
            const overdue = due.getTime() < Date.now();
            return <View key={entry.id} style={[styles.reminder, { borderTopColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: colors.foreground }]}>{entry.partyName || 'Customer'} · {entry.itemName || 'Debtors'}</Text>
                <Text style={[styles.rowDetail, { color: colors.mutedForeground }]}>{money(item.remainingBalance)} outstanding · {daysSince(entry.date)} days old · due {due.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' })}{entry.partyPhone ? '' : ' · Add a phone number to enable reminders'}</Text>
                <Text style={[styles.status, { color: overdue ? colors.expense : colors.primary }]}>{overdue ? 'Follow-up overdue' : 'Follow-up scheduled'}</Text>
              </View>
              <Pressable
                onPress={() => sendReminder(item)}
                disabled={!entry.partyPhone}
                style={[styles.smallButton, { backgroundColor: colors.primary, opacity: entry.partyPhone ? 1 : 0.5 }]}
                accessibilityLabel={entry.partyPhone ? `Send reminder to ${entry.partyName || 'customer'}` : `${entry.partyName || 'Customer'} has no phone number`}
              >
                <MessageCircle size={14} color="#fff" /><Text style={styles.smallButtonText}>{entry.partyPhone ? 'Remind' : 'No phone'}</Text>
              </Pressable>
            </View>;
          }))}
          {!hasProAccess && <Pressable onPress={goUpgrade} style={[styles.actionButton, { backgroundColor: colors.primary }]}><Text style={styles.actionText}>Upgrade to Pro</Text></Pressable>}
        </Section>

        <Section title="Cash-flow planning" description="A simple 30-day view of expected collections and supplier payments." icon={<DollarSign size={19} color={colors.primary} />} locked={!hasProAccess}>
          {hasProAccess && <>
            <View style={styles.summaryGrid}>
              <View><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Expected inflows</Text><Text style={[styles.summaryValue, { color: colors.primary }]}>{money(inflows)}</Text></View>
              <View><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Expected outflows</Text><Text style={[styles.summaryValue, { color: colors.expense }]}>{money(outflows)}</Text></View>
              <View><Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Net movement</Text><Text style={[styles.summaryValue, { color: inflows - outflows >= 0 ? colors.primary : colors.expense }]}>{money(inflows - outflows)}</Text></View>
            </View>
            {receivables.map(item => <Row key={`in-${item.originalEntry.id}`} label={`Collection · ${item.originalEntry.partyName || 'Customer'}`} detail={`Due ${dateLabel(item.originalEntry.date)} + 30 days`} value={`+${money(item.remainingBalance)}`} color={colors.primary} />)}
            {payables.map(item => <Row key={`out-${item.originalEntry.id}`} label={`Supplier payment · ${item.originalEntry.partyName || 'Supplier'}`} detail={`Creditors from ${dateLabel(item.originalEntry.date)}`} value={`−${money(item.remainingBalance)}`} color={colors.expense} />)}
          </>}
        </Section>

        <Section title="Margin protection" description="Spot products whose current suggested price does not protect your cost." icon={<Percent size={19} color={colors.primary} />} locked={!hasProAccess}>
          {hasProAccess && (margins.length === 0 ? <Text style={[styles.empty, { color: colors.mutedForeground }]}>Add products to see margin protection.</Text> : margins.map(({ product, amount, percent }) => {
             const healthy = amount > 0 && percent >= 15;
            return <Row key={product.id} label={product.name} detail={`Cost ${money(product.costPrice)} · Suggested ${money(product.suggestedPrice)}`} value={`${percent.toFixed(1)}% · ${healthy ? 'Healthy' : amount <= 0 ? 'Below cost' : 'Low margin'}`} color={healthy ? colors.primary : colors.expense} />;
          }))}
        </Section>

        <Section title="Advanced reports" description="Open P&L, cash flow, debtor, creditor and transaction reports." icon={<BarChart3 size={19} color={colors.primary} />} locked={!hasProAccess}>
          <Pressable onPress={hasProAccess ? goReports : goUpgrade} style={[styles.navButton, { borderColor: colors.border }]}><Text style={[styles.navText, { color: colors.foreground }]}>{hasProAccess ? 'Open Reports' : 'Upgrade to view reports'}</Text><ChevronRight size={17} color={colors.primary} /></Pressable>
        </Section>
        <Section title="Backup and export" description="Protect your records and download a copy of your business data." icon={<CloudDownload size={19} color={colors.primary} />} locked={!hasProAccess}>
          <Pressable onPress={hasProAccess ? goBackup : goUpgrade} style={[styles.navButton, { borderColor: colors.border }]}><Text style={[styles.navText, { color: colors.foreground }]}>{hasProAccess ? 'Open Data & Backup' : 'Upgrade to back up data'}</Text><ChevronRight size={17} color={colors.primary} /></Pressable>
        </Section>
        <Section title="Tax Center" description="Review VAT, withholding tax and estimated PIT." icon={<Calculator size={19} color={colors.primary} />} locked={!hasProAccess}>
          <Pressable onPress={hasProAccess ? goTax : goUpgrade} style={[styles.navButton, { borderColor: colors.border }]}><Text style={[styles.navText, { color: colors.foreground }]}>{hasProAccess ? 'Open Tax Center' : 'Upgrade to view tax reports'}</Text><ChevronRight size={17} color={colors.primary} /></Pressable>
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontFamily: 'Inter_700Bold' },
  content: { padding: 16, gap: 14 },
  intro: { flexDirection: 'row', gap: 12, padding: 15, borderRadius: 16, alignItems: 'flex-start' },
  introTitle: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  introText: { fontSize: 12.5, lineHeight: 18, marginTop: 4, fontFamily: 'Inter_400Regular' },
  card: { borderRadius: 16, borderWidth: 1, padding: 15 },
  cardHeader: { flexDirection: 'row', gap: 11, alignItems: 'center', marginBottom: 11 },
  iconCircle: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  cardDescription: { fontSize: 12, lineHeight: 17, marginTop: 2, fontFamily: 'Inter_400Regular' },
  row: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 11, gap: 10 },
  rowLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  rowDetail: { fontSize: 11.5, lineHeight: 16, marginTop: 2, fontFamily: 'Inter_400Regular' },
  rowValue: { fontSize: 13, fontFamily: 'Inter_700Bold', textAlign: 'right' },
  reminder: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 11, gap: 8 },
  status: { fontSize: 11, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
  smallButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 8, borderRadius: 9 },
  smallButtonText: { color: '#fff', fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  empty: { fontSize: 13, paddingVertical: 7, fontFamily: 'Inter_400Regular' },
  summaryGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingBottom: 8 },
  summaryLabel: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  summaryValue: { fontSize: 15, fontFamily: 'Inter_700Bold', marginTop: 4 },
  assumption: { fontSize: 11.5, lineHeight: 17, marginTop: 10, fontStyle: 'italic', fontFamily: 'Inter_400Regular' },
  actionButton: { alignItems: 'center', borderRadius: 10, paddingVertical: 12, marginTop: 5 },
  actionText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' },
  navButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 12 },
  navText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
});