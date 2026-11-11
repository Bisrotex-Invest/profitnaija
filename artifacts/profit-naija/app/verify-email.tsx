import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { clearPendingSignup, getPendingSignup, postSecurity } from '@/lib/signupSecurity';
import { fetchPartnerRole, partnerDestination } from '@/lib/partnerRole';

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}


export default function VerifyEmailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, refreshUser, sendVerificationEmail, verifyEmailWithCode, signOut } = useAuth();
  // oobCode is present when this screen is opened via a Firebase email action link.
  const { oobCode } = useLocalSearchParams<{ oobCode?: string }>();

  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [error, setError] = useState('');
  // 'idle' | 'verifying' | 'verified' | 'error'
  const [codeState, setCodeState] = useState<'idle' | 'verifying' | 'verified' | 'error'>('idle');
  const completionInFlight = useRef(false);
  const emailComplete = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;

  const runSignupCheck = useCallback(async () => {
    const pending = await getPendingSignup();
    if (!pending) return false;
    const currentUser = userRef.current;
    if (!currentUser) throw new Error('Your session expired. Please sign in again.');
    const token = await currentUser.getIdToken(true);
    await postSecurity('/api/security/signup/check', token, {
      email: pending.email,
      phone: pending.phone,
      installationId: pending.installationId,
    });
    await finishRegistration();
    return true;
  }, []);

  const completeEmailVerification = useCallback(async () => {
    if (completionInFlight.current || emailComplete.current) return;
    completionInFlight.current = true;
    setCodeState('verifying');
    setError('');
    try {
      await withTimeout(
        runSignupCheck(),
        15000,
        'Your email is verified, but the registration check took too long. Tap “I’ve verified my email” to try again.',
      );
      emailComplete.current = true;
      setCodeState('verified');
    } catch (securityCheckError: any) {
      setError(securityCheckError?.message ?? 'Your email was verified, but the security check could not be completed.');
      setCodeState('error');
    } finally {
      completionInFlight.current = false;
    }
  }, [runSignupCheck]);

  const refreshVerificationState = useCallback(async (showNotVerifiedMessage = false) => {
    if (emailComplete.current || completionInFlight.current) return false;
    setCheckingStatus(true);
    try {
      const current = await withTimeout(
        refreshUser(),
        12000,
        'Checking your verification status took too long. Check your connection and try again.',
      );
      if (!current?.emailVerified) {
        if (showNotVerifiedMessage) {
          setError('Your email is not verified yet. Open the link in your email, then return here and try again.');
        }
        return false;
      }
      await completeEmailVerification();
      return true;
    } catch (refreshError: any) {
      if (showNotVerifiedMessage) {
        setError(refreshError?.message ?? 'We could not check your verification status. Please try again.');
      }
      return false;
    } finally {
      setCheckingStatus(false);
    }
  }, [completeEmailVerification, refreshUser]);

  // ── Auto-apply oobCode when the screen opens via deep link ─────────────────
  useEffect(() => {
    if (!oobCode) return;
    setCodeState('verifying');
    withTimeout(
      verifyEmailWithCode(oobCode),
      15000,
      'Email verification took too long. Return to the app and tap “I’ve verified my email”.',
    )
      .then(async () => {
        await completeEmailVerification();
      })
      .catch((err: any) => {
        console.error('[VerifyEmail] applyActionCode error:', err?.code, err?.message);
        const code = err?.code ?? '';
        if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
          setError('This verification link has expired or already been used. Request a new one below.');
        } else {
          setError(`Verification failed [${code || 'unknown'}]: ${err?.message ?? ''}`);
        }
        setCodeState('error');
      });
  }, [completeEmailVerification, oobCode, verifyEmailWithCode]);

  // Verification links can be completed in the browser instead of deep-linking
  // back into the app. Refresh Firebase when this screen opens and whenever the
  // app returns to the foreground so users can continue without signing in again.
  useEffect(() => {
    if (!oobCode) void refreshVerificationState();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshVerificationState();
    });
    return () => subscription.remove();
  }, [oobCode, refreshVerificationState]);

  async function finishRegistration() {
    const pending = await getPendingSignup();
    const currentUser = userRef.current;
    if (!pending || !currentUser) throw new Error('Registration details are unavailable. Please sign in again.');
    const token = await currentUser.getIdToken(true);

    const domain = process.env.EXPO_PUBLIC_DOMAIN;
    if (!domain) throw new Error('The registration service is unavailable. Please try again later.');
    if (pending.isAgentRegistration) {
      const response = await fetch(`https://${domain}/api/agents/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: pending.name, phone: pending.phone, superAgentCode: pending.referralCode }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Agent registration could not be completed.');
    } else if (pending.referralCode) {
      const response = await fetch(`https://${domain}/api/referrals/claim`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: pending.referralCode, name: pending.name }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? 'Referral code could not be linked.');
    }
    await clearPendingSignup();
  }

  const continueToAccount = async () => {
    const refreshed = await refreshUser();
    const role = refreshed ? await fetchPartnerRole(refreshed) : 'user' as const;
    router.replace(partnerDestination(role));
  };

  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    await signOut();
    await clearPendingSignup().catch(() => {});
    router.replace('/sign-in');
  };

  const handleResend = async () => {
    setError('');
    setResendSuccess(false);
    setResending(true);
    try {
      await sendVerificationEmail();
      setResendSuccess(true);
    } catch (err: any) {
      console.error(err);
      setResending(false);
      const msg = err?.message ?? 'Could not resend. Check your internet connection.';
      setError(msg);
      Alert.alert('Error', msg);
    } finally {
      setResending(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Green header ── */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 24 }]}>
        <Animated.View entering={FadeInUp.springify()} style={styles.headerWrap}>
          <View style={styles.iconCircle}>
            <Feather name="mail" size={32} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>Verify Your Email</Text>
          <Text style={styles.headerSub}>One more step to activate your account</Text>
        </Animated.View>
      </View>

      {/* ── Card ── */}
      <Animated.View
        entering={FadeInDown.delay(100).springify()}
        style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.headerBg }]}
      >
        {/* ── Deep-link: verifying in progress ── */}
        {codeState === 'verifying' && (
          <View style={styles.centeredState}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[styles.title, { color: colors.foreground, textAlign: 'center' }]}>
              Verifying…
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground, textAlign: 'center' }]}>
              Confirming your email address with Firebase.
            </Text>
          </View>
        )}

        {/* Email verification completes registration; no SMS step. */}
        {codeState === 'verified' && (
          <View style={styles.centeredState}>
            <View style={[styles.successCircle, { backgroundColor: colors.secondary }]}>
              <Feather name="check-circle" size={40} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground, textAlign: 'center' }]}>
              Email Verified
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground, textAlign: 'center' }]}>
              Your email and registration checks are complete. Continue to your account.
            </Text>
            <Pressable onPress={() => void continueToAccount().catch(err => setError(err.message))} style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}>
              <Feather name="log-in" size={16} color="#fff" /><Text style={styles.primaryBtnText}>Continue to ProfitNaija</Text>
            </Pressable>
            {!!error && (
              <View style={[styles.banner, { backgroundColor: colors.expenseBg, borderColor: colors.expense + '55' }]}>
                <Feather name="alert-circle" size={14} color={colors.expense} />
                <Text style={[styles.bannerText, { color: colors.expense }]}>{error}</Text>
              </View>
            )}
          </View>
        )}

        {/* ── Default / deep-link error: check inbox state ── */}
        {(codeState === 'idle' || codeState === 'error') && (
          <>
            <View style={[styles.mailBadge, { backgroundColor: colors.primary + '18' }]}>
              <Feather name="send" size={24} color={colors.primary} />
            </View>

            <Text style={[styles.title, { color: colors.foreground }]}>Check Your Inbox</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              We sent a verification link to your email address. Click the link in that email to
              activate your ProfitNaija account.
            </Text>

            <View style={[styles.tipBox, { backgroundColor: colors.background }]}>
              <Feather name="info" size={13} color={colors.mutedForeground} style={{ marginTop: 1 }} />
              <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
                Don't see it? Check your Spam or Junk folder.
              </Text>
            </View>

            {/* Deep-link code error */}
            {!!error && (
              <View style={[styles.banner, { backgroundColor: colors.expenseBg, borderColor: colors.expense + '55' }]}>
                <Feather name="alert-circle" size={14} color={colors.expense} />
                <Text style={[styles.bannerText, { color: colors.expense }]}>{error}</Text>
              </View>
            )}

            {/* Resend success */}
            {resendSuccess && (
              <View style={[styles.banner, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '40' }]}>
                <Feather name="check-circle" size={14} color={colors.primary} />
                <Text style={[styles.bannerText, { color: colors.primary }]}>
                  Verification email resent! Check your inbox.
                </Text>
              </View>
            )}

            {/* Resend button — only available while Firebase user is in context */}
            {user ? (
              <>
                <Pressable
                  onPress={() => void refreshVerificationState(true)}
                  disabled={checkingStatus}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: colors.primary, opacity: pressed || checkingStatus ? 0.7 : 1 },
                  ]}
                >
                  {checkingStatus
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <>
                        <Feather name="check-circle" size={15} color="#fff" />
                        <Text style={styles.primaryBtnText}>I’ve verified my email</Text>
                      </>}
                </Pressable>
                <Pressable
                  onPress={handleResend}
                  disabled={resending}
                  style={({ pressed }) => [
                    styles.resendBtn,
                    { borderColor: colors.primary, opacity: pressed || resending ? 0.65 : 1 },
                  ]}
                >
                  {resending ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Feather name="refresh-cw" size={15} color={colors.primary} />
                      <Text style={[styles.resendText, { color: colors.primary }]}>Resend Email</Text>
                    </>
                  )}
                </Pressable>
              </>
            ) : (
              <View style={[styles.banner, { backgroundColor: colors.background, borderColor: colors.input }]}>
                <Feather name="log-in" size={14} color={colors.mutedForeground} />
                <Text style={[styles.bannerText, { color: colors.mutedForeground }]}>
                  Sign in below to request a new verification email.
                </Text>
              </View>
            )}
          </>
        )}
      </Animated.View>

      {/* ── Footer ── */}
      {codeState !== 'verified' && (
        <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.footer}>
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            Already verified?{'  '}
          </Text>
          <Pressable onPress={() => router.replace('/sign-in')}>
            <Text style={[styles.footerLink, { color: colors.primary }]}>Sign In</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* ── Change account ── */}
      {codeState !== 'verified' && (
        <Animated.View entering={FadeInDown.delay(300).springify()} style={styles.skipRow}>
          <Pressable
            onPress={handleSignOut}
            disabled={signingOut}
            style={({ pressed }) => [
              styles.skipBtn,
              { borderColor: colors.input, opacity: pressed || signingOut ? 0.6 : 1 },
            ]}
          >
            {signingOut
              ? <ActivityIndicator size="small" color={colors.mutedForeground} />
              : <>
                  <Text style={[styles.skipBtnText, { color: colors.mutedForeground }]}>
                    Use a different account
                  </Text>
                  <Feather name="log-out" size={15} color={colors.mutedForeground} />
                </>
            }
          </Pressable>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  header: {
    paddingHorizontal: 24,
    paddingBottom: 32,
    alignItems: 'center',
  },
  headerWrap: { alignItems: 'center', gap: 10 },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  headerTitle: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.5 },
  headerSub: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)', textAlign: 'center',
  },

  card: {
    marginHorizontal: 20,
    marginTop: 24,
    borderRadius: 20,
    padding: 24,
    gap: 16,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 5,
  },
  mailBadge: {
    width: 52, height: 52, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  title: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.4 },
  body: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 22 },

  tipBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 10,
  },
  tipText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 19 },

  banner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  bannerText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },

  resendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, height: 48, borderRadius: 12, borderWidth: 1.5,
    marginTop: 4,
  },
  resendText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },

  centeredState: { alignItems: 'center', gap: 16, paddingVertical: 8 },
  successCircle: {
    width: 80, height: 80, borderRadius: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtn: {
    height: 52, borderRadius: 14, alignItems: 'center',
    justifyContent: 'center', flexDirection: 'row', gap: 8,
    paddingHorizontal: 32, marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  smsInput: { width: '100%', height: 50, borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, fontFamily: 'Inter_400Regular', textAlign: 'center', letterSpacing: 3 },

  footer: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    marginTop: 24,
  },
  footerText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  footerLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },

  skipRow: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  skipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 24,
    borderRadius: 12, borderWidth: 1.5,
  },
  skipBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium' },
});
