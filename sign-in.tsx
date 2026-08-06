import React, { useState, useRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

function humanizeAuthError(err: { code?: string; message?: string }): string {
  switch (err.code) {
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password. Please try again.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support.';
    case 'auth/network-request-failed':
      return 'Network error. Check your internet connection and try again.';
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return 'Firebase setup error. Check your API key configuration.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled. Enable it in Firebase Console → Authentication → Sign-in method.';
    default:
      if (err.message?.includes('not configured') || err.message?.includes('EXPO_PUBLIC_')) {
        return 'Firebase is not configured. Check internet and Firebase setup, then restart the app.';
      }
      return `Sign-in failed [${err.code ?? 'unknown'}]: ${err.message ?? 'Unknown error'}`;
  }
}

export default function SignInScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const passwordRef = useRef<TextInput>(null);

  const handleSignIn = async () => {
    setError('');
    if (!email.trim()) { setError('Please enter your email.'); return; }
    if (!password) { setError('Please enter your password.'); return; }

    setLoading(true);
    try {
      console.log('[signIn] attempting sign in…');
      await Promise.race([
        signIn(email, password),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Server busy — sign in timed out. Try again.')), 10000),
        ),
      ]);
      console.log('[signIn] success');
      await AsyncStorage.removeItem('pn_pending_verification').catch(() => {});
      router.replace('/(tabs)');
    } catch (error: any) {
      console.log('[signIn] firebase error code:', error.code, '| message:', error.message);
      const msg = humanizeAuthError(error);
      setError(msg);
      Alert.alert('Login Failed', msg);
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Green header banner ── */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 32 }]}>
        <Animated.View entering={FadeInUp.springify()} style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoSymbol}>₦</Text>
          </View>
          <Text style={styles.logoText}>ProfitNaija</Text>
          <Text style={styles.logoTagline}>Track your profits, grow your business</Text>
        </Animated.View>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={[styles.formContainer, { paddingBottom: insets.bottom + 32 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Card ── */}
          <Animated.View
            entering={FadeInDown.delay(100).springify()}
            style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.headerBg }]}
          >
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Welcome Back</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              Sign in to your account
            </Text>

            {/* Error message */}
            {!!error && (
              <View style={[styles.errorBanner, { backgroundColor: colors.expenseBg, borderColor: colors.expense + '55' }]}>
                <Feather name="alert-circle" size={14} color={colors.expense} />
                <Text style={[styles.errorText, { color: colors.expense }]}>{error}</Text>
              </View>
            )}

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Email Address</Text>
              <View style={[styles.inputRow, { borderColor: colors.input, backgroundColor: colors.background }]}>
                <Feather name="mail" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                  value={email}
                  onChangeText={(t) => { setEmail(t); setError(''); }}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordRef.current?.focus()}
                  editable={!loading}
                />
              </View>
            </View>

            {/* Password */}
            <View style={styles.fieldGroup}>
              <View style={styles.labelRow}>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
                <Pressable onPress={() => router.push('/forgot-password')} disabled={loading}>
                  <Text style={[styles.forgotLink, { color: colors.primary }]}>Forgot Password?</Text>
                </Pressable>
              </View>
              <View style={[styles.inputRow, { borderColor: colors.input, backgroundColor: colors.background }]}>
                <Feather name="lock" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(''); }}
                  placeholder="Your password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleSignIn}
                  editable={!loading}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>

            {/* Submit */}
            <Pressable
              onPress={handleSignIn}
              disabled={loading}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1 },
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>Sign In</Text>
              )}
            </Pressable>
          </Animated.View>

          {/* ── Sign up link ── */}
          <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Don't have an account?{' '}
            </Text>
            <Pressable onPress={() => router.replace('/sign-up')} disabled={loading}>
              <Text style={[styles.footerLink, { color: colors.primary }]}>Sign Up</Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  logoWrap: { alignItems: 'center', gap: 8 },
  logoCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  logoSymbol: { fontSize: 32, fontFamily: 'Inter_700Bold', color: '#fff' },
  logoText: { fontSize: 26, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.5 },
  logoTagline: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', textAlign: 'center' },

  formContainer: { padding: 20, gap: 16 },
  card: {
    borderRadius: 20, padding: 24, gap: 20,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 5,
  },
  cardTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  cardSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: -14 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  errorText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },

  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  forgotLink: { fontSize: 13, fontFamily: 'Inter_500Medium' },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1.5, borderRadius: 12, paddingHorizontal: 12, height: 50,
  },
  inputIcon: { marginRight: 10 },
  input: { flex: 1, fontSize: 15, height: '100%' },
  eyeBtn: { padding: 4 },

  primaryBtn: {
    height: 52, borderRadius: 14, alignItems: 'center',
    justifyContent: 'center', marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  footerText: { fontSize: 14, fontFamily: 'Inter_400Regular' },
  footerLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
