/**
 * Admin panel — visible only to the admin email defined in EXPO_PUBLIC_ADMIN_EMAIL.
 * Allows granting / revoking free subscriptions for testing or lifetime use.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, KeyboardAvoidingView,
  Platform, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ShieldCheck, Trash2, Plus, ArrowLeft, RefreshCw, BadgePercent, Users, Search, UserCheck, UserCog } from 'lucide-react-native';

const ADMIN_EMAIL = (process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? '').toLowerCase().trim();

function apiBase() {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/api` : null;
}

type Grant = { type: string; grantedAt: string; grantedBy: string };
type Grants = Record<string, Grant>;
type UserSearchResult = { email: string; registered: boolean; hasGrant: boolean; grant: Grant | null };

export default function AdminScreen() {
  const colors  = useColors();
  const insets  = useSafeAreaInsets();
  const { user } = useAuth();

  const [grants, setGrants]     = useState<Grants>({});
  const [loading, setLoading]   = useState(true);
  const [email, setEmail]       = useState('');
  const [grantType, setGrantType] = useState<'lifetime' | 'trial'>('lifetime');
  const [saving, setSaving]     = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<UserSearchResult | null | undefined>(undefined);

  // Guard — only admin can see this screen
  useEffect(() => {
    if (!ADMIN_EMAIL || !user) return;
    if (user.email?.toLowerCase() !== ADMIN_EMAIL) {
      Alert.alert('Access denied', 'This screen is only for administrators.');
      router.replace('/profile');
    }
  }, [user]);

  const authHeader = useCallback(async () => {
    const token = await user?.getIdToken();
    if (!token) throw new Error('Not signed in');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [user]);

  const loadGrants = useCallback(async () => {
    const base = apiBase();
    if (!base || !user) return;
    setLoading(true);
    try {
      const res = await fetch(`${base}/admin/billing/grants`, { headers: await authHeader() });
      if (!res.ok) throw new Error(`${res.status}`);
      setGrants(await res.json());
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not load grants.');
    } finally {
      setLoading(false);
    }
  }, [user, authHeader]);

  useEffect(() => { loadGrants(); }, [loadGrants]);

  const handleGrant = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    const base = apiBase();
    if (!base) { Alert.alert('Error', 'API not configured.'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${base}/admin/billing/grant`, {
        method: 'POST',
        headers: await authHeader(),
        body: JSON.stringify({ email: trimmed, type: grantType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `${res.status}`);
      setEmail('');
      await loadGrants();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not grant subscription.');
    } finally {
      setSaving(false);
    }
  };

  const handleSearch = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed.includes('@')) {
      Alert.alert('Enter an email', 'Search using the complete registered email address.');
      return;
    }
    const base = apiBase();
    if (!base) return;
    setSearching(true);
    setSearchResult(undefined);
    try {
      const res = await fetch(`${base}/admin/users/search?email=${encodeURIComponent(trimmed)}`, { headers: await authHeader() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? 'Could not search users.');
      setSearchResult(body.user ?? null);
    } catch (e: any) {
      Alert.alert('Search failed', e?.message ?? 'Could not search users.');
    } finally {
      setSearching(false);
    }
  };

  const handleRevoke = (targetEmail: string) => {
    Alert.alert(
      'Revoke subscription',
      `Remove free access for ${targetEmail}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke', style: 'destructive',
          onPress: async () => {
            const base = apiBase();
            if (!base) return;
            try {
              await fetch(`${base}/admin/billing/grant/${encodeURIComponent(targetEmail)}`, {
                method: 'DELETE',
                headers: await authHeader(),
              });
              await loadGrants();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Could not revoke.');
            }
          },
        },
      ],
    );
  };

  const entries = Object.entries(grants);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.background }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerTitle}>
          <ShieldCheck size={20} color="#7C3AED" />
          <Text style={[styles.headerText, { color: colors.foreground }]}>Admin Panel</Text>
        </View>
        <TouchableOpacity onPress={loadGrants} style={styles.backBtn}>
          <RefreshCw size={18} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={entries}
        keyExtractor={([e]) => e}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        ListHeaderComponent={() => (
          <>
            <View style={styles.managementGrid}>
              <Pressable onPress={() => router.push('/admin-users')} style={[styles.managementCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <UserCog size={20} color={colors.primary} />
                <Text style={[styles.managementTitle, { color: colors.foreground }]}>User Management</Text>
                <Text style={[styles.managementText, { color: colors.mutedForeground }]}>Users and subscriptions</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/admin-partners?section=agents')} style={[styles.managementCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <BadgePercent size={20} color={colors.primary} />
                <Text style={[styles.managementTitle, { color: colors.foreground }]}>Agent Management</Text>
                <Text style={[styles.managementText, { color: colors.mutedForeground }]}>Profiles, codes, targets and earnings</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/admin-partners?section=super-agents')} style={[styles.managementCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <BadgePercent size={20} color={colors.primary} />
                <Text style={[styles.managementTitle, { color: colors.foreground }]}>Super-Agent Management</Text>
                <Text style={[styles.managementText, { color: colors.mutedForeground }]}>Network summaries, assignments</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/admin-partners?section=referrals')} style={[styles.managementCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Users size={20} color={colors.primary} />
                <Text style={[styles.managementTitle, { color: colors.foreground }]}>Referral Management</Text>
                <Text style={[styles.managementText, { color: colors.mutedForeground }]}>Accounts, users and withdrawals</Text>
              </Pressable>
            </View>
            {/* Grant form */}
            <Animated.View entering={FadeInDown.springify()} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>Grant Free Subscription</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="user@example.com"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="email-address"
                autoCapitalize="none"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
              <TouchableOpacity
                onPress={handleSearch}
                disabled={searching}
                style={[styles.searchBtn, { borderColor: colors.primary, opacity: searching ? 0.6 : 1 }]}
              >
                {searching ? <ActivityIndicator color={colors.primary} size="small" /> : <Search size={16} color={colors.primary} />}
                <Text style={[styles.searchBtnText, { color: colors.primary }]}>Find registered user</Text>
              </TouchableOpacity>
              {searchResult === null && (
                <Text style={[styles.searchResultText, { color: '#DC2626' }]}>No registered user was found with that exact email.</Text>
              )}
              {searchResult && (
                <View style={[styles.searchResult, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <UserCheck size={18} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.grantEmail, { color: colors.foreground }]}>{searchResult.email}</Text>
                    <Text style={[styles.grantMeta, { color: colors.mutedForeground }]}>
                      {searchResult.hasGrant ? `${searchResult.grant?.type ?? 'Free'} access active` : 'Registered · no free grant'}
                    </Text>
                  </View>
                </View>
              )}
              {/* Type toggle */}
              <View style={styles.typeRow}>
                {(['lifetime', 'trial'] as const).map(t => (
                  <Pressable
                    key={t}
                    onPress={() => setGrantType(t)}
                    style={[
                      styles.typeBtn,
                      { borderColor: grantType === t ? '#7C3AED' : colors.border,
                        backgroundColor: grantType === t ? '#7C3AED14' : 'transparent' },
                    ]}
                  >
                    <Text style={[styles.typeBtnText, { color: grantType === t ? '#7C3AED' : colors.mutedForeground }]}>
                      {t === 'lifetime' ? '♾ Lifetime' : '🧪 Trial (testing)'}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TouchableOpacity
                onPress={handleGrant}
                disabled={saving}
                style={[styles.grantBtn, { backgroundColor: '#7C3AED', opacity: saving ? 0.6 : 1 }]}
              >
                {saving ? <ActivityIndicator color="#fff" size="small" /> : (
                  <>
                    <Plus size={16} color="#fff" />
                    <Text style={styles.grantBtnText}>Grant Access</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>

            <Text style={[styles.listLabel, { color: colors.mutedForeground }]}>
              Current Grants ({entries.length})
            </Text>
          </>
        )}
        ListEmptyComponent={
          loading
            ? <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
            : <Text style={[styles.empty, { color: colors.mutedForeground }]}>No free grants yet.</Text>
        }
        renderItem={({ item: [grantEmail, grant], index }) => (
          <Animated.View entering={FadeInDown.delay(index * 40).springify()}
            style={[styles.grantRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.grantEmail, { color: colors.foreground }]} numberOfLines={1}>{grantEmail}</Text>
              <Text style={[styles.grantMeta, { color: colors.mutedForeground }]}>
                {grant.type === 'lifetime' ? '♾ Lifetime' : '🧪 Trial'} · {new Date(grant.grantedAt).toLocaleDateString('en-NG')}
              </Text>
            </View>
            <TouchableOpacity onPress={() => handleRevoke(grantEmail)} style={styles.revokeBtn}>
              <Trash2 size={16} color="#DC2626" />
            </TouchableOpacity>
          </Animated.View>
        )}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: 1 },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerText: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  card: { borderRadius: 14, borderWidth: 1, padding: 16, marginBottom: 20 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', marginBottom: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', marginBottom: 12 },
  typeRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  typeBtn: { flex: 1, borderWidth: 1.5, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  typeBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  grantBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 12, paddingVertical: 13 },
  grantBtnText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  searchBtn: { height: 42, borderWidth: 1.5, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 },
  searchBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  searchResult: { borderWidth: 1, borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 12 },
  searchResultText: { fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 12 },
  listLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10 },
  grantRow: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10 },
  grantEmail: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  grantMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  revokeBtn: { padding: 8 },
  empty: { textAlign: 'center', marginTop: 24, fontSize: 14, fontFamily: 'Inter_400Regular' },
  managementGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  managementCard: { flex: 1, borderWidth: 1, borderRadius: 13, padding: 13, gap: 5 },
  managementTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  managementText: { fontSize: 10, fontFamily: 'Inter_400Regular', lineHeight: 14 },
});
