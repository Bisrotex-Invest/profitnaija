import '@/lib/globalErrorHandler'; // ← MUST remain the very first import
import {
  initializeCrashReporting,
  verifyCrashReportingInDevelopment,
} from '@/lib/crashReporting';
import React, { useEffect, useRef, useState } from 'react';
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
import { Stack, router, useRootNavigationState } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { EntriesProvider } from '@/context/EntriesContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { ProfileProvider } from '@/context/ProfileContext';
import { BillingProvider } from '@/context/BillingContext';
import { CustomerProvider } from '@/context/CustomerContext';
import { registerUpdateNotifications } from '@/lib/updateNotifications';
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
  const isWebPreview = Platform.OS === 'web';
  const { user, authLoading } = useAuth();
  const [splashDone, setSplashDone] = useState(isWebPreview);
  // useRootNavigationState prevents the "6000ms timeout exceeded" error:
  // router.replace() must not be called until the stack is mounted.
  const navState = useRootNavigationState();
  // Guard so we only navigate once — sign-in / dashboard handle subsequent routing.
  const didNavigate = useRef(false);
  // Store a deep-link URL that arrived before nav was ready.
  const pendingDeepLink = useRef<string | null>(null);

  // Show splash for exactly 2 seconds — no Firebase during this time.
  useEffect(() => {
    if (isWebPreview) return;
    const t = setTimeout(() => setSplashDone(true), 2000);
    return () => clearTimeout(t);
  }, [isWebPreview]);

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

  // After splash + nav ready: either process a pending deep link OR do normal routing.
  useEffect(() => {
    if (!navState?.key || !splashDone || authLoading || didNavigate.current) return;
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
        } else {
          router.replace('/onboarding');
        }
      })
      .catch(() => {
        router.replace('/onboarding');
      });
  }, [navState?.key, splashDone, authLoading, user]);

  return (
    <>
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

      {/* Keep the overlay visible while the persisted auth session hydrates. */}
      {(!splashDone || authLoading) && <AppSplash />}
    </>
  );
}

// ── Root layout ───────────────────────────────────────────────────────────────

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
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
    if (fontError) {
      console.warn('[fonts] load error:', fontError);
    }
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    registerUpdateNotifications().catch((error) => {
      console.warn('[update notifications] registration failed:', error?.message ?? error);
    });
  }, []);

  // Browsers can paint the onboarding screen with fallback fonts immediately;
  // native keeps its launch splash visible until the bundled fonts are ready.
  if (!fontsLoaded && !fontError && Platform.OS !== 'web') return null;

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
