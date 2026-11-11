/**
 * Terms & Conditions screen — static legal content.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, FileText } from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';

const UPDATED = 'Last updated: 4 November 2026';

const SECTIONS: { title: string; body: string }[] = [
  {
    title: '1. Acceptance of Terms',
    body:
      'By creating an account, accepting these Terms in your profile, or using ProfitNaija, you agree to these Terms & Conditions. ProfitNaija is intended for people aged 18 or older who manage a business. If you do not agree, do not use the service.',
  },
  {
    title: '2. About the Service',
    body:
      'ProfitNaija provides mobile and web tools for business record-keeping. Depending on your plan, you can record sales, purchases, expenses, inventory, returns, customer and supplier balances, and cash or bank activity; create and share invoices; and view accounting and tax-related reports. The service is not a bank, lender, investment service, or tax-filing service. Calculations and tax figures are based on information entered in the app.',
  },
  {
    title: '3. Plans, Trials & Renewals',
    body:
      'ProfitNaija offers Starter and Pro plans billed monthly or yearly, and a Business plan by contacting sales. Web prices are shown before checkout: Starter is ₦5,000 monthly or ₦48,000 yearly, and Pro is ₦10,000 monthly or ₦96,000 yearly, before VAT. A 7.5% VAT charge is added at checkout. Eligible first-time web subscribers may start a 7-day trial after adding a payment method; Paystack may charge a ₦50 payment-method check shown during checkout. Unless canceled before the trial ends, the selected subscription begins automatically and renews at the displayed interval. Existing subscribers keep their current price unless they choose to change plans. Android subscription prices and renewal terms are shown by Google Play before purchase and are managed through Google Play.',
  },
  {
    title: '4. Cancellation & Refunds',
    body:
      'You can stop future renewals from your ProfitNaija profile or the relevant payment provider. For web subscriptions, use the subscription-management options in your profile; for Android subscriptions, use Google Play. Cancellation stops future renewal and does not normally end access before the current paid period expires. Subscription payments are non-refundable except where applicable law requires a refund. Google Play purchases remain subject to Google Play’s refund process.',
  },
  {
    title: '5. Your Account & Information',
    body:
      'Provide accurate account and business information and keep your sign-in details secure. You remain responsible for activity under your account and for the business and customer information you enter. You retain your rights to your business records. You give ProfitNaija permission to host, process, back up, and display that information as needed to provide the service and the features you use.',
  },
  {
    title: '6. Invoices & Shared Links',
    body:
      'If you share an invoice using a secure link, anyone with that link may be able to view the invoice details available through it until the link expires or is disabled. Keep links private and share them only with intended recipients. Shared invoices are designed to show invoice information, not your private costs or profit reports. You are responsible for entering customer information lawfully and for choosing when to share it.',
  },
  {
    title: '7. Acceptable Use',
    body:
      'Do not use ProfitNaija for unlawful activity, attempt to access another person’s account or records, interfere with the service, evade subscription controls, or use the service in a way that could harm other users or our systems.',
  },
  {
    title: '8. Backups & Availability',
    body:
      'We work to keep ProfitNaija available, but do not guarantee uninterrupted or error-free service. Cloud backup and restore features depend on your plan, an internet connection, and service availability; scheduled backups may run when your account or service is active. Keep your own copies of records that are essential to your business. Features may change as the service develops.',
  },
  {
    title: '9. Intellectual Property',
    body:
      'ProfitNaija and its software, design, brand, and other service materials belong to Bisrotex Investment Synergy Limited or its licensors. These Terms do not transfer ownership of those materials to you. You may use the service for your business while your account and plan permit.',
  },
  {
    title: '10. Account Closure & Records',
    body:
      'You can request account deletion from the Profile or Settings screen. Deletion removes your sign-in account, business records, backups, and invoice shares from the service. Some billing, payment, security, or audit records may be retained where required by law or needed to resolve disputes and protect the service. Deletion is permanent and cannot be undone. We may suspend access for unlawful use, security risks, or a serious breach of these Terms.',
  },
  {
    title: '11. Disclaimers & Liability',
    body:
      'ProfitNaija is provided on an as-available basis. You are responsible for checking your entries, reports, and business decisions. To the fullest extent permitted by law, ProfitNaija is not responsible for indirect losses, lost profits, tax penalties, or losses caused by inaccurate information you provide, service interruptions, or reliance on estimates. Nothing in these Terms limits rights or liability that cannot lawfully be limited.',
  },
  {
    title: '12. Changes, Law & Contact',
    body:
      'We may update these Terms as the service changes. We will communicate material updates through the app or by email where appropriate; the updated date appears above. These Terms are governed by the laws of Nigeria, subject to any mandatory consumer rights. Questions about these Terms can be sent to support@profitnaija.com or raised by calling 0817 586 7817, Monday to Friday, 9:00 am–5:00 pm.',
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
            <Text style={[styles.heroTagline, { color: colors.mutedForeground }]}>
              Know your profit, run your business
            </Text>
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
  heroTagline: { fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
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
