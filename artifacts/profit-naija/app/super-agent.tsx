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
type SuperAgentData = {
  superAgent: null | {
    id: string; name: string; email: string; phone: string; code: string; status: 'active' | 'inactive' | 'pending';
    commissionRate: number; monthlySalaryNaira: number; monthlyTargetUsers: number; minimumWithdrawableNaira: number;
    payoutAccountName?: string; payoutAccountNumber?: string; payoutBankName?: string;
  };
  stats: null | {
    totalUsers: number; currentMonthUsers: number; currentMonthPayingUsers: number; totalCommissionNaira: number;
    availableCommissionNaira: number; availableNaira: number; currentMonthSalaryNaira: number; currentMonthOnTargetEarningNaira?: number; onTargetEarningNaira?: number; pendingPayoutNaira: number;
    salaryEarnedNaira?: number;
  };
  team: { id: string; uid: string; name: string; email: string; status: string }[];
  users: { id: string; name: string; email: string; registeredAt: string; paymentStatus: string; agentId?: string; agentName?: string; }[]; // masked users
  payouts: { id: string; amountNaira: number; status: string; requestedAt: string }[];
};

const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
function apiBase() {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/api` : null;
}

export default function SuperAgentScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { profile } = useProfile();
  const [data, setData] = useState<SuperAgentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const payoutRequestId = useRef<string | null>(null);
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
      const [teamRes, usersRes, earningsRes] = await Promise.all([
        fetch(`${base}/super-agents/me/team`, { headers: requestHeaders }),
        fetch(`${base}/super-agents/me/users`, { headers: requestHeaders }),
        fetch(`${base}/super-agents/me/earnings`, { headers: requestHeaders }),
      ]);
      const [teamBody, usersBody, earningsBody] = await Promise.all([teamRes.json(), usersRes.json(), earningsRes.json()]);
      
      if (!teamRes.ok) throw new Error(teamBody.error ?? 'Could not load super-agent team.');
      
      const combinedData: SuperAgentData = {
        superAgent: teamBody.superAgent,
        stats: earningsBody.stats ?? teamBody.stats,
        team: teamBody.team ?? [],
        users: usersBody.users ?? [],
        payouts: earningsBody.payouts ?? [],
      };
      
      setData(combinedData);
      
      if (teamBody.superAgent) {
        setForm({
          name: teamBody.superAgent.name ?? '',
          phone: teamBody.superAgent.phone ?? '',
          code: teamBody.superAgent.code ?? '',
          payoutAccountName: teamBody.superAgent.payoutAccountName ?? '',
          payoutAccountNumber: teamBody.superAgent.payoutAccountNumber ?? '',
          payoutBankName: teamBody.superAgent.payoutBankName ?? '',
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
      const res = await fetch(`${base}/agents/me`, {
        method: 'PATCH',
        headers: await headers(),
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save profile.');
      await load();
      Alert.alert('Saved', 'Profile and bank details updated.');
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const share = async () => {
    if (!data?.superAgent) return;
    await Share.share({
      message: `Join ProfitNaija with my agent code ${data.superAgent.code}. Enter it while creating your account.`,
    });
  };

  const withdraw = async () => {
    const base = apiBase();
    if (!base || !data?.stats || saving || data.stats.pendingPayoutNaira > 0) return;
    setSaving(true);
    try {
      payoutRequestId.current ??= Date.now().toString() + Math.random().toString(36).slice(2, 11);
      const res = await fetch(`${base}/super-agents/payout`, {
        method: 'POST',
        headers: await headers(),
        body: JSON.stringify({ 
          amountNaira: data.stats.availableNaira,
          requestId: payoutRequestId.current,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not request withdrawal.');
      payoutRequestId.current = null;
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
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Super-Agent Account</Text>
        <View style={styles.iconBtn} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          {!data?.superAgent || !data?.stats ? (
            <>
              <Text style={[styles.title, { color: colors.foreground }]}>Account pending</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Your super-agent account is pending activation by an administrator.</Text>
            </>
          ) : (
            <>
              <View style={[styles.codeCard, { backgroundColor: colors.primary }]}>
                <Text style={styles.codeLabel}>YOUR SUPER-AGENT CODE</Text>
                <Text style={styles.code}>{data.superAgent.code}</Text>
                <Pressable onPress={share} style={styles.shareBtn}><Share2 size={17} color={colors.primary} /><Text style={[styles.shareText, { color: colors.primary }]}>Share code</Text></Pressable>
              </View>
              <View style={styles.stats}>
                <Stat label="Network users" value={String(data.stats.totalUsers)} Icon={Users} colors={colors} />
                <Stat label="First-time network users paid this month" value={String(data.stats.currentMonthPayingUsers)} Icon={Users} colors={colors} />
                <Stat label={`Override (${data.superAgent.commissionRate}%)`} value={money(data.stats.totalCommissionNaira)} Icon={WalletCards} colors={colors} />
                <Stat label="Available" value={money(data.stats.availableNaira)} Icon={WalletCards} colors={colors} />
                <Stat label="Monthly target earned" value={money(data.stats.currentMonthOnTargetEarningNaira ?? 0)} Icon={WalletCards} colors={colors} />
              </View>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                The 10% network override is one-off on each network user’s first qualifying successful payment; renewals earn no commission. {(Math.floor(data.stats.currentMonthPayingUsers / 50) + 1) * 50 - data.stats.currentMonthPayingUsers} more first-time network-paid users are needed to reach the next ₦20,000 On-Target tier this Lagos month. Only first-time payments count. The bonus is available after the Lagos month closes; the next month starts at zero.
              </Text>
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
                <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Minimum {money(data.superAgent.minimumWithdrawableNaira)} · Pending {money(data.stats?.pendingPayoutNaira ?? 0)}</Text>
                <PrimaryButton label={data.stats?.pendingPayoutNaira ? 'Withdrawal awaiting payment' : `Withdraw ${money(data.stats?.availableNaira ?? 0)}`} loading={saving} onPress={withdraw} color={colors.primary} disabled={!!data.stats?.pendingPayoutNaira || (data.stats?.availableNaira ?? 0) < data.superAgent.minimumWithdrawableNaira} />
              </View>
              
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>TEAM ({data.team.length})</Text>
              {!data.team.length ? <Text style={[styles.empty, { color: colors.mutedForeground }]}>No agents are in your team yet.</Text> : data.team.map((item) => (
                <View key={item.id} style={[styles.userRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.userName, { color: colors.foreground }]}>{item.name}</Text>
                  <Text style={[styles.userMeta, { color: colors.mutedForeground }]}>{item.email} · {item.status}</Text>
                </View>
              ))}

              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NETWORK USERS ({data.users.length})</Text>
              {!data.users.length ? <Text style={[styles.empty, { color: colors.mutedForeground }]}>No users in network yet.</Text> : data.users.map((item) => (
                <View key={item.id} style={[styles.userRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={[styles.userName, { color: colors.foreground }]}>{item.name || item.email}</Text>
                  <Text style={[styles.userMeta, { color: colors.mutedForeground }]}>
                    {item.email} · Status: {item.paymentStatus} · {new Date(item.registeredAt).toLocaleDateString('en-NG')}
                    {item.agentName ? ` · Agent: ${item.agentName}` : ''}
                  </Text>
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