import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { getAuthInstance } from '@/lib/firebase';

export default function VerifyEmailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user, sendVerificationEmail, verifyEmailWithCode } = useAuth();
  // oobCode is present when this screen is opened via a Firebase email action link.
  const { oobCode } = useLocalSearchParams<{ oobCode?: string }>();

  const [resending, setResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [error, setError] = useState('');
  // 'idle' | 'verifying' | 'verified' | 'error'
  const [codeState, setCodeState] = useState<'idle' | 'verifying' | 'verified' | 'error'>('idle');

  // ── Auto-apply oobCode when the screen opens via deep link ─────────────────
  useEffect(() => {
    if (!oobCode) return;
    setCodeState('verifying');
    verifyEmailWithCode(oobCode)
      .then(async () => {
        await AsyncStorage.removeItem('pn_pending_verification').catch(() => {});
        setCodeState('verified');
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oobCode]);

  const [bypassing, setBypassing] = useState(false);

  // DEV bypass: reload user from Firebase, then enter the app regardless.
  const handleContinueAnyway = async () => {
    setBypassing(true);
    try {
      const a = await getAuthInstance();
      await a.currentUser?.reload();
    } catch {
      // Non-fatal — proceed even if reload fails
    } finally {
      await AsyncStorage.removeItem('pn_pending_verification').catch(() => {});
      router.replace('/(tabs)');
    }
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

        {/* ── Deep-link: verified successfully ── */}
        {codeState === 'verified' && (
          <View style={styles.centeredState}>
            <View style={[styles.successCircle, { backgroundColor: colors.secondary }]}>
              <Feather name="check-circle" size={40} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground, textAlign: 'center' }]}>
              Email Verified!
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground, textAlign: 'center' }]}>
              Your account is now active. Sign in to start tracking your profits.
            </Text>
            <Pressable
              onPress={() => router.replace('/sign-in')}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
              ]}
            >
              <Feather name="log-in" size={16} color="#fff" />
              <Text style={styles.primaryBtnText}>Sign In</Text>
            </Pressable>
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

      {/* ── Skip button ── */}
      {codeState !== 'verified' && (
        <Animated.View entering={FadeInDown.delay(300).springify()} style={styles.skipRow}>
          <Pressable
            onPress={handleContinueAnyway}
            disabled={bypassing}
            style={({ pressed }) => [
              styles.skipBtn,
              { borderColor: colors.input, opacity: pressed || bypassing ? 0.6 : 1 },
            ]}
          >
            {bypassing
              ? <ActivityIndicator size="small" color={colors.mutedForeground} />
              : <>
                  <Text style={[styles.skipBtnText, { color: colors.mutedForeground }]}>
                    Skip for now
                  </Text>
                  <Feather name="arrow-right" size={15} color={colors.mutedForeground} />
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
