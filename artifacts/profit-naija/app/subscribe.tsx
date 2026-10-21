/**
 * Subscribe screen — paywall shown after profile completion until the user
 * has an active subscription or trial.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertTriangle, BadgeCheck, CalendarClock, ChevronLeft, CreditCard, LogOut, ShieldCheck, Sparkles, X } from 'lucide-react-native';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useBilling } from '@/context/BillingContext';
import Animated, { FadeInUp, FadeOutDown } from 'react-native-reanimated';

const STARTER_FEATURES = [
  'Sales and expense recording',
  'Products and stock management',
  'Customer profiles and transaction history',
  'Invoices and payment tracking',
  'Basic business reports',
  'Offline record keeping',
];

const PRO_FEATURES = [
  'Everything in Starter',
  'Customer CRM and credit follow-up tools',
  'Credit reminders',
  'Cash-flow planning',
  'Margin protection',
  'Advanced reports',
  'Cloud backup and data export',
  'Tax centre',
];

const BUSINESS_FEATURES = [
  'Multiple staff accounts',
  'Permissions',
  'Audit history',
  'Period locking',
  'Bank/POS reconciliation',
  'Accountant access',
];

export default function SubscribeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { billing, startCheckout, switchPlan, refreshBilling, nativePrices } = useBilling();
  useLocalSearchParams<{ reason?: string }>();
  const [busy, setBusy] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<'starter' | 'pro' | null>(null);
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'yearly'>('monthly');

  const firstTime = !billing.everSubscribed;
  const usesGooglePlay = Platform.OS === 'android'
    && (billing.entitlementSource === 'google_play' || billing.entitlementSource === 'none');
  const starterUnavailable = usesGooglePlay && !nativePrices.starter[billingInterval];
  const proUnavailable = usesGooglePlay && !nativePrices.pro[billingInterval];
  const starterCurrent = billing.hasAccess
    && billing.currentPlan === 'starter'
    && billing.billingInterval === billingInterval;
  const proCurrent = billing.hasAccess
    && billing.currentPlan === 'pro'
    && billing.billingInterval === billingInterval;

  const handlePay = async () => {
    if (!selectedPlan) return;
    setBusy(true);
    try {
      if (billing.hasAccess) {
        const updated = await switchPlan(selectedPlan, billingInterval);
        if (!updated.hasAccess) throw new Error('Your subscription change is still syncing. Tap “Already paid?” to refresh.');
        Alert.alert('Subscription Changed', `Successfully updated to the ${selectedPlan === 'pro' ? 'Pro' : 'Starter'} plan.`);
        setSelectedPlan(null);
        router.replace('/(tabs)');
      } else {
        const activated = await startCheckout(selectedPlan, billingInterval);
        if (!activated.hasAccess) throw new Error('Your payment is still syncing. Tap “Already paid?” to refresh.');
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      Alert.alert('Payment', e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut().catch(() => {});
    router.replace('/sign-in');
  };

  const handleContactSales = () => {
    router.push('/about');
  };

  if (selectedPlan) {
    const isPro = selectedPlan === 'pro';
    const nativePrice = isPro ? nativePrices.pro[billingInterval] : nativePrices.starter[billingInterval];

    let basePrice = 0;
    if (billingInterval === 'monthly') {
      basePrice = isPro ? 5000 : 3000;
    } else {
      basePrice = isPro ? 54000 : 32400;
    }

    const vat = basePrice * 0.075;
    const total = basePrice + vat;
    const isSwitching = billing.hasAccess;

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
          <Pressable onPress={() => setSelectedPlan(null)} hitSlop={10}>
            <ChevronLeft size={24} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: colors.foreground }]}>{isSwitching ? 'Update Subscription' : 'Confirm Subscription'}</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.summaryHeader}>
              <Text style={[styles.summaryPlan, { color: colors.foreground }]}>
                {isPro ? 'Pro' : 'Starter'} Plan
              </Text>
              <Text style={[styles.summaryInterval, { color: colors.mutedForeground }]}>
                {billingInterval === 'yearly' ? 'Yearly' : 'Monthly'}
              </Text>
            </View>
            {nativePrice ? (
              <>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryTotalLabel, { color: colors.foreground }]}>Google Play store price</Text>
                  <Text style={[styles.summaryTotalValue, { color: colors.primary }]}>{nativePrice}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Base Price</Text>
                  <Text style={[styles.summaryValue, { color: colors.foreground }]}>₦{basePrice.toLocaleString()}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>VAT (7.5%)</Text>
                  <Text style={[styles.summaryValue, { color: colors.foreground }]}>₦{vat.toLocaleString()}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryRow}>
                  <Text style={[styles.summaryTotalLabel, { color: colors.foreground }]}>Total</Text>
                  <Text style={[styles.summaryTotalValue, { color: colors.primary }]}>₦{total.toLocaleString()}</Text>
                </View>
              </>
            )}
          </View>

          <View style={[styles.noteCard, { backgroundColor: colors.primary + '12' }]}>
            <CalendarClock size={16} color={colors.primary} />
            <Text style={[styles.noteText, { color: colors.foreground }]}>
              {nativePrice
                ? `Google Play will ${isSwitching ? 'update' : 'process'} your recurring subscription at the store price shown above. ${firstTime ? 'Google Play will show any trial or introductory offer your account is eligible for before you confirm.' : 'Manage or cancel it from Google Play subscriptions.'}`
                : isSwitching
                  ? `You are changing to the ${isPro ? 'Pro' : 'Starter'} ${billingInterval} plan. Your new recurring charge will be ₦${total.toLocaleString()}.`
                  : `Paystack charges ₦50 now to confirm your payment method. ${firstTime
                    ? `Your 7-day free trial starts immediately, then the ${billingInterval} charge is ₦${total.toLocaleString()}.`
                    : `Your recurring ${billingInterval} charge is ₦${total.toLocaleString()}.`}`}
            </Text>
          </View>

          {!isSwitching && (
            <View style={[styles.noteCard, { backgroundColor: colors.card }]}>
              <ShieldCheck size={16} color={colors.primary} />
              <Text style={[styles.noteText, { color: colors.mutedForeground }]}>
                {nativePrice ? 'Payments are processed securely by Google Play.' : 'Payments are processed securely by Paystack. Your card details never touch our servers.'}
                Cancel anytime from your Profile.
              </Text>
            </View>
          )}

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handlePay}
            disabled={busy || billing.state === 'unknown'}
            style={[styles.payBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}
          >
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <CreditCard size={18} color="#fff" />
                <Text style={styles.payBtnText}>
                   {isSwitching
                     ? 'Confirm Update'
                     : nativePrice
                       ? 'Continue with Google Play'
                       : firstTime
                         ? 'Start Free Trial'
                         : `Subscribe — ₦${total.toLocaleString()}/${billingInterval === 'yearly' ? 'yr' : 'mo'}`}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={[styles.logoCircle, { backgroundColor: colors.primary }]}>
            <Text style={styles.logoSymbol}>₦</Text>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {firstTime ? 'Choose your plan' : 'Reactivate your subscription'}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {firstTime
              ? usesGooglePlay
                ? 'Select a plan to continue in Google Play. Any trial available to your account will appear before confirmation.'
                : 'Select a plan to start your 7-day free trial. You can cancel auto-renewal at any time.'
              : 'Your subscription has ended. Select a plan to continue using ProfitNaija.'}
          </Text>
        </View>

        {!billing.hasAccess && (
          <View style={[styles.blockReason, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <AlertTriangle size={18} color={billing.state === 'unknown' ? colors.mutedForeground : colors.expense} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.blockReasonTitle, { color: colors.foreground }]}>
                {billing.state === 'unknown'
                  ? 'We could not confirm your access'
                  : billing.state === 'expired'
                    ? 'Your subscription has ended'
                    : 'A subscription is required'}
              </Text>
              <Text style={[styles.blockReasonText, { color: colors.mutedForeground }]}>
                {billing.accessReason}
              </Text>
            </View>
          </View>
        )}

        <View style={[styles.toggleWrapper, { backgroundColor: colors.border }]}>
          <Pressable
            style={[styles.toggleButton, billingInterval === 'monthly' && { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 }]}
            onPress={() => setBillingInterval('monthly')}
          >
            <Text style={[styles.toggleText, { color: billingInterval === 'monthly' ? colors.foreground : colors.mutedForeground }]}>Monthly</Text>
          </Pressable>
          <Pressable
            style={[styles.toggleButton, billingInterval === 'yearly' && { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 }]}
            onPress={() => setBillingInterval('yearly')}
          >
            <Text style={[styles.toggleText, { color: billingInterval === 'yearly' ? colors.foreground : colors.mutedForeground }]}>
              {usesGooglePlay ? 'Yearly' : 'Yearly (Save 10%)'}
            </Text>
          </Pressable>
        </View>

        {/* Starter Plan */}
        <TouchableOpacity 
          activeOpacity={0.8} 
          onPress={() => setSelectedPlan('starter')}
          disabled={starterUnavailable || starterCurrent}
          style={[styles.planCard, { backgroundColor: colors.card, borderColor: starterCurrent ? colors.primary : colors.border, opacity: starterUnavailable || starterCurrent ? 0.65 : 1 }]}
        >
          <View style={styles.planHeader}>
            <Text style={[styles.planName, { color: colors.foreground }]}>Starter</Text>
            <View style={styles.priceRow}>
              <Text style={[styles.priceBig, { color: colors.foreground }]}>
                {nativePrices.starter[billingInterval] ?? (usesGooglePlay ? 'Unavailable' : billingInterval === 'yearly' ? '₦32,400' : '₦3,000')}
              </Text>
              <Text style={[styles.priceUnit, { color: colors.mutedForeground }]}>/ {billingInterval === 'yearly' ? 'year' : 'month'}</Text>
            </View>
          </View>
          <View style={styles.planDivider} />
          {STARTER_FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <BadgeCheck size={16} color={colors.primary} />
              <Text style={[styles.featureText, { color: colors.foreground }]}>{f}</Text>
            </View>
          ))}
          <View style={[styles.selectBtn, { backgroundColor: starterCurrent ? colors.border : colors.primary + '15' }]}>
            <Text style={[styles.selectBtnText, { color: starterCurrent ? colors.mutedForeground : colors.primary }]}>
              {starterUnavailable ? 'Unavailable in Google Play' : starterCurrent ? 'Current Plan' : billing.hasAccess && billing.currentPlan === 'starter' ? 'Change Starter Billing' : billing.hasAccess ? 'Switch to Starter' : 'Select Starter'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Pro Plan */}
        <TouchableOpacity 
          activeOpacity={0.8} 
          onPress={() => setSelectedPlan('pro')}
          disabled={proUnavailable || proCurrent}
          style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2, opacity: proUnavailable || proCurrent ? 0.65 : 1 }]}
        >
          <View style={[styles.popularBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.popularBadgeText}>Most Popular</Text>
          </View>
          <View style={styles.planHeader}>
            <Text style={[styles.planName, { color: colors.foreground }]}>Pro</Text>
            <View style={styles.priceRow}>
              <Text style={[styles.priceBig, { color: colors.foreground }]}>
                {nativePrices.pro[billingInterval] ?? (usesGooglePlay ? 'Unavailable' : billingInterval === 'yearly' ? '₦54,000' : '₦5,000')}
              </Text>
              <Text style={[styles.priceUnit, { color: colors.mutedForeground }]}>/ {billingInterval === 'yearly' ? 'year' : 'month'}</Text>
            </View>
          </View>
          <View style={styles.planDivider} />
          {PRO_FEATURES.map((f) => (
            <Pressable
              key={f}
              onPress={() => {
                if (billing.hasAccess && billing.currentPlan === 'pro') router.push('/pro-tools');
                else setSelectedPlan('pro');
              }}
              style={styles.featureRow}
              accessibilityRole="button"
              accessibilityLabel={billing.hasAccess && billing.currentPlan === 'pro' ? `Open ${f}` : `Subscribe to unlock ${f}`}
            >
              <BadgeCheck size={16} color={colors.primary} />
              <Text style={[styles.featureText, { color: colors.foreground }]}>{f}</Text>
            </Pressable>
          ))}
          <View style={[styles.selectBtn, { backgroundColor: proCurrent ? colors.border : colors.primary }]}>
            <Text style={[styles.selectBtnText, { color: proCurrent ? colors.mutedForeground : '#fff' }]}>
              {proUnavailable ? 'Unavailable in Google Play' : proCurrent ? 'Current Plan' : billing.hasAccess && billing.currentPlan === 'pro' ? 'Change Pro Billing' : billing.hasAccess ? 'Switch to Pro' : 'Select Pro'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Business Plan */}
        <View style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.planHeader}>
            <Text style={[styles.planName, { color: colors.foreground }]}>Business</Text>
            <View style={styles.priceRow}>
              <Text style={[styles.priceBig, { color: colors.foreground }]}>Custom</Text>
            </View>
          </View>
          <View style={styles.planDivider} />
          {BUSINESS_FEATURES.map((f) => (
            <View key={f} style={styles.featureRow}>
              <BadgeCheck size={16} color={colors.primary} />
              <Text style={[styles.featureText, { color: colors.foreground }]}>{f}</Text>
            </View>
          ))}
          <TouchableOpacity onPress={handleContactSales} style={[styles.selectBtn, { backgroundColor: colors.secondary }]}>
            <Text style={[styles.selectBtnText, { color: colors.foreground }]}>Contact Sales</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.footerLinks}>
          <Pressable onPress={() => refreshBilling()} style={styles.linkBtn}>
            <Sparkles size={14} color={colors.mutedForeground} />
            <Text style={[styles.linkText, { color: colors.mutedForeground }]}>
              Already paid? Tap to refresh
            </Text>
          </Pressable>

          <Pressable onPress={handleSignOut} style={styles.linkBtn}>
            <LogOut size={14} color={colors.mutedForeground} />
            <Text style={[styles.linkText, { color: colors.mutedForeground }]}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
  topBarTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold' },
  scroll: { padding: 20, gap: 14 },
  hero: { alignItems: 'center', gap: 8, marginBottom: 4 },
  logoCircle: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  logoSymbol: { fontSize: 30, fontFamily: 'Inter_700Bold', color: '#fff' },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: 13.5, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 20, paddingHorizontal: 8 },

  toggleWrapper: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    marginBottom: 4,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },

  planCard: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 12, position: 'relative' },
  popularBadge: { position: 'absolute', top: -12, right: 20, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  popularBadgeText: { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.5 },
  planHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  planName: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  priceBig: { fontSize: 24, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  priceUnit: { fontSize: 13, fontFamily: 'Inter_500Medium', marginBottom: 3 },
  planDivider: { height: 1, backgroundColor: 'rgba(0,0,0,0.06)', marginVertical: 4 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureText: { fontSize: 13.5, fontFamily: 'Inter_400Regular', flex: 1 },
  selectBtn: { marginTop: 8, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  selectBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  summaryCard: { borderRadius: 16, borderWidth: 1, padding: 20, gap: 12 },
  summaryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  summaryPlan: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  summaryInterval: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  summaryLabel: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  summaryValue: { fontSize: 14, fontFamily: 'Inter_500Medium' },
  summaryDivider: { height: 1, backgroundColor: 'rgba(0,0,0,0.06)', marginVertical: 4 },
  summaryTotalLabel: { fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  summaryTotalValue: { fontSize: 20, fontFamily: 'Inter_700Bold' },

  noteCard: { flexDirection: 'row', gap: 10, borderRadius: 12, padding: 14, alignItems: 'flex-start' },
  noteText: { fontSize: 12.5, fontFamily: 'Inter_400Regular', lineHeight: 18, flex: 1 },
  blockReason: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderRadius: 12, padding: 14 },
  blockReasonTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  blockReasonText: { fontSize: 12.5, fontFamily: 'Inter_400Regular', lineHeight: 18, marginTop: 3 },

  payBtn: {
    flexDirection: 'row', gap: 10, borderRadius: 14, padding: 16,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  payBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  footerLinks: { marginTop: 16, gap: 12 },
  linkBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
  linkText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
});