/**
 * Data Recovery Screen
 *
 * Two recovery paths:
 *  1. Offline Queue — entries saved to AsyncStorage when Firestore was unreachable.
 *     Show pending items and let user sync them to Firestore now.
 *  2. Account recovery is support-assisted. Arbitrary UID merges are disabled
 *     because a UID alone does not prove ownership of the old account.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { router } from 'expo-router';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/firebase';

// ── Constants ─────────────────────────────────────────────────────────────────

const OFFLINE_QUEUE_KEY = 'pn_offline_queue';
// ── Offline queue helpers ─────────────────────────────────────────────────────

interface QueuedWrite {
  id: string;
  col: string;
  segments: string[];
  data: Record<string, any>;
  savedAt: number;
}

async function readQueue(): Promise<QueuedWrite[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function drainQueue(
  onItemDone: (item: QueuedWrite, success: boolean) => void,
): Promise<{ succeeded: number; failed: number }> {
  const queue = await readQueue();
  const remaining: QueuedWrite[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const item of queue) {
    try {
      await addDoc(collection(db, item.col, ...item.segments), {
        ...item.data,
        createdAt: serverTimestamp(),
        _syncedAt: Date.now(),
      });
      succeeded++;
      onItemDone(item, true);
    } catch {
      failed++;
      remaining.push(item);
      onItemDone(item, false);
    }
  }

  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  return { succeeded, failed };
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ children, style }: { children: React.ReactNode; style?: object }) {
  const colors = useColors();
  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: colors.border }, style]}>
      {children}
    </View>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function DataRecoveryScreen() {
  const colors   = useColors();
  const insets   = useSafeAreaInsets();
  const { user } = useAuth();
  const uid      = user?.uid ?? '';
  const email    = user?.email ?? '';

  // Offline queue state
  const [queue, setQueue]         = useState<QueuedWrite[]>([]);
  const [queueLoading, setQL]     = useState(true);
  const [syncLog, setSyncLog]     = useState<string[]>([]);
  const [syncing, setSyncing]     = useState(false);


  const loadQueue = useCallback(async () => {
    setQL(true);
    setQueue(await readQueue());
    setQL(false);
  }, []);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  // ── Sync handler ──────────────────────────────────────────────────────────

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncLog(['Starting sync…']);
    const { succeeded, failed } = await drainQueue((item, ok) => {
      const label = item.segments.join('/');
      setSyncLog((l) => [...l, ok ? `✓ ${label}` : `✗ ${label} (failed, will retry)`]);
    });
    setSyncLog((l) => [
      ...l,
      '',
      `Done — ${succeeded} synced, ${failed} still pending.`,
      failed === 0 ? '🎉 All offline data is now in Firestore!' : 'Failed items will retry on next app open.',
    ]);
    await loadQueue();
    setSyncing(false);
  };

  // ── UI ────────────────────────────────────────────────────────────────────

  const topPad = Platform.OS === 'ios' ? insets.top : insets.top + 8;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad, backgroundColor: colors.headerBg }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          hitSlop={12}
        >
          <Feather name="arrow-left" size={22} color="#fff" />
        </Pressable>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle}>Data Recovery</Text>
          <Text style={styles.headerSub}>Recover lost or offline entries</Text>
        </View>
        <MaterialCommunityIcons name="database-sync" size={26} color="rgba(255,255,255,0.7)" />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >

        {/* ── Account info ── */}
        <SectionCard>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Your Account</Text>
          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
            Data is stored under your Firebase UID. If you see ₦0, your entries may be in the offline queue below.
          </Text>
          <View style={[styles.infoRow, { borderColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>Email</Text>
            <Text style={[styles.infoValue, { color: colors.foreground }]}>{email || '—'}</Text>
          </View>
          <View style={[styles.infoRow, { borderColor: colors.border }]}>
            <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>UID</Text>
            <Text style={[styles.infoValue, styles.uidText, { color: colors.foreground }]} selectable>
              {uid || '—'}
            </Text>
          </View>
        </SectionCard>

        {/* ── Offline queue ── */}
        <SectionCard>
          <View style={styles.cardTitleRow}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Offline Queue</Text>
            {queueLoading
              ? <ActivityIndicator size="small" color={colors.primary} />
              : (
                <View style={[
                  styles.countBadge,
                  { backgroundColor: queue.length > 0 ? colors.primary : colors.secondary },
                ]}>
                  <Text style={[styles.countBadgeText, { color: queue.length > 0 ? '#fff' : colors.mutedForeground }]}>
                    {queue.length}
                  </Text>
                </View>
              )
            }
          </View>

          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
            When Firestore is unreachable, entries are saved locally. Tap "Sync Now" to push them to Firestore.
          </Text>

          {queue.length > 0 && (
            <View style={[styles.queueList, { borderColor: colors.border }]}>
              {queue.slice(0, 10).map((item) => (
                <View key={item.id} style={[styles.queueItem, { borderBottomColor: colors.border }]}>
                  <MaterialCommunityIcons name="clock-outline" size={13} color={colors.mutedForeground} />
                  <Text style={[styles.queueItemText, { color: colors.mutedForeground }]}>
                    {item.segments.join('/')} · {new Date(item.savedAt).toLocaleDateString()}
                  </Text>
                </View>
              ))}
              {queue.length > 10 && (
                <Text style={[styles.queueMore, { color: colors.mutedForeground }]}>
                  +{queue.length - 10} more
                </Text>
              )}
            </View>
          )}

          {syncLog.length > 0 && (
            <View style={[styles.logBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              {syncLog.map((line, i) => (
                <Text key={i} style={[styles.logLine, { color: line.startsWith('✓') ? colors.revenue : line.startsWith('✗') ? colors.expense : colors.mutedForeground }]}>
                  {line}
                </Text>
              ))}
            </View>
          )}

          <Pressable
            onPress={handleSync}
            disabled={syncing || queue.length === 0}
            style={({ pressed }) => [
              styles.actionBtn,
              { backgroundColor: colors.primary, opacity: (syncing || queue.length === 0) ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            {syncing
              ? <ActivityIndicator color="#fff" size="small" />
              : <MaterialCommunityIcons name="sync" size={17} color="#fff" />
            }
            <Text style={styles.actionBtnText}>
              {syncing ? 'Syncing…' : queue.length === 0 ? 'Queue empty' : `Sync ${queue.length} item${queue.length !== 1 ? 's' : ''} now`}
            </Text>
          </Pressable>
        </SectionCard>

        {/* ── Verified recovery ── */}
        <SectionCard>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Account recovery</Text>
          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
            Recovery from another account is disabled in the app. A Firebase UID is not proof of ownership and copying it could expose another business's records.
          </Text>
          <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
            Contact support after signing in to both accounts so ownership can be verified and the merge can be audited safely.
          </Text>
        </SectionCard>

      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 18,
  },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 1 },

  scroll: { padding: 16, gap: 14 },

  sectionCard: {
    borderRadius: 16, borderWidth: StyleSheet.hairlineWidth,
    padding: 16, gap: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  cardDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 19 },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start',
    paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12,
  },
  infoLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', flexShrink: 0 },
  infoValue: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1, textAlign: 'right' },
  uidText: { fontFamily: 'Inter_400Regular', fontSize: 11 },

  countBadge: {
    minWidth: 24, height: 24, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },
  countBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },

  queueList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, overflow: 'hidden' },
  queueItem: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  queueItemText: { fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 },
  queueMore: { fontSize: 11, fontFamily: 'Inter_400Regular', textAlign: 'center', paddingVertical: 6 },

  logBox: {
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, gap: 3,
  },
  logLine: { fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 },

  warningBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth,
  },
  warningText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: '#E65100', lineHeight: 17 },

  inputLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 },
  input: {
    borderWidth: 1.5, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 13, fontFamily: 'Inter_400Regular',
  },

  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 13, borderRadius: 12,
  },
  actionBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  mergeBtn: { backgroundColor: '#1B5E20' },
});
