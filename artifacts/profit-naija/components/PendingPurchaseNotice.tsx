import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readPurchaseAttempt, type PurchaseAttempt } from '@workspace/accounting-core';
import { useAuth } from '@/context/AuthContext';
import { useEntries, type Entry, type Product } from '@/context/EntriesContext';
import { useColors } from '@/hooks/useColors';

export function PendingPurchaseNotice({ saving, onConfirmed, onPendingChange }: {
  saving: boolean;
  onConfirmed: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { user } = useAuth();
  const { addEntry, addPurchaseWithProduct } = useEntries();
  const colors = useColors();
  const [attempt, setAttempt] = useState<PurchaseAttempt | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    let active = true;
    if (!user?.uid) { setAttempt(null); onPendingChange(false); return; }
    readPurchaseAttempt(AsyncStorage, user.uid).then(value => {
      if (!active) return;
      setAttempt(value);
      onPendingChange(!!value);
    }).catch(() => {
      if (active) Alert.alert('Purchase check', 'Could not read the pending purchase. Please reopen this screen before saving.');
    });
    return () => { active = false; };
  }, [user?.uid, saving, checking, onPendingChange]);

  if (!attempt) return null;
  const entry = attempt.payload.entry as Omit<Entry, 'id' | 'createdAt'>;
  const check = async () => {
    if (checking || saving) return;
    setChecking(true);
    try {
      const product = attempt.payload.product as Omit<Product, 'id' | 'createdAt' | 'stockQty'> | undefined;
      if (product) await addPurchaseWithProduct(entry, product);
      else await addEntry(entry);
      onPendingChange(false);
      setAttempt(null);
      onConfirmed();
    } catch (error: any) {
      Alert.alert('Purchase confirmation', error?.message ?? 'Could not confirm this purchase yet.');
    } finally { setChecking(false); }
  };
  return <View style={{ padding: 16, borderRadius: 12, backgroundColor: colors.card, gap: 10, borderWidth: 1, borderColor: colors.border }}>
    <Text style={{ color: colors.foreground, fontWeight: '600' }}>Purchase confirmation pending</Text>
    <Text style={{ color: colors.mutedForeground }}>
      {entry.itemName || 'Your earlier purchase'} · {entry.date}. Do not record it again.
      Check the original purchase below; this reuses the same records and cannot add the stock twice.
    </Text>
    <Pressable accessibilityRole="button" testID="check-pending-purchase" disabled={checking || saving}
      onPress={check} style={{ padding: 12, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center' }}>
      {checking ? <ActivityIndicator color={colors.primaryForeground} /> : <Text style={{ color: colors.primaryForeground, fontWeight: '600' }}>Check pending purchase</Text>}
    </Pressable>
  </View>;
}
