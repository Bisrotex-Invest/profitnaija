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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

// ── Timeout helper ────────────────────────────────────────────────────────────
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Server busy — ${label} timed out. Try again.`)),
        ms,
      ),
    ),
  ]);
}

// ── Error messages ────────────────────────────────────────────────────────────
function humanizeAuthError(err: { code?: string; message?: string }): string {
  console.log('[signUp] firebase error code:', err.code, '| message:', err.message);
  switch (err.code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Sign in instead.';
    case 'auth/weak-password':
      return 'Password is too weak. Use at least 6 characters.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/network-request-failed':
      return 'Network error. Check your internet connection.';
    case 'auth/invalid-api-key':
    case 'auth/app-not-authorized':
      return 'Firebase setup error. Check your API key configuration.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled in Firebase Console → Authentication → Sign-in method.';
    default:
      if (err.message?.includes('timed out')) return err.message!;
      return `Sign-up failed [${err.code ?? 'unknown'}]: ${err.message ?? 'Unknown error'}`;
  }
}

export default function SignUpScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { registerWithEmail } = useAuth();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const handleSignUp = async () => {
    setError('');
    if (!name.trim()) { setError('Please enter your full name.'); return; }
    if (!phone.trim()) { setError('Please enter your phone number.'); return; }
    if (!/^0[789]\d{9}$/.test(phone.trim())) { setError('Enter a valid Nigerian phone number (e.g. 08012345678).'); return; }
    if (!email.trim()) { setError('Please enter your email address.'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match. Please check and try again.'); return; }

    setLoading(true);
    try {
      console.log('[signUp] calling createUserWithEmailAndPassword…');
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject({ code: 'timeout', message: 'Network slow. Please try again.' }), 10000)
      );
      await Promise.race([registerWithEmail(name, phone, email, password), timeoutPromise]);
      console.log('[signUp] success');
      setLoading(false);
      router.replace('/(tabs)');
    } catch (error: any) {
      console.log('[signUp] error.code:', error.code, '| error.message:', error.message);
      setLoading(false);
      if (error.code === 'timeout') {
        Alert.alert('Error', 'Network slow. Please try again.');
      } else {
        Alert.alert('Error', error.code ?? error.message ?? 'Unknown error');
      }
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Green header banner ── */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 24 }]}>
        <Animated.View entering={FadeInUp.springify()} style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoSymbol}>₦</Text>
          </View>
          <Text style={styles.logoText}>ProfitNaija</Text>
          <Text style={styles.logoTagline}>Create your free account</Text>
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
          <Animated.View
            entering={FadeInDown.delay(100).springify()}
            style={[styles.card, { backgroundColor: colors.card, shadowColor: colors.headerBg }]}
          >
            <Text style={[styles.cardTitle, { color: colors.foreground }]}>Create Account</Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
              Start tracking your profits today
            </Text>

            {/* Error */}
            {!!error && (
              <View style={[styles.errorBanner, { backgroundColor: colors.expenseBg, borderColor: colors.expense + '55' }]}>
                <Feather name="alert-circle" size={14} color={colors.expense} />
                <Text style={[styles.errorText, { color: colors.expense }]}>{error}</Text>
              </View>
            )}

            {/* Full Name */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Full Name</Text>
              <View style={[styles.inputRow, { borderColor: colors.input, backgroundColor: colors.background }]}>
                <Feather name="user" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                  value={name}
                  onChangeText={(t) => { setName(t); setError(''); }}
                  placeholder="John Doe"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="words"
                  returnKeyType="next"
                  onSubmitEditing={() => phoneRef.current?.focus()}
                  editable={!loading}
                />
              </View>
            </View>

            {/* Phone Number */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Phone Number</Text>
              <View style={[styles.inputRow, { borderColor: colors.input, backgroundColor: colors.background }]}>
                <Feather name="phone" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  ref={phoneRef}
                  style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                  value={phone}
                  onChangeText={(t) => { setPhone(t); setError(''); }}
                  placeholder="08012345678"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="phone-pad"
                  returnKeyType="next"
                  onSubmitEditing={() => emailRef.current?.focus()}
                  editable={!loading}
                  maxLength={11}
                />
              </View>
            </View>

            {/* Email */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Email Address</Text>
              <View style={[styles.inputRow, { borderColor: colors.input, backgroundColor: colors.background }]}>
                <Feather name="mail" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  ref={emailRef}
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
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Password</Text>
              <View style={[styles.inputRow, { borderColor: colors.input, backgroundColor: colors.background }]}>
                <Feather name="lock" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  ref={passwordRef}
                  style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                  value={password}
                  onChangeText={(t) => { setPassword(t); setError(''); }}
                  placeholder="Min. 6 characters"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showPassword}
                  returnKeyType="next"
                  onSubmitEditing={() => confirmRef.current?.focus()}
                  editable={!loading}
                />
                <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                  <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>

            {/* Confirm Password */}
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm Password</Text>
              <View style={[
                styles.inputRow,
                {
                  borderColor: confirmPassword && confirmPassword !== password
                    ? colors.expense
                    : colors.input,
                  backgroundColor: colors.background,
                },
              ]}>
                <Feather name="lock" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  ref={confirmRef}
                  style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setError(''); }}
                  placeholder="Re-enter your password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry={!showConfirm}
                  returnKeyType="done"
                  onSubmitEditing={handleSignUp}
                  editable={!loading}
                />
                <Pressable onPress={() => setShowConfirm((v) => !v)} style={styles.eyeBtn}>
                  <Feather name={showConfirm ? 'eye-off' : 'eye'} size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
            </View>

            {/* Submit */}
            <Pressable
              onPress={handleSignUp}
              disabled={loading}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1 },
              ]}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>Create Account</Text>
              )}
            </Pressable>
          </Animated.View>

          {/* Sign in link */}
          <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
              Already have an account?{' '}
            </Text>
            <Pressable onPress={() => router.replace('/sign-in')} disabled={loading}>
              <Text style={[styles.footerLink, { color: colors.primary }]}>Sign In</Text>
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
    paddingBottom: 32,
    alignItems: 'center',
  },
  logoWrap: { alignItems: 'center', gap: 8 },
  logoCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 4,
  },
  logoSymbol: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#fff' },
  logoText: { fontSize: 24, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.5 },
  logoTagline: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', textAlign: 'center' },

  formContainer: { padding: 20, gap: 16 },
  card: {
    borderRadius: 20, padding: 24, gap: 18,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 5,
  },
  cardTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  cardSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: -12 },

  errorBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  errorText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1 },

  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontFamily: 'Inter_500Medium' },

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
