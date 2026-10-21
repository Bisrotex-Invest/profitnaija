/**
 * Terms & Conditions screen — static legal content.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, FileText } from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';

const UPDATED = 'Last updated: August 2026';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '1. Acceptance of Terms',
    body:
      'By creating an account or using ProfitNaija, you agree to these Terms & Conditions. If you do not agree, please do not use the app.',
  },
  {
    title: '2. What ProfitNaija Does',
    body:
      'ProfitNaija helps small business owners record sales, purchases, expenses and stock, and view profit reports. The figures shown (including VAT and income tax estimates) are calculated from the numbers you enter and are provided for guidance only — they are not professional accounting, tax, or legal advice. Always confirm your tax obligations with a qualified professional or the Federal Inland Revenue Service (FIRS).',
  },
  {
    title: '3. Subscription & Fees',
    body:
      'ProfitNaija is a paid service. A monthly subscription fee of three thousand naira only (\u20A63,000), VAT exclusive, applies. Value Added Tax (VAT) of 7.5% is added to every charge, so the total monthly charge is \u20A63,225. The fee is charged to your card or directly from your bank account each month through our secure payment partner, Paystack. First-time users enjoy a 7-day free trial, but must first add a payment method before the free trial begins. After the trial, your monthly subscription starts automatically. You can manage your subscription and payment method from the Profile screen.',
  },
  {
    title: '4. Your Account',
    body:
      'You are responsible for keeping your login details safe and for all activity on your account. You must provide accurate information when signing up. You may delete your account at any time from the Profile screen — this permanently removes your account and business records from our servers.',
  },
  {
    title: '5. Your Data',
    body:
      'Your business records belong to you. We store them securely so you can access them from your device. We do not sell your personal or business data to third parties. See our Privacy Policy (on the About Us page) for details on what we collect and how it is used.',
  },
  {
    title: '6. Acceptable Use',
    body:
      'You agree not to use ProfitNaija for any unlawful purpose, to attempt to access other users\u2019 data, or to interfere with the operation of the service.',
  },
  {
    title: '7. Service Availability',
    body:
      'We work hard to keep ProfitNaija available at all times, but we cannot guarantee uninterrupted service. Features may change or be improved over time. Where possible, we will notify you of significant changes.',
  },
  {
    title: '8. Limitation of Liability',
    body:
      'ProfitNaija is provided "as is". To the maximum extent permitted by law, we are not liable for business losses, tax penalties, or other damages arising from your use of the app or reliance on its calculations.',
  },
  {
    title: '9. Changes to These Terms',
    body:
      'We may update these Terms from time to time. Continued use of the app after changes means you accept the updated Terms.',
  },
  {
    title: '10. Contact',
    body:
      'Questions about these Terms? Visit the About Us page (from the Profile screen) for our full contact details, or tap the button below.',
  },
];

export default function TermsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { backgroundColor: colors.headerBg, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ArrowLeft size={22} color="#fff" strokeWidth={2} />
        </Pressable>
        <Text style={styles.topBarTitle}>Terms &amp; Conditions</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroRow}>
          <View style={[styles.heroIcon, { backgroundColor: colors.primary + '18' }]}>
            <FileText size={22} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.heroTitle, { color: colors.foreground }]}>ProfitNaija Terms of Use</Text>
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>{UPDATED}</Text>
          </View>
        </View>

        {SECTIONS.map((s) => (
          <View key={s.title} style={[styles.card, { backgroundColor: colors.card }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>{s.title}</Text>
            <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>{s.body}</Text>
          </View>
        ))}

        {/* Contact → About page */}
        <Pressable
          onPress={() => router.push('/about')}
          style={({ pressed }) => [
            styles.aboutLink,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Text style={styles.aboutLinkText}>Contact Us — About ProfitNaija</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
  },
  topBarTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },
  scroll: { padding: 16, gap: 12 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, paddingBottom: 4 },
  heroIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 17, fontFamily: 'Inter_700Bold' },
  heroSub: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  card: {
    borderRadius: 14, padding: 16, gap: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  cardTitle: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  cardBody: { fontSize: 13.5, fontFamily: 'Inter_400Regular', lineHeight: 21 },
  aboutLink: { borderRadius: 14, padding: 15, alignItems: 'center', marginTop: 4 },
  aboutLinkText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
