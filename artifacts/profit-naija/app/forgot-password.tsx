import React, { useState } from 'react';
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

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { forgotPassword } = useAuth();

  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const handleSend = async () => {
    setError('');
    if (!email.trim()) { setError('Please enter your email address.'); return; }

    setLoading(true);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (err: any) {
      console.error(err);
      const code = err?.code ?? '';
      if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
        // Don't reveal if account exists; just show success for security
        setSent(true);
      } else if (code === 'auth/network-request-failed') {
        setLoading(false);
        setError('Network error. Check your internet connection.');
        Alert.alert('Network Error', 'Check your internet connection and try again.');
      } else {
        setLoading(false);
        setError('Could not send reset link. Please try again.');
        Alert.alert('Error', err?.message ?? 'Could not send reset link. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Green header */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 24 }]}>
        <Animated.View entering={FadeInUp.springify()} style={styles.headerContent}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Feather name="arrow-left" size={20} color="rgba(255,255,255,0.8)" />
          </Pressable>
          <View style={styles.lockCircle}>
            <Feather name="lock" size={28} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>Forgot Password?</Text>
          <Text style={styles.headerSubtitle}>
            We'll send a reset link to your email
          </Text>
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
            {sent ? (
              /* ── Success state ── */
              <View style={styles.successState}>
                <View style={[styles.successCircle, { backgroundColor: colors.secondary }]}>
                  <Feather name="check-circle" size={40} color={colors.primary} />
                </View>
                <Text style={[styles.successTitle, { color: colors.foreground }]}>
                  Reset Link Sent!
                </Text>
                <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
                  We've sent a password reset link to{'\n'}
                  <Text style={{ color: colors.primary, fontFamily: 'Inter_600SemiBold' }}>
                    {email}
                  </Text>
                  {'\n\n'}
                  Check your inbox (and spam folder) and follow the link to reset your password.
                </Text>
                <Pressable
                  onPress={() => router.replace('/sign-in')}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Feather name="arrow-left" size={16} color="#fff" />
                  <Text style={styles.primaryBtnText}>Back to Sign In</Text>
                </Pressable>
              </View>
            ) : (
              /* ── Form state ── */
              <>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>Reset Password</Text>
                <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
                  Enter your email and we'll send you a link to reset your password.
                </Text>

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
                      returnKeyType="done"
                      onSubmitEditing={handleSend}
                      editable={!loading}
                    />
                  </View>
                </View>

                <Pressable
                  onPress={handleSend}
                  disabled={loading}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: colors.primary, opacity: pressed || loading ? 0.8 : 1 },
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="send" size={16} color="#fff" />
                      <Text style={styles.primaryBtnText}>Send Reset Link</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </Animated.View>

          {!sent && (
            <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.footer}>
              <Pressable onPress={() => router.back()} disabled={loading}>
                <Text style={[styles.backLink, { color: colors.primary }]}>← Back to Sign In</Text>
              </Pressable>
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  headerContent: { alignItems: 'center', gap: 10 },
  backBtn: { alignSelf: 'flex-start', padding: 4, marginBottom: 8 },
  lockCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', textAlign: 'center' },

  formContainer: { padding: 20, gap: 16 },
  card: {
    borderRadius: 20, padding: 24, gap: 18,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 5,
  },
  cardTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  cardSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginTop: -12 },

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

  primaryBtn: {
    height: 52, borderRadius: 14, alignItems: 'center',
    justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  successState: { alignItems: 'center', gap: 16, paddingVertical: 8 },
  successCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  successBody: { fontSize: 14, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 22 },

  footer: { alignItems: 'center' },
  backLink: { fontSize: 14, fontFamily: 'Inter_600SemiBold' },
});
