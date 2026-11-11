import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, HandCoins } from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';

export default function BorrowScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.page, { backgroundColor: colors.background, paddingTop: insets.top + 12 }]}>
      <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.back}>
        <ArrowLeft size={18} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground }}>Back</Text>
      </Pressable>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.icon, { backgroundColor: colors.muted }]}>
          <HandCoins size={24} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground }]}>Borrow from a partner</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Lending partners are not available in ProfitNaija yet. We’re working on partner options and will list them here when their details are ready.
        </Text>
        <Text style={[styles.note, { color: colors.mutedForeground, backgroundColor: colors.background }]}>
          No loan offers or applications are available on this page right now.
        </Text>
        <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)')} style={[styles.button, { backgroundColor: colors.primary }]}>
          <Text style={styles.buttonText}>Return to dashboard</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingHorizontal: 20 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginBottom: 18 },
  card: { borderWidth: 1, borderRadius: 20, padding: 22, gap: 14 },
  icon: { height: 48, width: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontFamily: 'Inter_700Bold' },
  body: { fontSize: 15, lineHeight: 23, fontFamily: 'Inter_400Regular' },
  note: { borderRadius: 10, padding: 14, fontSize: 14, lineHeight: 20, fontFamily: 'Inter_400Regular' },
  button: { minHeight: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  buttonText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
