import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, Share, StyleSheet,
  Text, TextInput, View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Share2, Users, WalletCards } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { useProfile } from '@/context/ProfileContext';
import { useColors } from '@/hooks/useColors';

type Account = {
  name: string; email: string; phone?: string; code: string; status: 'active' | 'inactive';
  commissionRate: number; minimumWithdrawableNaira: number;
  payoutAccountName?: string; payoutAccountNumber?: string; payoutBankName?: string;
};
type Stats = { totalUsers: number; totalCommissionNaira: number; totalPaidNaira: number; pendingPayoutNaira: number; availableNaira: number };
type Referral = { id: string; referredEmail: string; referredName?: string; createdAt: string };
type Data = { account: Account | null; stats: Stats | null; referredUsers: Referral[] };
type AgentData = {
  agent: null | {
    id: string; name: string; email: string; phone: string; code: string; status: 'active' | 'inactive' | 'pending';
    commissionRate: number; monthlySalaryNaira: number; monthlyTargetUsers: number; minimumWithdrawableNaira: number;
    payoutAccountName?: string; payoutAccountNumber?: string; payoutBankName?: string;
  };
  stats: null | {
    currentMonthUsers: number; currentMonthPayingUsers: number; totalCommissionNaira: number;
    availableCommissionNaira: number; availableNaira: number; currentMonthSalaryNaira: number; currentMonthOnTargetEarningNaira?: number; onTargetEarningNaira?: number; pendingPayoutNaira: number;
  };
  referredUsers: Referral[];
};

const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
function apiBase() {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/api` : null;
}

export default function ReferralsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { profile } = useProfile();
  const [data, setData] = useState<Data | null>(null);
  const [agentData, setAgentData] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: profile.fullName || user?.displayName || '',
    phone: profile.phone || '',
    code: '',
    payoutAccountName: '',
    payoutAccountNumber: '',
    payoutBankName: '',
  });

  const headers = useCallback(async () => {
    const token = await user?.getIdToken();
    if (!token) throw new Error('You must be signed in.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [user]);

  const load = useCallback(async () => {
    const base = apiBase();
    if (!base || !user) return;
    setLoading(true);
    try {
      const requestHeaders = await headers();
      const [res, agentRes] = await Promise.all([
        fetch(`${base}/referrals/me`, { headers: requestHeaders }),
        fetch(`${base}/agents/me`, { headers: requestHeaders }),
      ]);
      const [body, agentBody] = await Promise.all([res.json(), agentRes.json()]);
      if (!res.ok) throw new Error(body.error ?? 'Could not load referral account.');
      if (!agentRes.ok) throw new Error(agentBody.error ?? 'Could not load agent account.');
      setData(body);
      setAgentData(agentBody);
      if (body.account) {
        setForm({
          name: body.account.name ?? '',
          phone: body.account.phone ?? '',
          code: body.account.code ?? '',
          payoutAccountName: body.account.payoutAccountName ?? '',
          payoutAccountNumber: body.account.payoutAccountNumber ?? '',
          payoutBankName: body.account.payoutBankName ?? '',
        });
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }, [headers, user]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const save = async () => {
    const base = apiBase();
    if (!base || !form.name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${base}/referrals/account`, {
        method: data?.account ? 'PATCH' : 'POST',
        headers: await headers(),
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save referral account.');
      await load();
      Alert.alert('Saved', data?.account ? 'Referral profile updated.' : 'Referral account created.');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const share = async () => {
    if (!data?.account) return;
    await Share.share({
      message: `Join ProfitNaija with my referral code ${data.account.code}. Enter it while creating your account.`,
    });
  };

  const withdraw = async () => {
    const base = apiBase();
    if (!base || !data?.stats) return;
    setSaving(true);
    try {
      const res = await fetch(`${base}/referrals/payout`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ amountNaira: data.stats.availableNaira }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not request withdrawal.');
      await load();
      Alert.alert('Withdrawal requested', 'The admin can now review and pay your request.');
    } catch (error: any) {
      Alert.alert('Withdrawal unavailable', error.message);
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}><ArrowLeft size={22} color={colors.foreground} /></Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Referral Account</Text>
        <View style={styles.iconBtn} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          {agentData?.agent && agentData.stats ? (
            <AgentDashboardMobile data={agentData as AgentData & { agent: NonNullable<AgentData['agent']>; stats: NonNullable<AgentData['stats']> }} headers={headers} reload={load} colors={colors} />
          ) : !data?.account ? (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Create a Referral Account</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Earn 10% of every successful monthly subscription paid by users who join with your code. Withdraw from ₦6,000.</Text>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Field label="Full Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} colors={colors} />
                <Field label="Phone Number" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} colors={colors} />
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your referral code will be generated automatically.</Text>
                <PrimaryButton label="Create Referral Account" loading={saving} onPress={save} color={colors.primary} />
              </View>
            </>
          ) : (
            <>
              <View style={[styles.codeCard, { backgroundColor: colors.primary }]}>
                <Text style={styles.codeLabel}>YOUR REFERRAL CODE</Text>
                <Text style={styles.code}>{data.account.code}</Text>
                <Pressable onPress={share} style={styles.shareBtn}><Share2 size={17} color={colors.primary} /><Text style={[styles.shareText, { color: colors.primary }]}>Share code</Text></Pressable>
              </View>
              <View style={styles.stats}>
                <Stat label="Users referred" value={String(data.stats?.totalUsers ?? 0)} Icon={Users} colors={colors} />
                <Stat label={`Commission (${data.account.commissionRate}%)`} value={money(data.stats?.totalCommissionNaira ?? 0)} Icon={WalletCards} colors={colors} />
                <Stat label="Available" value={money(data.stats?.availableNaira ?? 0)} Icon={WalletCards} colors={colors} />
                <Stat label="Paid out" value={money(data.stats?.totalPaidNaira ?? 0)} Icon={WalletCards} colors={colors} />
              </View>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Profile and payout details</Text>
                <Field label="Full Name" value={form.name} onChange={(v) => setForm({ ...form, name: v })} colors={colors} />
                <Field label="Phone Number" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} colors={colors} />
                <Field label="Account Name" value={form.payoutAccountName} onChange={(v) => setForm({ ...form, payoutAccountName: v })} colors={colors} />
                <Field label="Account Number" value={form.payoutAccountNumber} onChange={(v) => setForm({ ...form, payoutAccountNumber: v })} colors={colors} />
                <Field label="Bank Name" value={form.payoutBankName} onChange={(v) => setForm({ ...form, payoutBankName: v })} colors={colors} />
                <PrimaryButton label="Save Profile" loading={saving} onPress={save} color={colors.primary} />
              </View>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Withdrawal</Text>
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Minimum {money(data.account.minimumWithdrawableNaira)} · Pending {money(data.stats?.pendingPayoutNaira ?? 0)}</Text>
                <PrimaryButton label={data.stats?.pendingPayoutNaira ? 'Withdrawal awaiting payment' : `Withdraw ${money(data.stats?.availableNaira ?? 0)}`} loading={saving} onPress={withdraw} color={colors.primary} disabled={!!data.stats?.pendingPayoutNaira || (data.stats?.availableNaira ?? 0) < data.account.minimumWithdrawableNaira} />
              </View>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>REFERRED USERS</Text>
              {!data.referredUsers.length ? <Text style={[styles.empty, { color: colors.mutedForeground }]}>No users have joined with your code yet.</Text> : data.referredUsers.map((item) => (
                <View key={item.id} style={[styles.userRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.userName, { color: colors.foreground }]}>{item.referredName || item.referredEmail}</Text>
                  <Text style={[styles.userMeta, { color: colors.mutedForeground }]}>{item.referredEmail} · {new Date(item.createdAt).toLocaleDateString('en-NG')}</Text>
                </View>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Field({ label, value, onChange, colors }: { label: string; value: string; onChange: (value: string) => void; colors: any }) {
  return <View style={styles.field}><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text><TextInput value={value} onChangeText={onChange} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} placeholderTextColor={colors.mutedForeground} /></View>;
}
function PrimaryButton({ label, loading, onPress, color, disabled }: { label: string; loading: boolean; onPress: () => void; color: string; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={loading || disabled} style={[styles.primary, { backgroundColor: color, opacity: loading || disabled ? 0.45 : 1 }]}>{loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>{label}</Text>}</Pressable>;
}
function Stat({ label, value, Icon, colors }: { label: string; value: string; Icon: any; colors: any }) {
  return <View style={[styles.stat, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.statHead}><Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text><Icon size={15} color={colors.primary} /></View><Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text></View>;
}
function AgentDashboardMobile({ data, headers, reload, colors }: { data: AgentData & { agent: NonNullable<AgentData['agent']>; stats: NonNullable<AgentData['stats']> }; headers: () => Promise<Record<string, string>>; reload: () => Promise<void>; colors: any }) {
  const { agent, stats } = data;
  const [saving, setSaving] = useState(false);
  const payoutRequestId = useRef<string | null>(null);
  const [bank, setBank] = useState({
    phone: agent.phone ?? '',
    payoutAccountName: agent.payoutAccountName ?? '',
    payoutAccountNumber: agent.payoutAccountNumber ?? '',
    payoutBankName: agent.payoutBankName ?? '',
  });
  const currentOnTarget = stats.currentMonthOnTargetEarningNaira ?? 0;
  const nextTierUsers = (Math.floor(stats.currentMonthPayingUsers / 50) + 1) * 50;
  const usersToNextTier = nextTierUsers - stats.currentMonthPayingUsers;
  const saveBank = async () => {
    const base = apiBase();
    if (!base) return;
    setSaving(true);
    try {
      const response = await fetch(`${base}/agents/me`, { method: 'PATCH', headers: await headers(), body: JSON.stringify(bank) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not save bank details.');
      await reload();
      Alert.alert('Saved', 'Your bank details are ready for manual payment.');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };
  const withdraw = async () => {
    const base = apiBase();
    if (!base || saving || stats.pendingPayoutNaira > 0) return;
    setSaving(true);
    try {
      payoutRequestId.current ??= Date.now().toString() + Math.random().toString(36).slice(2, 11);
      const response = await fetch(`${base}/agents/payout`, { method: 'POST', headers: await headers(), body: JSON.stringify({ amountNaira: stats.availableNaira, requestId: payoutRequestId.current }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Could not request withdrawal.');
      payoutRequestId.current = null;
      await reload();
      Alert.alert('Request submitted', 'The admin will pay your available earnings manually using your bank details.');
    } catch (error: any) {
      Alert.alert('Withdrawal unavailable', error.message);
      await reload();
    } finally {
      setSaving(false);
    }
  };
  return <>
    <View style={[styles.codeCard, { backgroundColor: colors.primary }]}>
      <Text style={styles.codeLabel}>AUTOMATIC AGENT CODE</Text><Text style={styles.code}>{agent.code}</Text>
      <Pressable onPress={() => Share.share({ message: `Join ProfitNaija with my agent code ${agent.code}.` })} style={styles.shareBtn}><Share2 size={17} color={colors.primary} /><Text style={[styles.shareText, { color: colors.primary }]}>Share code</Text></Pressable>
    </View>
    <View style={styles.stats}>
      <Stat label="Registered this month" value={String(stats.currentMonthUsers)} Icon={Users} colors={colors} />
      <Stat label="First-time paid this month" value={`${stats.currentMonthPayingUsers}/${agent.monthlyTargetUsers}`} Icon={Users} colors={colors} />
      <Stat label="Available commission" value={money(stats.availableCommissionNaira)} Icon={WalletCards} colors={colors} />
      <Stat label="On-target bonus" value={currentOnTarget ? money(currentOnTarget) : 'Not reached'} Icon={WalletCards} colors={colors} />
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
        Earn 20% commission once on each referral’s first successful payment; renewals do not count. {usersToNextTier} more first-time paid referrals reach the next ₦30,000 On-target bonus ({nextTierUsers} users) this month. The On-target bonus is withdrawable after month-end; the count resets monthly.
      </Text>
    </View>
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>Bank details for manual payment</Text>
      <Field label="Phone Number" value={bank.phone} onChange={(v) => setBank({ ...bank, phone: v })} colors={colors} />
      <Field label="Account Name" value={bank.payoutAccountName} onChange={(v) => setBank({ ...bank, payoutAccountName: v })} colors={colors} />
      <Field label="Account Number" value={bank.payoutAccountNumber} onChange={(v) => setBank({ ...bank, payoutAccountNumber: v })} colors={colors} />
      <Field label="Bank Name" value={bank.payoutBankName} onChange={(v) => setBank({ ...bank, payoutBankName: v })} colors={colors} />
      <PrimaryButton label="Save Bank Details" loading={saving} onPress={saveBank} color={colors.primary} />
    </View>
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.foreground }]}>Available earnings</Text>
      <Text style={[styles.title, { color: colors.foreground }]}>{money(stats.availableNaira)}</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Includes commissions and On-target bonuses from completed months. Withdraw once available earnings reach {money(agent.minimumWithdrawableNaira)}. Pending: {money(stats.pendingPayoutNaira)}</Text>
      <PrimaryButton label={stats.pendingPayoutNaira > 0 ? 'Withdrawal awaiting payment' : 'Request Earnings Withdrawal'} loading={saving} onPress={withdraw} color={colors.primary} disabled={stats.pendingPayoutNaira > 0 || stats.availableNaira < agent.minimumWithdrawableNaira} />
    </View>
  </>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  title: { fontSize: 25, fontFamily: 'Inter_700Bold', marginTop: 8 }, subtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19, marginTop: 6 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 16, gap: 13 }, cardTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  field: { gap: 6 }, label: { fontSize: 12, fontFamily: 'Inter_500Medium' }, input: { height: 46, borderWidth: 1, borderRadius: 11, paddingHorizontal: 12, fontSize: 14, fontFamily: 'Inter_400Regular' },
  primary: { height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 2 }, primaryText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  codeCard: { borderRadius: 18, padding: 22, alignItems: 'center' }, codeLabel: { color: 'rgba(255,255,255,.7)', fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 1 },
  code: { color: '#fff', fontSize: 28, fontFamily: 'Inter_700Bold', letterSpacing: 3, marginVertical: 10 }, shareBtn: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 7 }, shareText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }, stat: { width: '48%', borderWidth: 1, borderRadius: 13, padding: 12 }, statHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular' }, statValue: { fontSize: 17, fontFamily: 'Inter_700Bold', marginTop: 6 },
  sectionLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: .8, marginTop: 22, marginBottom: 8 }, empty: { textAlign: 'center', paddingVertical: 24, fontSize: 13 },
  userRow: { borderWidth: 1, borderRadius: 12, padding: 13, marginBottom: 9 }, userName: { fontSize: 14, fontFamily: 'Inter_600SemiBold' }, userMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 3 },
});