import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Modal, TouchableOpacity,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, BadgePercent, CheckCircle2, Users, ChevronDown, X } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

type Agent = {
  id: string; uid: string; name: string; email: string; phone: string; code: string; status: 'active' | 'inactive';
  role: 'agent' | 'super_agent'; superAgentId?: string;
  monthlySalaryNaira: number; monthlyTargetUsers: number; minimumWithdrawableNaira: number;
  stats: { totalUsers: number; currentMonthUsers: number; currentMonthPayingUsers: number; totalCommissionNaira: number; salaryEarnedNaira: number; onTargetEarningNaira?: number; currentMonthOnTargetEarningNaira?: number; availableNaira: number };
};
type SuperAgent = {
  id: string; uid: string; name: string; email: string; phone: string; code: string; status: 'active' | 'inactive';
  stats: { totalUsers: number; currentMonthUsers: number; currentMonthPayingUsers: number; totalCommissionNaira: number; salaryEarnedNaira: number; onTargetEarningNaira?: number; currentMonthOnTargetEarningNaira?: number; availableNaira: number };
  team: { id: string; uid: string; name: string; email: string; status: string }[];
};
type ReferralAccount = {
  uid: string; name: string; email: string; code: string; status: 'active' | 'inactive'; commissionRate: number;
  minimumWithdrawableNaira: number; stats: { totalUsers: number; totalEarnedNaira: number; totalPaidNaira: number; availableNaira: number };
};
type Payout = { id: string; beneficiaryId: string; beneficiaryType: 'agent' | 'referral'; amountNaira: number; status: string; requestedAt: string; beneficiary?: { name: string; email: string; phone?: string; bankName?: string; accountName?: string; accountNumber?: string } };

const emptyAgent = (mode: string) => ({
  name: '', email: '', phone: '', code: '', monthlySalaryNaira: mode === 'super-agents' ? '20000' : '30000',
  monthlyTargetUsers: '50', minimumWithdrawableNaira: '6000', role: mode === 'super-agents' ? 'super_agent' : 'agent',
});
const money = (value: number) => `₦${value.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
function baseUrl() {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/api` : null;
}

export default function AdminPartnersScreen() {
  const { section } = useLocalSearchParams<{ section?: string }>();
  const mode = section === 'referrals' ? 'referrals' : section === 'super-agents' ? 'super-agents' : 'agents';
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [superAgents, setSuperAgents] = useState<SuperAgent[]>([]);
  const [accounts, setAccounts] = useState<ReferralAccount[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [agentForm, setAgentForm] = useState(() => emptyAgent(mode));
  const [assignModalVisible, setAssignModalVisible] = useState(false);
  const [assignAgentTarget, setAssignAgentTarget] = useState<Agent | null>(null);
  const [sendingInviteId, setSendingInviteId] = useState<string | null>(null);

  useEffect(() => {
    const adminEmail = (process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? '').toLowerCase();
    if (user && (!adminEmail || user.email?.toLowerCase() !== adminEmail)) router.replace('/profile');
  }, [user]);

  const headers = useCallback(async () => {
    const token = await user?.getIdToken();
    if (!token) throw new Error('Not signed in.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [user]);

  const load = useCallback(async () => {
    const base = baseUrl();
    if (!base || !user) return;
    setLoading(true);
    try {
      const res = await fetch(`${base}/admin/${mode}`, { headers: await headers() });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not load data.');
      if (mode === 'agents') setAgents(body.agents ?? []);
      else if (mode === 'super-agents') setSuperAgents(body.superAgents ?? []);
      else {
        setAccounts(body.accounts ?? []);
        setPayouts(body.payoutRequests ?? []);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }, [headers, mode, user]);
  useEffect(() => { load(); }, [load]);

  const saveAgent = async () => {
    const base = baseUrl();
    if (!base) return;
    setSaving(true);
    try {
      const res = await fetch(`${base}/admin/agents${editingId ? `/${editingId}` : ''}`, {
        method: editingId ? 'PATCH' : 'POST',
        headers: await headers(),
        body: JSON.stringify({
          ...agentForm,
          role: mode === 'super-agents' ? 'super_agent' : agentForm.role,
          monthlySalaryNaira: Number(agentForm.monthlySalaryNaira),
          monthlyTargetUsers: Number(agentForm.monthlyTargetUsers),
          minimumWithdrawableNaira: Number(agentForm.minimumWithdrawableNaira),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not save agent.');
      if (!editingId && mode === 'super-agents') {
        Alert.alert(
          body.invitationEmailSent ? 'Super agent created' : 'Super agent created',
          body.invitationEmailSent
            ? `An account setup invitation was sent to ${agentForm.email}.`
            : 'The account was created, but the invitation email was not sent. Use Resend invitation.',
        );
      }
      setAgentForm(emptyAgent(mode));
      setEditingId(null);
      await load();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const resendInvitation = async (agent: SuperAgent) => {
    const base = baseUrl();
    if (!base) return;
    setSendingInviteId(agent.id);
    try {
      const res = await fetch(`${base}/admin/agents/${agent.id}/invitation`, {
        method: 'POST',
        headers: await headers(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not send the invitation.');
      Alert.alert('Invitation sent', body.message ?? `Invitation sent to ${agent.email}.`);
      await load();
    } catch (error: any) {
      Alert.alert('Invitation failed', error.message);
    } finally {
      setSendingInviteId(null);
    }
  };

  const editAgent = (agent: Agent | SuperAgent) => {
    setEditingId(agent.id);
    setAgentForm({
      name: agent.name, email: agent.email, phone: agent.phone, code: agent.code, role: 'role' in agent ? agent.role : 'super_agent',
      monthlySalaryNaira: String('monthlySalaryNaira' in agent ? agent.monthlySalaryNaira : 'role' in agent ? 30000 : 20000),
      monthlyTargetUsers: String('monthlyTargetUsers' in agent ? agent.monthlyTargetUsers : 50), minimumWithdrawableNaira: String('minimumWithdrawableNaira' in agent ? agent.minimumWithdrawableNaira : 6000),
    });
  };

  const assignSuperAgent = async (agentId: string, superAgentId: string | null) => {
    const base = baseUrl();
    if (!base) return;
    setSaving(true);
    try {
      const res = await fetch(`${base}/admin/agents/${agentId}/super-agent`, { method: 'POST', headers: await headers(), body: JSON.stringify({ superAgentId }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not assign super-agent.');
      setAssignModalVisible(false);
      setAssignAgentTarget(null);
      await load();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const patch = async (path: string, body?: object) => {
    const base = baseUrl();
    if (!base) return;
    setSaving(true);
    try {
      const res = await fetch(`${base}${path}`, { method: path.includes('mark-paid') ? 'POST' : 'PATCH', headers: await headers(), body: body ? JSON.stringify(body) : undefined });
      const response = await res.json();
      if (!res.ok) throw new Error(response.error ?? 'Could not update.');
      await load();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setSaving(false);
    }
  };

  const superAgentList = agents.filter(a => a.role === 'super_agent');

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: insets.top + 10, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={styles.back}><ArrowLeft size={22} color={colors.foreground} /></Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>{mode === 'agents' ? 'Agent Management' : mode === 'super-agents' ? 'Super-Agent Management' : 'Referral Management'}</Text>
        <View style={styles.back} />
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }} keyboardShouldPersistTaps="handled">
          {mode === 'agents' || mode === 'super-agents' ? (
            <>
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.title, { color: colors.foreground }]}>{editingId ? `Edit ${agentForm.role.replace('_', '-')} profile` : `Create ${mode.slice(0, -1)} profile`}</Text>
                <Text style={[styles.note, { color: colors.mutedForeground }]}>{mode === 'super-agents' ? '10% network override, one-off on each network user’s first qualifying successful payment; no renewal commissions. ₦20,000 On-Target bonus per 50 first-time network-paid users in each Lagos month; available after the month closes, then the next month starts at zero.' : '20% direct commission, one-off on each referred user’s first qualifying successful payment; no renewal commissions. ₦30,000 On-Target bonus per 50 first-time direct-paid users in each Lagos month; available after the month closes, then the next month starts at zero.'}</Text>
                <AgentField label="Full Name" value={agentForm.name} set={(v) => setAgentForm({ ...agentForm, name: v })} colors={colors} />
                <AgentField label="Email" value={agentForm.email} set={(v) => setAgentForm({ ...agentForm, email: v })} colors={colors} />
                <AgentField label="Phone" value={agentForm.phone} set={(v) => setAgentForm({ ...agentForm, phone: v })} colors={colors} />
                <AgentField label="Code (optional)" value={agentForm.code} set={(v) => setAgentForm({ ...agentForm, code: v.toUpperCase() })} colors={colors} />
                {mode === 'agents' && (
                  <>
                  <AgentField label="Role" value={agentForm.role} set={(v) => setAgentForm({ ...agentForm, role: v })} colors={colors} />
                  <Text style={[styles.note, { color: colors.mutedForeground, marginTop: -4 }]}>Valid roles: "agent" or "super_agent"</Text>
                  </>
                )}
                <View style={styles.two}>
                  <AgentField label="Min. Withdrawal" value={agentForm.minimumWithdrawableNaira} set={(v) => setAgentForm({ ...agentForm, minimumWithdrawableNaira: v })} colors={colors} compact />
                </View>
                <View style={styles.two}>
                  <Text style={[styles.note, { color: colors.mutedForeground }]}>On-Target Earnings: {mode === 'super-agents' ? '₦20,000 per 50 first-time network-paid users' : '₦30,000 per 50 first-time direct-paid users'} each Lagos month. Renewals do not count. The bonus is available after the month closes; the next month starts at zero.</Text>
                </View>
                <Pressable onPress={saveAgent} disabled={saving} style={[styles.primary, { backgroundColor: colors.primary, opacity: saving ? .5 : 1 }]}><Text style={styles.primaryText}>{editingId ? 'Save Profile' : 'Create Profile'}</Text></Pressable>
              </View>
              {mode === 'agents' ? (
                <>
                  <Text style={[styles.section, { color: colors.mutedForeground }]}>AGENTS ({agents.length})</Text>
                  {agents.map((agent) => (
                    <View key={agent.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.row}><View style={styles.flex}><Text style={[styles.title, { color: colors.foreground }]}>{agent.name}</Text><Text style={[styles.note, { color: colors.mutedForeground }]}>{agent.email} · {agent.phone}</Text></View><Text style={[styles.code, { color: colors.primary }]}>{agent.code}</Text></View>
                      <View style={styles.metrics}><Metric label="Users" value={String(agent.stats.totalUsers)} colors={colors} /><Metric label="First-time paid this month" value={String(agent.stats.currentMonthPayingUsers)} colors={colors} /><Metric label="Commission" value={money(agent.stats.totalCommissionNaira)} colors={colors} /><Metric label="On-Target Earned" value={money(agent.stats.onTargetEarningNaira ?? agent.stats.salaryEarnedNaira)} colors={colors} /><Metric label="Pending this month" value={money(agent.stats.currentMonthOnTargetEarningNaira ?? 0)} colors={colors} /><Metric label="Available" value={money(agent.stats.availableNaira)} colors={colors} /></View>

                      {agent.role === 'agent' && (
                        <View style={{ marginTop: 10, gap: 5 }}>
                          <Text style={[styles.label, { color: colors.mutedForeground }]}>Assigned Super-Agent</Text>
                          <Pressable
                            onPress={() => { setAssignAgentTarget(agent); setAssignModalVisible(true); }}
                            style={[styles.input, { justifyContent: 'center', borderColor: colors.border, backgroundColor: colors.background }]}
                          >
                            <View style={styles.row}>
                              <Text style={{ color: superAgentList.find(sa => sa.id === agent.superAgentId) ? colors.foreground : colors.mutedForeground }}>
                                {superAgentList.find(sa => sa.id === agent.superAgentId) ? `${superAgentList.find(sa => sa.id === agent.superAgentId)?.name} (${superAgentList.find(sa => sa.id === agent.superAgentId)?.email})` : 'None assigned'}
                              </Text>
                              <ChevronDown size={16} color={colors.mutedForeground} />
                            </View>
                          </Pressable>
                        </View>
                      )}

                       <View style={styles.actions}><Pressable onPress={() => editAgent(agent)} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>Edit profile</Text></Pressable><Pressable onPress={() => patch(`/admin/agents/${agent.id}`, { status: agent.status === 'active' ? 'inactive' : 'active' })} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>{agent.status === 'active' ? 'Deactivate' : 'Activate'}</Text></Pressable></View>
                    </View>
                  ))}
                </>
              ) : (
                <>
                  <Text style={[styles.section, { color: colors.mutedForeground }]}>SUPER-AGENTS ({superAgents.length})</Text>
                  {superAgents.map((agent) => (
                    <View key={agent.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      <View style={styles.row}><View style={styles.flex}><Text style={[styles.title, { color: colors.foreground }]}>{agent.name}</Text><Text style={[styles.note, { color: colors.mutedForeground }]}>{agent.email} · {agent.phone}</Text><Text style={[styles.note, { color: colors.foreground }]}>ID: {agent.id}</Text></View><Text style={[styles.code, { color: colors.primary }]}>{agent.code}</Text></View>
                      <View style={styles.metrics}><Metric label="Network users" value={String(agent.stats.totalUsers)} colors={colors} /><Metric label="First-time network-paid this month" value={String(agent.stats.currentMonthPayingUsers)} colors={colors} /><Metric label="Override Comm." value={money(agent.stats.totalCommissionNaira)} colors={colors} /><Metric label="Network Target Earned" value={money(agent.stats.onTargetEarningNaira ?? agent.stats.salaryEarnedNaira)} colors={colors} /><Metric label="Pending month-end" value={money(agent.stats.currentMonthOnTargetEarningNaira ?? 0)} colors={colors} /><Metric label="Available" value={money(agent.stats.availableNaira)} colors={colors} /></View>
                      {agent.team && agent.team.length > 0 && (
                        <View style={{ marginTop: 8 }}>
                          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: 'Inter_600SemiBold' }]}>Assigned Team ({agent.team.length})</Text>
                          {agent.team.map(member => (
                            <Text key={member.id} style={[styles.note, { color: colors.foreground }]}>• {member.name} ({member.email})</Text>
                          ))}
                        </View>
                      )}
                       <View style={styles.actions}><Pressable disabled={sendingInviteId === agent.id} onPress={() => resendInvitation(agent)} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>{sendingInviteId === agent.id ? 'Sending…' : 'Resend invitation'}</Text></Pressable><Pressable onPress={() => editAgent(agent)} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>Edit profile</Text></Pressable><Pressable onPress={() => patch(`/admin/agents/${agent.id}`, { status: agent.status === 'active' ? 'inactive' : 'active' })} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>{agent.status === 'active' ? 'Deactivate' : 'Activate'}</Text></Pressable></View>
                    </View>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
              <Text style={[styles.section, { color: colors.mutedForeground }]}>PENDING WITHDRAWALS</Text>
              {payouts.filter((item) => item.status === 'pending').map((item) => {
                return <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><Text style={[styles.title, { color: colors.foreground }]}>{item.beneficiary?.name ?? 'Partner'} ({item.beneficiaryType})</Text><Text style={[styles.note, { color: colors.mutedForeground }]}>{item.beneficiary?.email} · {money(item.amountNaira)} · {new Date(item.requestedAt).toLocaleDateString('en-NG')}</Text><Text style={[styles.note, { color: colors.foreground }]}>{item.beneficiary?.bankName && item.beneficiary?.accountNumber ? `${item.beneficiary.bankName} · ${item.beneficiary.accountNumber} · ${item.beneficiary.accountName ?? ''}` : 'Bank details not provided'}</Text>{item.beneficiary?.phone && <Text style={[styles.note, { color: colors.mutedForeground }]}>{item.beneficiary.phone}</Text>}<Pressable onPress={() => patch(`/admin/payouts/${item.id}/mark-paid`)} style={[styles.primary, { backgroundColor: colors.primary }]}><CheckCircle2 size={16} color="#fff" /><Text style={styles.primaryText}>Mark Paid</Text></Pressable></View>;
              })}
              <Text style={[styles.section, { color: colors.mutedForeground }]}>REFERRAL ACCOUNTS ({accounts.length})</Text>
              {accounts.map((account) => <View key={account.uid} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.row}><View style={styles.flex}><Text style={[styles.title, { color: colors.foreground }]}>{account.name}</Text><Text style={[styles.note, { color: colors.mutedForeground }]}>{account.email}</Text></View><Text style={[styles.code, { color: colors.primary }]}>{account.code}</Text></View><View style={styles.metrics}><Metric label="Users" value={String(account.stats.totalUsers)} colors={colors} /><Metric label="Earned" value={money(account.stats.totalEarnedNaira)} colors={colors} /><Metric label="Paid" value={money(account.stats.totalPaidNaira)} colors={colors} /><Metric label="Available" value={money(account.stats.availableNaira)} colors={colors} /></View><Pressable onPress={() => patch(`/admin/referrals/${account.uid}/status`, { status: account.status === 'active' ? 'inactive' : 'active' })} style={[styles.outline, { borderColor: colors.border }]}><Text style={{ color: colors.foreground }}>{account.status === 'active' ? 'Deactivate' : 'Activate'}</Text></Pressable></View>)}
            </>
          )}
        </ScrollView>
      )}
      {/* Assignment Modal */}
      <Modal visible={assignModalVisible} transparent animationType="slide" onRequestClose={() => setAssignModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.title, { color: colors.foreground }]}>Assign Super-Agent</Text>
              <Pressable onPress={() => setAssignModalVisible(false)}><X size={24} color={colors.foreground} /></Pressable>
            </View>
            <Text style={[styles.note, { color: colors.mutedForeground, marginBottom: 16 }]}>Select a super-agent for {assignAgentTarget?.name}</Text>

            <ScrollView style={{ maxHeight: 400 }}>
              <TouchableOpacity
                style={[styles.modalOption, { borderBottomColor: colors.border }]}
                onPress={() => assignAgentTarget && assignSuperAgent(assignAgentTarget.id, null)}
              >
                <Text style={{ color: colors.foreground, fontSize: 16 }}>None (Remove assignment)</Text>
              </TouchableOpacity>
              {superAgentList.map(sa => (
                <TouchableOpacity
                  key={sa.id}
                  style={[styles.modalOption, { borderBottomColor: colors.border }]}
                  onPress={() => assignAgentTarget && assignSuperAgent(assignAgentTarget.id, sa.id)}
                >
                  <Text style={{ color: colors.foreground, fontSize: 16 }}>{sa.name}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{sa.email}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function AgentField({ label, value, set, colors, compact }: { label: string; value: string; set: (value: string) => void; colors: any; compact?: boolean }) { return <View style={[styles.field, compact && styles.flex]}><Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text><TextInput value={value} onChangeText={set} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} /></View>; }
function Metric({ label, value, colors }: { label: string; value: string; colors: any }) { return <View style={[styles.metric, { backgroundColor: colors.background }]}><Text style={[styles.metricLabel, { color: colors.mutedForeground }]}>{label}</Text><Text style={[styles.metricValue, { color: colors.foreground }]}>{value}</Text></View>; }
const styles = StyleSheet.create({
  screen: { flex: 1 }, center: { flex: 1, alignItems: 'center', justifyContent: 'center' }, header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  card: { borderWidth: 1, borderRadius: 15, padding: 15, gap: 12, marginBottom: 12 }, title: { fontSize: 16, fontFamily: 'Inter_600SemiBold' }, note: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  field: { gap: 5 }, label: { fontSize: 11, fontFamily: 'Inter_500Medium' }, input: { borderWidth: 1, height: 43, borderRadius: 10, paddingHorizontal: 11, fontSize: 13 }, two: { flexDirection: 'row', gap: 10 }, flex: { flex: 1 },
  primary: { minHeight: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 }, primaryText: { color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  section: { fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: .8, marginVertical: 10 }, row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 }, code: { fontSize: 12, fontFamily: 'Inter_700Bold', letterSpacing: 1 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, metric: { width: '48%', borderRadius: 9, padding: 9 }, metricLabel: { fontSize: 10 }, metricValue: { fontSize: 13, fontFamily: 'Inter_600SemiBold', marginTop: 3 },
  actions: { flexDirection: 'row', gap: 8 }, outline: { minHeight: 40, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalOption: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
});