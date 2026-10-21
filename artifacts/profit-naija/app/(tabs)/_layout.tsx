import { Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { Redirect, Tabs } from 'expo-router';
import { Home, Package, FileText, Users, BarChart2, Receipt } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/context/AuthContext';
import { useProfile } from '@/context/ProfileContext';
import { useBilling } from '@/context/BillingContext';
import { isProfileComplete } from '@/lib/utils/profileComplete';
import { fetchPartnerRole, type PartnerRole } from '@/lib/partnerRole';

export default function TabLayout() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 8);
  const { user } = useAuth();
  const { profile, profileLoading } = useProfile();
  const { billing, billingLoading } = useBilling();
  const [partnerRole, setPartnerRole] = useState<PartnerRole>('user');
  const [partnerLoading, setPartnerLoading] = useState(Boolean(user));

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setPartnerRole('user');
      setPartnerLoading(false);
      return;
    }
    setPartnerLoading(true);
    fetchPartnerRole(user)
      .then((role) => { if (!cancelled) setPartnerRole(role); })
      .finally(() => { if (!cancelled) setPartnerLoading(false); });
    return () => { cancelled = true; };
  }, [user]);

  // Admin accounts bypass the subscription gate entirely.
  const adminEmail = (process.env.EXPO_PUBLIC_ADMIN_EMAIL ?? '').toLowerCase().trim();
  const isAdmin = !!adminEmail && user?.email?.toLowerCase() === adminEmail;

  // ── Access gates (signed-in users only) ────────────────────────────────────
  
  // 0. Wait for gating state to load to prevent transient tab access
  if (user && (profileLoading || billingLoading || partnerLoading)) {
    return null;
  }

  // 1. Profile must be completed (incl. Terms agreement) right after sign-up.
  if (user && !user.emailVerified) {
    return <Redirect href="/verify-email" /> as any;
  }
  if (user && !isAdmin && partnerRole === 'agent') {
    return <Redirect href="/agent" /> as any;
  }
  if (user && !isAdmin && partnerRole === 'referral') {
    return <Redirect href="/referrals" /> as any;
  }
  if (user && !isProfileComplete(profile)) {
    return <Redirect href="/profile?setup=1" /> as any;
  }
  // 2. Then an active subscription or free trial is required. 'unknown' with
  //    no cached access only happens when the billing server is unreachable —
  //    send to the subscribe screen, which has a retry.
  //    Admin accounts are always allowed through.
  if (!isAdmin && user && !billing.hasAccess) {
    return <Redirect href={{ pathname: '/subscribe', params: { reason: billing.accessCode ?? 'SUBSCRIPTION_REQUIRED' } }} /> as any;
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          // No elevation — elevation on Android can intercept touch events
          elevation: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -1 },
          shadowOpacity: 0.06,
          shadowRadius: 4,
          height: 56 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 6,
        },
        tabBarItemStyle: {
          height: 50,
          paddingVertical: 4,
        },
        tabBarLabelStyle: {
          fontFamily: 'Inter_500Medium',
          fontSize: 11,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="product"
        options={{
          title: 'Products',
          tabBarIcon: ({ color, size }) => <Package size={size} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: 'Report',
          tabBarIcon: ({ color, size }) => <FileText size={size} color={color} strokeWidth={2} />,
        }}
      />

      <Tabs.Screen
        name="tax-center"
        options={{
          title: 'Tax Center',
          tabBarIcon: ({ color, size }) => <Receipt size={size} color={color} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="analytics"
        options={{
          title: 'Analytics',
          tabBarIcon: ({ color, size }) => <BarChart2 size={size} color={color} strokeWidth={2} />,
        }}
      />

      <Tabs.Screen
        name="customers"
        options={{
          title: 'Customers',
          tabBarIcon: ({ color, size }) => <Users size={size} color={color} strokeWidth={2} />,
        }}
      />

      {/* Stock — hidden from tab bar, still accessible via router.push */}
      <Tabs.Screen
        name="stock"
        options={{ href: null }}
      />
    </Tabs>
  );
}
