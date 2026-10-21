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
            Track your profits, grow your business
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
            want to know exactly how much they are making. We turn your daily
            sales, purchases and expenses into clear profit reports, so you can make smart decisions
            and grow your business with confidence.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            Our mission is simple: every small business in Nigeria should understand its numbers,
            without needing an accountant for day-to-day bookkeeping.
          </Text>
        </View>

        {/* Privacy policy */}
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={styles.cardHeader}>
            <ShieldCheck size={16} color={colors.primary} />
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Privacy Policy</Text>
          </View>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • What we collect: your name, email and phone number when you sign up, plus the business
            records (sales, purchases, expenses, stock, customers) you choose to enter. Your card
            details are collected for payment of the service only — securely by our payment partner
            Paystack; we never store them on our own servers.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • How we use it: to provide the app — storing your records securely, syncing them to
            your device, and calculating your reports. We can use your data to provide services that
            will improve your business, but we will never sell your data to anyone.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • Where it lives: your data is stored securely in the cloud (Google Firebase) and protected
            so only your signed-in account can access it.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • Your control: you can edit your records at any time, and you can permanently delete your
            account and all your data from the Profile screen.
          </Text>
          <Text style={[styles.cardBody, { color: colors.mutedForeground }]}>
            • Photos: profile and customer photos you add are stored securely with your account and
            are only visible to you.
          </Text>
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
