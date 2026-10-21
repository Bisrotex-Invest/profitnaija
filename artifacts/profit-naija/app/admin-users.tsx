import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, KeyRound, Search, ShieldCheck, Trash2, UserCheck, Users, X } from 'lucide-react-native';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

type Grant = { type?: string };
type DirectoryUser = { uid: string; email: string; name: string; phone: string; emailVerified: boolean; disabled: boolean; state: string; paymentSource: 'paystack' | 'google_play' | null; hasAccess: boolean; hasGrant: boolean; grant: Grant | null };
type Analytics = { total: number; active: number; paid: number; googlePlayPaid: number; verified: number; verifiedRevenue: number; needsPaymentAccess: number; lastPaystackSync?: string | null; lastGooglePlaySync?: string | null };
type PaystackSyncResult = { scanned: number; imported: number; alreadyRecorded: number; rejected: number; pages: number; syncedAt: string };
const apiBase = () => process.env.EXPO_PUBLIC_DOMAIN ? `https://${process.env.EXPO_PUBLIC_DOMAIN}/api` : null;
const val = (o: any, ...keys: string[]) => keys.map(k => o?.[k]).find(v => v !== undefined && v !== null);
const normalUser = (r: any): DirectoryUser => ({ uid: String(val(r, 'uid', 'id', 'userId') ?? ''), email: String(r?.email ?? ''), name: String(val(r, 'name', 'displayName', 'fullName') ?? 'Unnamed user'), phone: String(val(r, 'phone', 'phoneNumber') ?? '—'), emailVerified: Boolean(val(r, 'emailVerified', 'verified')), disabled: Boolean(r?.disabled), state: String(r?.subscriptionStatus ?? 'inactive'), paymentSource: r?.paymentSource === 'google_play' ? 'google_play' : r?.paymentSource === 'paystack' ? 'paystack' : null, hasAccess: Boolean(r?.active), hasGrant: Boolean(r?.hasFreeGrant), grant: r?.grant ?? null });
const suggestedPassword = () => `Pn!${Math.random().toString(36).slice(2, 9)}A9#${Math.random().toString(36).slice(2, 7)}`;
function editablePhone(value: string): string | null {
  const phone = value.trim().replace(/[()\s-]/g, '');
  if (!phone) return null;
  const normalized = /^0[789]\d{9}$/.test(phone) ? `+234${phone.slice(1)}` : /^234[789]\d{9}$/.test(phone) ? `+${phone}` : phone;
  if (!/^\+[1-9]\d{6,14}$/.test(normalized)) throw new Error('Enter a phone number with a country code, such as +2348012345678.');
  return normalized;
}

export default function AdminUsersScreen() {
  const colors = useColors(); const insets = useSafeAreaInsets(); const { user } = useAuth();
  const [users, setUsers] = useState<DirectoryUser[]>([]); const [stats, setStats] = useState<Analytics>({ total: 0, active: 0, paid: 0, googlePlayPaid: 0, verified: 0, verifiedRevenue: 0, needsPaymentAccess: 0, lastPaystackSync: null });
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all'); const [token, setToken] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [more, setMore] = useState(false); const [error, setError] = useState('');
  const [selected, setSelected] = useState<DirectoryUser | null>(null); const [draft, setDraft] = useState({ name: '', email: '', phone: '' }); const [saving, setSaving] = useState(false); const [grantType, setGrantType] = useState<'lifetime' | 'trial'>('lifetime'); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  const [syncingPaystack, setSyncingPaystack] = useState(false); const [paystackSyncError, setPaystackSyncError] = useState(''); const [paystackSyncResult, setPaystackSyncResult] = useState<PaystackSyncResult | null>(null);
  const [syncingPlay, setSyncingPlay] = useState(false); const [playProgress, setPlayProgress] = useState(''); const [playSyncError, setPlaySyncError] = useState('');
  useEffect(() => { const adminEmail = (process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? '').toLowerCase(); if (user && (!adminEmail || user.email?.toLowerCase() !== adminEmail)) router.replace('/profile'); }, [user]);
  const headers = useCallback(async () => { const t = await user?.getIdToken(); if (!t) throw new Error('Not signed in.'); return { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' }; }, [user]);
  const load = useCallback(async (append = false, pageToken?: string | null) => {
    const base = apiBase(); if (!base) { setError('Server domain is unavailable.'); setLoading(false); return; } append ? setMore(true) : (setLoading(true), setError(''));
    try {
      const query = new URLSearchParams({ search: search.trim(), status: filter === 'all' ? '' : filter, pageSize: '50' });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await fetch(`${base}/admin/users?${query}`, { headers: await headers() });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Could not load users.');
      const incoming: DirectoryUser[] = (body.users ?? body.data ?? body.results ?? []).map(normalUser);
      setUsers(old => append ? [...old, ...incoming.filter(u => !old.some(x => x.uid === u.uid))] : incoming);
      setToken(val(body, 'nextPageToken', 'nextToken') ?? null);
      if (!append) {
        const ar = await fetch(`${base}/admin/users/analytics`, { headers: await headers() });
        const analytics = await ar.json().catch(() => ({}));
        if (!ar.ok) throw new Error(analytics.error ?? 'Could not load subscription totals.');
        setStats({
          total: Number(analytics.totalUsers ?? incoming.length),
          active: Number(analytics.activeUsers ?? 0),
          paid: Number(analytics.accessBreakdown?.paid ?? 0),
          googlePlayPaid: Number(analytics.googlePlayPaidUsers ?? 0),
          verified: Number(analytics.verifiedUsers ?? 0),
          verifiedRevenue: Number(analytics.verifiedSubscriptionRevenueNaira ?? 0),
          needsPaymentAccess: Number(analytics.usersWithoutRecordedVerifiedPaymentOrValidAccess ?? 0),
          lastPaystackSync: analytics.lastPaystackSync ?? null,
          lastGooglePlaySync: analytics.lastGooglePlaySync ?? null,
        });
      }
    } catch (e: any) { setError(e.message ?? 'Could not load directory.'); }
    finally { setLoading(false); setMore(false); }
  }, [filter, headers, search]);
  useEffect(() => { const id = setTimeout(() => void load(), 300); return () => clearTimeout(id); }, [load]);
  const choose = (u: DirectoryUser) => { setSelected(u); setDraft({ name: u.name === 'Unnamed user' ? '' : u.name, email: u.email, phone: u.phone === '—' ? '' : u.phone }); setPassword(''); setConfirmation(''); };
  const mutation = async (path: string, method: string, body?: object) => { const base = apiBase(); if (!base) throw new Error('Server domain is unavailable.'); const r = await fetch(`${base}${path}`, { method, headers: await headers(), ...(body ? { body: JSON.stringify(body) } : {}) }); const json = await r.json().catch(() => ({})); if (!r.ok) throw new Error(json.error ?? 'Update failed.'); return json; };
  const saveProfile = async () => {
    if (!selectedLive) return;
    await perform(async () => {
      const phoneNumber = editablePhone(draft.phone);
      const response = await mutation(`/admin/users/${encodeURIComponent(selectedLive.uid)}`, 'PATCH', {
        displayName: draft.name.trim(), email: draft.email.trim(), phoneNumber,
      });
      setSelected(normalUser(response.user));
    }, 'Profile saved');
  };
  const syncPaystackHistory = () => Alert.alert('Sync Paystack history', 'Import successful ₦3,225 subscription charges from Paystack history? ₦50 setup checks are excluded.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sync', onPress: async () => { setSyncingPaystack(true); setPaystackSyncError(''); setPaystackSyncResult(null); try { const result = await mutation('/admin/users/analytics/sync-paystack', 'POST') as PaystackSyncResult; setPaystackSyncResult(result); await load(); } catch (e: any) { setPaystackSyncError(e.message ?? 'Could not sync Paystack history.'); } finally { setSyncingPaystack(false); } } }]);
  const syncGooglePlay = async () => {
    setSyncingPlay(true); setPlaySyncError(''); setPlayProgress('Checking Google Play subscriptions…');
    try {
      let pageToken: string | null = null;
      let checked = 0;
      let active = 0;
      do {
        const result: { checked: number; activeInBatch: number; total: number; nextPageToken: string | null } =
          await mutation('/admin/users/sync-google-play', 'POST', { pageToken: pageToken ?? '0' });
        checked += result.checked;
        active += result.activeInBatch;
        pageToken = result.nextPageToken;
        setPlayProgress(`Checked ${checked} of ${result.total} · ${active} with Play access (including trials)`);
      } while (pageToken);
      await load();
    } catch (e: any) { setPlaySyncError(e.message ?? 'Could not verify Google Play subscriptions.'); }
    finally { setSyncingPlay(false); }
  };
  const perform = async (work: () => Promise<void>, title: string) => { setSaving(true); try { await work(); await load(); Alert.alert(title); } catch (e: any) { Alert.alert('Request failed', e.message); } finally { setSaving(false); } };
  const selectedLive = selected && users.find(u => u.uid === selected.uid) || selected;
  const kpis = [[Users, stats.total, 'Registered'], [UserCheck, stats.active, 'Access'], [Check, stats.paid, 'Paid'], [Check, stats.googlePlayPaid, 'Google Play'], [ShieldCheck, `₦${stats.verifiedRevenue.toLocaleString()}`, 'Paystack revenue'], [X, stats.needsPaymentAccess, 'Needs payment/access']];
  return <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 0) }]}>
    <View style={[styles.header, { borderBottomColor: colors.border }]}><Pressable testID="button-back-admin" onPress={() => router.back()} style={styles.icon}><ArrowLeft size={21} color={colors.foreground} /></Pressable><Text style={[styles.headerTitle, { color: colors.foreground }]}>User directory</Text><Pressable testID="button-refresh-directory" onPress={() => load()} style={styles.icon}><Users size={19} color={colors.primary} /></Pressable></View>
    <View style={[styles.syncCard, { backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 16, marginTop: 12, marginBottom: 0 }]}>
      <View style={{ flex: 1 }}><Text style={[styles.syncTitle, { color: colors.foreground }]}>Google Play subscriptions</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>Last verified: {stats.lastGooglePlaySync ? new Date(stats.lastGooglePlaySync).toLocaleString() : 'Never'}</Text>{!!playProgress && <Text style={[styles.meta, { color: colors.primary }]}>{playProgress}</Text>}{!!playSyncError && <Text style={[styles.meta, { color: '#DC2626' }]}>{playSyncError}</Text>}</View>
      <Pressable testID="button-sync-google-play" accessibilityRole="button" onPress={() => void syncGooglePlay()} disabled={syncingPlay} style={[styles.syncButton, { backgroundColor: colors.primary, opacity: syncingPlay ? .6 : 1 }]}>{syncingPlay ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Refresh Play</Text>}</Pressable>
    </View>
    <FlatList
      data={users}
      keyExtractor={item => item.uid}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="always"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 24), flexGrow: 1 }}
      ListHeaderComponent={<><Text style={[styles.eyebrow, { color: colors.primary }]}>ADMINISTRATION</Text><Text style={[styles.title, { color: colors.foreground }]}>{stats.total} registered accounts</Text><View style={styles.kpis}>{kpis.map(([Icon, count, label]: any) => <View key={label} style={[styles.kpi, { backgroundColor: colors.card, borderColor: colors.border }]}><Icon size={15} color={colors.primary} /><Text style={[styles.kpiValue, { color: colors.foreground }]}>{count}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>{label}</Text></View>)}</View><View style={[styles.syncCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={{ flex: 1 }}><Text style={[styles.syncTitle, { color: colors.foreground }]}>Paystack reconciliation</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>Imports successful ₦3,225 subscriptions; excludes ₦50 setup checks.</Text><Text style={[styles.meta, { color: colors.mutedForeground }]}>Last sync: {stats.lastPaystackSync ? new Date(stats.lastPaystackSync).toLocaleString() : 'Never'}</Text>{paystackSyncResult && <Text testID="text-paystack-sync-result" style={[styles.meta, { color: colors.primary }]}>Scanned {paystackSyncResult.scanned} · Imported {paystackSyncResult.imported} · Recorded {paystackSyncResult.alreadyRecorded} · Rejected {paystackSyncResult.rejected} · {paystackSyncResult.pages} pages</Text>}{paystackSyncError && <Text testID="text-paystack-sync-error" style={[styles.meta, { color: '#DC2626' }]}>{paystackSyncError}</Text>}</View><Pressable testID="button-sync-paystack-history" onPress={syncPaystackHistory} disabled={syncingPaystack} style={[styles.syncButton, { backgroundColor: colors.primary, opacity: syncingPaystack ? .6 : 1 }]}>{syncingPaystack ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryText}>Sync history</Text>}</Pressable></View><View style={[styles.filterCard, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.searchBox, { borderColor: colors.border }]}><Search size={16} color={colors.mutedForeground} /><TextInput testID="input-user-search" value={search} onChangeText={setSearch} placeholder="Search users" placeholderTextColor={colors.mutedForeground} style={[styles.search, { color: colors.foreground }]} /></View><View style={styles.filterRow}>{['all', 'active', 'paid', 'free', 'inactive'].map(item => <Pressable testID={`button-filter-${item}`} key={item} onPress={() => setFilter(item)} style={[styles.chip, { borderColor: filter === item ? colors.primary : colors.border, backgroundColor: filter === item ? `${colors.primary}18` : 'transparent' }]}><Text style={{ color: filter === item ? colors.primary : colors.mutedForeground, fontSize: 12, textTransform: 'capitalize' }}>{item}</Text></Pressable>)}</View></View></>}
      ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 38 }} /> : error ? <View style={styles.center}><Text style={{ color: '#DC2626' }}>{error}</Text><Pressable testID="button-retry-directory" onPress={() => load()}><Text style={{ color: colors.primary, marginTop: 8 }}>Retry</Text></Pressable></View> : <View style={styles.center}><Text style={{ color: colors.mutedForeground }}>No users match these filters.</Text></View>}
      renderItem={({ item }) => <Pressable
        testID={`button-user-${item.uid}`}
        accessibilityRole="button"
        accessibilityLabel={`View details for ${item.name}, ${item.email}`}
        onPress={() => choose(item)}
        style={[styles.user, { backgroundColor: colors.card, borderColor: colors.border }]}
      ><View style={{ flex: 1 }}><Text style={[styles.userName, { color: colors.foreground }]}>{item.name}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]} numberOfLines={1}>{item.email} · {item.phone}</Text><Text style={[styles.meta, { color: colors.primary, fontFamily: 'Inter_600SemiBold' }]}>View details →</Text></View><View style={{ alignItems: 'flex-end', gap: 5 }}><Text style={[styles.badge, { color: item.hasAccess ? colors.primary : colors.mutedForeground, backgroundColor: item.hasAccess ? `${colors.primary}18` : colors.background }]}>{item.paymentSource === 'google_play' ? 'Google Play' : item.paymentSource === 'paystack' ? 'Paystack paid' : item.hasAccess ? 'Access' : 'No access'}</Text><Text style={{ color: item.disabled ? '#DC2626' : item.emailVerified ? colors.primary : colors.mutedForeground, fontSize: 11 }}>{item.disabled ? 'Disabled' : item.emailVerified ? 'Verified' : 'Unverified'}</Text></View></Pressable>}
      ListFooterComponent={token ? <Pressable testID="button-load-more-users" onPress={() => load(true, token)} disabled={more} style={[styles.loadMore, { borderColor: colors.border }]}>{more ? <ActivityIndicator color={colors.primary} /> : <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>Load more users</Text>}</Pressable> : null}
    />
    <Modal visible={!!selectedLive} animationType="slide" onRequestClose={() => setSelected(null)}><KeyboardAvoidingView style={[styles.modal, { backgroundColor: colors.background, paddingTop: insets.top }]} behavior="padding"><View style={[styles.header, { borderBottomColor: colors.border }]}><Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>{selectedLive?.name}</Text><Pressable testID="button-close-user-modal" onPress={() => setSelected(null)} style={styles.icon}><X color={colors.foreground} /></Pressable></View><KeyboardAwareScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 28 }} bottomOffset={20}><Text style={[styles.meta, { color: colors.mutedForeground }]}>{selectedLive?.email} · {selectedLive?.emailVerified ? 'Email verified' : 'Email unverified'} · {selectedLive?.disabled ? 'Disabled' : 'Enabled'}</Text><Text style={[styles.meta, { color: colors.mutedForeground }]} selectable>{selectedLive?.uid}</Text><Text style={[styles.sectionTitle, { color: colors.foreground }]}>Profile</Text>{(['name', 'email', 'phone'] as const).map(field => <TextInput testID={`input-${field}`} key={field} value={draft[field]} onChangeText={text => setDraft(d => ({ ...d, [field]: text }))} placeholder={field} placeholderTextColor={colors.mutedForeground} autoCapitalize="none" style={[styles.input, { color: colors.foreground, borderColor: colors.border }]} />)}<Pressable testID="button-save-user" disabled={saving} onPress={saveProfile} style={[styles.primary, { backgroundColor: colors.primary, opacity: saving ? .6 : 1 }]}><Text style={styles.primaryText}>Save changes</Text></Pressable>
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Access</Text><Text style={[styles.meta, { color: colors.mutedForeground, marginBottom: 9 }]}>{selectedLive?.hasGrant ? `Admin grant: ${selectedLive.grant?.type ?? 'active'}` : 'No administrator-issued grant.'}</Text>{selectedLive?.hasGrant ? <Pressable testID="button-revoke-access" onPress={() => selectedLive && perform(() => mutation(`/admin/billing/grant/${encodeURIComponent(selectedLive.email)}`, 'DELETE'), 'Free access revoked')} style={[styles.outline, { borderColor: '#DC2626' }]}><Text style={{ color: '#DC2626', fontFamily: 'Inter_600SemiBold' }}>Revoke free access</Text></Pressable> : <><View style={styles.filterRow}>{(['lifetime', 'trial'] as const).map(type => <Pressable key={type} onPress={() => setGrantType(type)} style={[styles.chip, { borderColor: grantType === type ? colors.primary : colors.border }]}><Text style={{ color: colors.foreground }}>{type}</Text></Pressable>)}</View><Pressable testID="button-grant-access" onPress={() => selectedLive && perform(() => mutation('/admin/billing/grant', 'POST', { email: selectedLive.email, type: grantType, ...(grantType === 'trial' ? { durationDays: 30 } : {}) }), 'Access granted')} style={[styles.primary, { backgroundColor: colors.primary }]}><Text style={styles.primaryText}>Grant access</Text></Pressable></>}
      <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Temporary password</Text><Text style={[styles.meta, { color: colors.mutedForeground, marginBottom: 9 }]}>The existing password is never visible. This strong new password is shown once; copy it now before closing.</Text>{password ? <Text selectable testID="text-temporary-password" style={[styles.password, { color: colors.foreground, backgroundColor: colors.card }]}>{password}</Text> : <Pressable testID="button-temporary-password" onPress={() => selectedLive && perform(async () => { const r = await mutation(`/admin/users/${encodeURIComponent(selectedLive.uid)}/password`, 'POST', { password: suggestedPassword() }); setPassword(String(val(r, 'temporaryPassword', 'password') ?? '')); }, 'Temporary password created — copy it now.')} style={[styles.outline, { borderColor: colors.border }]}><KeyRound size={16} color={colors.foreground} /><Text style={{ color: colors.foreground, fontFamily: 'Inter_600SemiBold' }}>Create temporary password</Text></Pressable>}
      <View style={[styles.danger, { borderColor: '#DC2626' }]}><Text style={{ color: '#DC2626', fontFamily: 'Inter_700Bold' }}>Permanently delete account</Text><Text style={{ color: '#DC2626', fontSize: 12 }}>This removes the Firebase sign-in account. Retained business and payment records may remain for accounting and audit. This cannot be undone.</Text><TextInput testID="input-delete-confirmation" value={confirmation} onChangeText={setConfirmation} placeholder={`Type ${selectedLive?.email || selectedLive?.uid}`} placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]} /><Pressable testID="button-delete-user" disabled={saving || (confirmation !== selectedLive?.email && confirmation !== selectedLive?.uid)} onPress={() => selectedLive && perform(async () => { await mutation(`/admin/users/${encodeURIComponent(selectedLive.uid)}`, 'DELETE', { confirmation }); setSelected(null); }, 'User permanently deleted')} style={[styles.primary, { backgroundColor: '#DC2626', opacity: confirmation === selectedLive?.email || confirmation === selectedLive?.uid ? 1 : .45 }]}><Trash2 size={16} color="#fff" /><Text style={styles.primaryText}>Delete permanently</Text></Pressable></View></KeyboardAwareScrollView></KeyboardAvoidingView></Modal>
  </View>;
}
const styles = StyleSheet.create({ screen: { flex: 1 }, header: { height: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, paddingHorizontal: 10 }, icon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }, headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: 'Inter_600SemiBold' }, eyebrow: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.2 }, title: { fontSize: 24, fontFamily: 'Inter_700Bold', marginTop: 4, marginBottom: 15 }, kpis: { flexDirection: 'row', gap: 8, marginBottom: 14 }, kpi: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10, gap: 4 }, kpiValue: { fontSize: 17, fontFamily: 'Inter_700Bold' }, meta: { fontSize: 12, lineHeight: 17 }, syncCard: { borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, syncTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', marginBottom: 3 }, syncButton: { height: 42, borderRadius: 10, paddingHorizontal: 11, alignItems: 'center', justifyContent: 'center' }, filterCard: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 10, marginBottom: 14 }, searchBox: { height: 43, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 11, gap: 8 }, search: { flex: 1, height: '100%' }, filterRow: { flexDirection: 'row', gap: 7 }, chip: { borderWidth: 1, borderRadius: 15, paddingHorizontal: 10, paddingVertical: 7 }, user: { borderWidth: 1, borderRadius: 13, padding: 13, marginBottom: 9, flexDirection: 'row', gap: 10 }, userName: { fontFamily: 'Inter_600SemiBold', marginBottom: 3 }, badge: { fontSize: 11, overflow: 'hidden', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4 }, center: { alignItems: 'center', padding: 32 }, loadMore: { height: 46, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 5 }, modal: { flex: 1 }, sectionTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', marginTop: 19, marginBottom: 9 }, input: { height: 45, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, marginBottom: 9 }, primary: { height: 45, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, primaryText: { color: '#fff', fontFamily: 'Inter_600SemiBold' }, outline: { height: 45, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 }, password: { borderRadius: 10, padding: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 13 }, danger: { marginTop: 22, borderWidth: 1, borderRadius: 12, padding: 12, gap: 9 } });