import '@/lib/globalErrorHandler'; // ← MUST remain the very first import
import {
  initializeCrashReporting,
  verifyCrashReportingInDevelopment,
} from '@/lib/crashReporting';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import {
  Ionicons, MaterialIcons, MaterialCommunityIcons, Feather, FontAwesome5,
} from '@expo/vector-icons';
import { Stack, router, usePathname, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EntriesProvider } from '@/context/EntriesContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ProfileProvider } from '@/context/ProfileContext';
import { useProfile } from '@/context/ProfileContext';
import { BillingProvider } from '@/context/BillingContext';
import { useBilling } from '@/context/BillingContext';
import { useEntries } from '@/context/EntriesContext';
import { CustomerProvider } from '@/context/CustomerContext';
import { registerUpdateNotifications } from '@/lib/updateNotifications';
import { getSubscriptionSetupStage } from '@workspace/accounting-core';
import { isProfileComplete } from '@/lib/utils/profileComplete';
// checkFirestoreConnectivity removed — REST probe caused misleading 404 logs.
// The Firestore SDK connects via gRPC/long-poll and works regardless of probe result.

// ── Firebase deep-link parser ─────────────────────────────────────────────────
// Handles URLs of the form:
//   https://profitnaija.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=xxx
//   profit-naija://auth?mode=verifyEmail&oobCode=xxx   (custom-scheme fallback)
function parseFirebaseActionUrl(url: string): { mode: string; oobCode: string } | null {
  try {
    const parsed = new URL(url);
    const mode = parsed.searchParams.get('mode');
    const oobCode = parsed.searchParams.get('oobCode');
    if (mode && oobCode) return { mode, oobCode };
  } catch {
    // URL constructor not available or malformed — fall through
    const modeMatch = url.match(/[?&]mode=([^&]+)/);
    const codeMatch = url.match(/[?&]oobCode=([^&]+)/);
    if (modeMatch && codeMatch) return { mode: modeMatch[1], oobCode: codeMatch[1] };
  }
  return null;
}

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
const PUBLIC_STARTUP_ROUTES = new Set([
  '/onboarding',
  '/sign-in',
  '/sign-up',
  '/agent-sign-up',
  '/verify-email',
  '/forgot-password',
  '/reset-password',
]);

// ── Custom splash overlay ─────────────────────────────────────────────────────

function AppSplash() {
  return (
    <View style={styles.splash}>
      {/* Logo circle */}
      <View style={styles.splashCircle}>
        <Text style={styles.splashSymbol}>₦</Text>
      </View>

      {/* App name */}
      <Text style={styles.splashTitle}>ProfitNaija</Text>
      <Text style={styles.splashTagline}>Track your profits, grow your business</Text>

      {/* Loading indicator */}
      <ActivityIndicator
        color="rgba(255,255,255,0.6)"
        size="small"
        style={styles.splashSpinner}
      />
    </View>
  );
}

// ── Root navigator with auth routing ─────────────────────────────────────────

function RootLayoutNav() {
  const { user, authLoading, sessionExpired, recordActivity, sendOnboardingWelcomeEmail } = useAuth();
  const {
    subscriptionSetup,
    completeSubscriptionSetup,
    profile,
    profileLoading,
    onboardingWelcomeEmailEligible,
    onboardingWelcomeEmailAccepted,
  } = useProfile();
  const { billing, billingLoading } = useBilling();
  const { entries, loading: entriesLoading } = useEntries();
  const pathname = usePathname();
  const latestPathname = useRef(pathname);
  latestPathname.current = pathname;
  // useRootNavigationState prevents the "6000ms timeout exceeded" error:
  // router.replace() must not be called until the stack is mounted.
  const navState = useRootNavigationState();
  // Guard so we only navigate once — sign-in / dashboard handle subsequent routing.
  const didNavigate = useRef(false);
  // Store a deep-link URL that arrived before nav was ready.
  const pendingDeepLink = useRef<string | null>(null);
  const setupStage = getSubscriptionSetupStage(entries, subscriptionSetup);
  const isCompleteProfile = isProfileComplete(profile);

  useEffect(() => {
    if (
      !user ||
      authLoading ||
      profileLoading ||
      billingLoading ||
      !navState?.key ||
      !didNavigate.current ||
      !isProfileComplete(profile) ||
      !billing.hasAccess ||
      (billing.entitlementSource !== 'paystack' &&
        billing.entitlementSource !== 'google_play' &&
        billing.entitlementSource !== 'grant/admin') ||
      billing.isAdmin ||
      !subscriptionSetup?.requiredAt ||
      subscriptionSetup.completedAt ||
      entriesLoading
    ) return;

    if (setupStage === 'complete') {
      completeSubscriptionSetup().catch(error => {
        console.warn('[subscription setup] completion sync failed:', error?.message);
      });
      return;
    }
    if (setupStage === 'opening' && pathname !== '/equity') {
      router.replace('/equity');
    } else if (setupStage === 'purchase' && pathname !== '/add-entry') {
      router.replace({ pathname: '/add-entry', params: { type: 'purchase' } });
    }
  }, [
    user, authLoading, profileLoading, billingLoading, profile, billing.hasAccess,
    billing.entitlementSource, billing.isAdmin, subscriptionSetup, entriesLoading, setupStage, pathname,
    navState?.key,
    completeSubscriptionSetup,
  ]);

  useEffect(() => {
    const setupComplete = !subscriptionSetup?.requiredAt || Boolean(subscriptionSetup.completedAt);
    const hasAppAccess = billing.hasAccess || billing.state === 'trial';
    if (
      authLoading ||
      profileLoading ||
      billingLoading ||
      entriesLoading ||
      !user?.emailVerified ||
      !isCompleteProfile ||
      !onboardingWelcomeEmailEligible ||
      onboardingWelcomeEmailAccepted ||
      !hasAppAccess ||
      !setupComplete ||
      billing.isAdmin
    ) return;
    sendOnboardingWelcomeEmail().catch(error => {
      console.warn('[welcome email] delivery request failed:', error?.message);
    });
  }, [
    user, authLoading, profileLoading, billingLoading, entriesLoading, isCompleteProfile,
    onboardingWelcomeEmailEligible, onboardingWelcomeEmailAccepted, billing.hasAccess,
    billing.state, billing.isAdmin, subscriptionSetup, sendOnboardingWelcomeEmail,
  ]);

  // ── Deep link handler ──────────────────────────────────────────────────────
  // Accepts Firebase action URLs from both:
  //   • Cold start  — Linking.getInitialURL() (app was not running)
  //   • Warm start  — Linking 'url' event     (app already open)
  const handleDeepLink = useRef((url: string) => {
    const parsed = parseFirebaseActionUrl(url);
    if (!parsed) return;
    const { mode, oobCode } = parsed;
    console.log('[DeepLink] mode:', mode, 'oobCode:', oobCode ? '***' : '(none)');

    if (mode === 'resetPassword') {
      router.push({ pathname: '/reset-password', params: { oobCode } });
    } else if (mode === 'verifyEmail') {
      router.push({ pathname: '/verify-email', params: { oobCode } });
    }
  });

  useEffect(() => {
    // Cold start: check if app was launched via a Firebase action URL.
    Linking.getInitialURL().then((url) => {
      if (url) {
        console.log('[DeepLink] initial URL:', url);
        const parsed = parseFirebaseActionUrl(url);
        if (parsed) {
          pendingDeepLink.current = url;
        }
      }
    });

    // Warm start: listen for URLs while app is already running.
    const sub = Linking.addEventListener('url', ({ url }) => {
      console.log('[DeepLink] received URL:', url);
      handleDeepLink.current(url);
    });

    return () => sub.remove();
  }, []);

  // Once auth has hydrated, process a pending deep link or choose the first route.
  useEffect(() => {
    if (!navState?.key || authLoading) return;
    if (didNavigate.current) {
      if (!user) router.replace('/sign-in');
      return;
    }
    didNavigate.current = true;

    if (pendingDeepLink.current) {
      handleDeepLink.current(pendingDeepLink.current);
      pendingDeepLink.current = null;
      return;
    }

    // A persisted Firebase session remains signed in across backgrounding and
    // app restarts. Firebase refresh tokens last beyond 60 minutes and are
    // renewed automatically; only explicit sign-out or credential revocation
    // should send the user back to sign-in.
    AsyncStorage.getItem('pn_pending_verification')
      .then((pendingVerification) => {
        if (user && pendingVerification === 'true') {
          router.replace('/verify-email');
        } else if (user) {
          router.replace('/(tabs)');
        } else if (sessionExpired) {
          router.replace('/sign-in');
        } else if (PUBLIC_STARTUP_ROUTES.has(latestPathname.current)) {
          // Preserve a public route opened from a signup link, app link or
          // verification email instead of replacing it with onboarding.
          return;
        } else {
          router.replace('/onboarding');
        }
      })
      .catch(() => {
        if (!user && !sessionExpired && PUBLIC_STARTUP_ROUTES.has(latestPathname.current)) return;
        router.replace(user ? '/(tabs)' : sessionExpired ? '/sign-in' : '/onboarding');
      });
  }, [navState?.key, authLoading, user, sessionExpired]);

  return (
    <View
      style={{ flex: 1 }}
      onTouchStart={recordActivity}
      onTouchMove={recordActivity}
    >
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="add-entry" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="onboarding" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="profile" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="finance" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="equity" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="referrals" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="agent" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="super-agent" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="admin-partners" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="admin-users" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="about" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="terms" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="subscribe" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="sign-in" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="sign-up" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="agent-sign-up" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="verify-email" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="forgot-password" options={{ headerShown: false }} />
        <Stack.Screen name="reset-password" options={{ headerShown: false, animation: 'fade' }} />
        <Stack.Screen name="data-recovery" options={{ presentation: 'modal', headerShown: false }} />
      </Stack>

      {/* Keep the branded overlay visible while Firebase restores the session. */}
      {authLoading && <AppSplash />}
    </View>
  );
}

// ── Root layout ───────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Ionicons.font,
    ...MaterialIcons.font,
    ...MaterialCommunityIcons.font,
    ...Feather.font,
    ...FontAwesome5.font,
  });

  useEffect(() => {
    initializeCrashReporting();
    verifyCrashReportingInDevelopment();
  }, []);

  useEffect(() => {
    if (fontError) console.warn('[fonts] load error:', fontError);
  }, [fontError]);

  // The app paints with system fonts while bundled fonts finish loading. Hiding
  // the native splash now lets the branded React splash render immediately.
  useEffect(() => {
    if (Platform.OS !== 'web') SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    registerUpdateNotifications().catch((error) => {
      console.warn('[update notifications] registration failed:', error?.message ?? error);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthProvider>
                <ProfileProvider>
                  <BillingProvider>
                    <EntriesProvider>
                      <CustomerProvider>
                        <RootLayoutNav />
                      </CustomerProvider>
                    </EntriesProvider>
                  </BillingProvider>
                </ProfileProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F4F27',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    zIndex: 9999,
  },
  splashCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  splashSymbol: {
    fontSize: 44,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  splashTitle: {
    fontSize: 34,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    letterSpacing: -1,
  },
  splashTagline: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  splashSpinner: {
    marginTop: 32,
  },
});
