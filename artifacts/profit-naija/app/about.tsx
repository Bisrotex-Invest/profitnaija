/**
 * About Us screen — company info, privacy policy, and contact details.
 */
import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft, Globe, Mail, MapPin, Phone, ShieldCheck, FileText, Info, ChevronRight,
} from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';

const APP_VERSION = '1.1';

export default function AboutScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const contact = (url: string) => Linking.openURL(url).catch(() => {});

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Top bar */}
      <View style={[styles.topBar, { backgroundColor: colors.headerBg, paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ArrowLeft size={22} color="#fff" strokeWidth={2} />
        </Pressable>
        <Text style={styles.topBarTitle}>About Us</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Brand hero */}
        <View style={styles.hero}>
          <View style={[styles.logoCircle, { backgroundColor: colors.primary }]}>
            <Text style={styles.logoSymbol}>₦</Text>
          </View>
          <Text style={[styles.heroName, { color: colors.foreground }]}>ProfitNaija</Text>
          <Text style={[styles.heroTag, { color: colors.mutedForeground }]}>
            Know your profit, run your business
          </Text>
          <Text style={[styles.heroVersion, { color: colors.mutedForeground }]}>Version {APP_VERSION}</Text>
        </View>

        {/* About us */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Info size={16} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Who We Are</Text>
          </View>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            ProfitNaija was built for Nigerian small business owners — traders and artisans — who
            want a clearer view of their business records. Use ProfitNaija on mobile or web to record
            sales, purchases, expenses, stock, returns, customer and supplier balances, and cash or
            bank activity; create invoices; and review reports based on the information you enter.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            Our mission is to make day-to-day record-keeping more practical for Nigerian businesses.
          </Text>
        </View>

        {/* Privacy policy */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <ShieldCheck size={16} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Privacy Policy</Text>
          </View>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            Know your profit, run your business
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • Information handled: account and business profile details, optional photos, records you
            enter, customer and supplier details, invoices, subscription status, and technical or
            crash diagnostics.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • Service providers: Firebase supports accounts, database storage, and crash reporting;
            Replit hosts the website and service API; Resend delivers account emails; Paystack handles
            web subscriptions; and RevenueCat and Google Play handle Android subscription verification
            and store billing. Public-site Google Analytics may be enabled.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • Payments and sharing: payment providers handle card or bank details. We receive payment
            references and subscription status, not complete card numbers or bank credentials. Anyone
            with an active invoice-sharing link may view the invoice details available through it.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • Your control: edit records in the app or request account deletion from Profile or
            Settings. We delete account business data, backups, and invoice shares when deletion
            completes, but may retain limited billing, payment, security, or audit records where
            required by law.
          </Text>
          <ContactRow
            Icon={Globe}
            label="Read the full Privacy Policy"
            onPress={() => contact('https://profitnaija.com/privacy')}
            colors={colors}
          />
        </View>

        {/* Contact */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <Mail size={16} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Contact Us</Text>
          </View>

          <ContactRow
            Icon={Mail}
            label="support@profitnaija.com"
            onPress={() => contact('mailto:support@profitnaija.com')}
            colors={colors}
          />
          <ContactRow
            Icon={Globe}
            label="profitnaija.com"
            onPress={() => contact('https://profitnaija.com')}
            colors={colors}
          />
          <ContactRow
            Icon={Phone}
            label="0817 586 7817"
            onPress={() => contact('tel:+2348175867817')}
            colors={colors}
          />
          <ContactRow
            Icon={Phone}
            label="0905 783 1610"
            onPress={() => contact('tel:+2349057831610')}
            colors={colors}
          />
          <ContactRow
            Icon={MapPin}
            label="144, Lagos Road, Jumofak Bus-stop, Ikorodu, Lagos, Nigeria"
            colors={colors}
          />
          <Text style={[styles.contactHours, { color: colors.mutedForeground }]}>
            Available Mon – Fri, 9:00 am – 5:00 pm
          </Text>
        </View>

        {/* Terms link */}
        <Pressable
          onPress={() => router.push('/terms')}
          style={({ pressed }) => [
            styles.termsLink,
            { backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <FileText size={16} color={colors.primary} />
          <Text style={[styles.termsLinkText, { color: colors.foreground }]}>Terms &amp; Conditions</Text>
          <ChevronRight size={16} color={colors.mutedForeground} />
        </Pressable>

        <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
          © 2026 ProfitNaija, powered by Bisrotex Investment Synergy Limited, a registered Nigerian
          company with RC: 1700008. 🇳🇬
        </Text>
      </ScrollView>
    </View>
  );
}

function ContactRow({
  Icon, label, onPress, colors,
}: { Icon: any; label: string; onPress?: () => void; colors: any }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.contactRow, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Icon size={15} color={colors.mutedForeground} />
      <Text style={[styles.contactText, { color: onPress ? colors.primary : colors.mutedForeground }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 16,
  },
  topBarTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: '#fff' },
  scroll: { padding: 16, gap: 14 },

  hero: { alignItems: 'center', gap: 4, paddingVertical: 12 },
  logoCircle: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  logoSymbol: { fontSize: 34, fontFamily: 'Inter_700Bold', color: '#fff' },
  heroName: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  heroTag: { fontSize: 13, fontFamily: 'Inter_400Regular' },
  heroVersion: { fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },

  card: {
    borderRadius: 14, padding: 16, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 6, elevation: 1,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  cardBody: { fontSize: 13.5, fontFamily: 'Inter_400Regular', lineHeight: 21 },

  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  contactHours: { fontSize: 12.5, fontFamily: 'Inter_400Regular', marginLeft: 25 },
  contactText: { fontSize: 14, fontFamily: 'Inter_500Medium' },

  termsLink: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, padding: 16,
  },
  termsLinkText: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  footerNote: { fontSize: 12, fontFamily: 'Inter_400Regular', textAlign: 'center', marginTop: 8 },
});
