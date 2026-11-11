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
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function ResetPasswordScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { resetPasswordWithCode } = useAuth();
  const { oobCode } = useLocalSearchParams<{ oobCode?: string }>();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleReset = async () => {
    setError('');
    if (!oobCode) {
      setError('Invalid or expired reset link. Request a new one from the Sign In screen.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      await resetPasswordWithCode(oobCode, password);
      setDone(true);
    } catch (err: any) {
      console.error(err);
      setLoading(false);
      const code = err?.code ?? '';
      let msg = err?.message ?? 'Could not reset password.';
      if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
        msg = 'This reset link has expired or already been used. Request a new one.';
      } else if (code === 'auth/weak-password') {
        msg = 'Password is too weak. Use at least 6 characters.';
      } else if (code === 'auth/network-request-failed') {
        msg = 'Network error. Check your internet connection.';
      }
      setError(msg);
      Alert.alert('Error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* ── Green header ── */}
      <View style={[styles.header, { backgroundColor: colors.headerBg, paddingTop: insets.top + 24 }]}>
        <Animated.View entering={FadeInUp.springify()} style={styles.headerContent}>
          <View style={styles.lockCircle}>
            <Feather name="key" size={28} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>Set New Password</Text>
          <Text style={styles.headerSubtitle}>Choose a strong new password</Text>
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
            {done ? (
              /* ── Success state ── */
              <View style={styles.successState}>
                <View style={[styles.successCircle, { backgroundColor: colors.secondary }]}>
                  <Feather name="check-circle" size={40} color={colors.primary} />
                </View>
                <Text style={[styles.successTitle, { color: colors.foreground }]}>
                  Password Updated!
                </Text>
                <Text style={[styles.successBody, { color: colors.mutedForeground }]}>
                  Your password has been reset successfully. You can now sign in with your new
                  password.
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
            ) : (
              /* ── Form ── */
              <>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>New Password</Text>
                <Text style={[styles.cardSubtitle, { color: colors.mutedForeground }]}>
                  Enter and confirm your new password below.
                </Text>

                {/* No oobCode warning */}
                {!oobCode && (
                  <View style={[styles.banner, { backgroundColor: colors.expenseBg, borderColor: colors.expense + '55' }]}>
                    <Feather name="alert-triangle" size={14} color={colors.expense} />
                    <Text style={[styles.bannerText, { color: colors.expense }]}>
                      No reset code found. Open the link from your email again.
                    </Text>
                  </View>
                )}

                {/* Error */}
                {!!error && (
                  <View style={[styles.banner, { backgroundColor: colors.expenseBg, borderColor: colors.expense + '55' }]}>
                    <Feather name="alert-circle" size={14} color={colors.expense} />
                    <Text style={[styles.bannerText, { color: colors.expense }]}>{error}</Text>
                  </View>
                )}

                {/* Password */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>New Password</Text>
                  <View style={[styles.inputRow, { borderColor: colors.input, backgroundColor: colors.background }]}>
                    <Feather name="lock" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                      value={password}
                      onChangeText={(t) => { setPassword(t); setError(''); }}
                      placeholder="Min. 6 characters"
                      placeholderTextColor={colors.mutedForeground}
                      secureTextEntry={!showPassword}
                      returnKeyType="next"
                      editable={!loading && !!oobCode}
                    />
                    <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                      <Feather name={showPassword ? 'eye-off' : 'eye'} size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                </View>

                {/* Confirm */}
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm Password</Text>
                  <View style={[
                    styles.inputRow,
                    {
                      borderColor: confirm && confirm !== password ? colors.expense : colors.input,
                      backgroundColor: colors.background,
                    },
                  ]}>
                    <Feather name="lock" size={16} color={colors.mutedForeground} style={styles.inputIcon} />
                    <TextInput
                      style={[styles.input, { color: colors.foreground, fontFamily: 'Inter_400Regular' }]}
                      value={confirm}
                      onChangeText={(t) => { setConfirm(t); setError(''); }}
                      placeholder="Re-enter new password"
                      placeholderTextColor={colors.mutedForeground}
                      secureTextEntry={!showConfirm}
                      returnKeyType="done"
                      onSubmitEditing={handleReset}
                      editable={!loading && !!oobCode}
                    />
                    <Pressable onPress={() => setShowConfirm((v) => !v)} style={styles.eyeBtn}>
                      <Feather name={showConfirm ? 'eye-off' : 'eye'} size={16} color={colors.mutedForeground} />
                    </Pressable>
                  </View>
                </View>

                <Pressable
                  onPress={handleReset}
                  disabled={loading || !oobCode}
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    { backgroundColor: colors.primary, opacity: pressed || loading || !oobCode ? 0.6 : 1 },
                  ]}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <Feather name="check" size={16} color="#fff" />
                      <Text style={styles.primaryBtnText}>Update Password</Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </Animated.View>

          {!done && (
            <Animated.View entering={FadeInDown.delay(200).springify()} style={styles.footer}>
              <Pressable onPress={() => router.replace('/sign-in')}>
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
    alignItems: 'center',
  },
  headerContent: { alignItems: 'center', gap: 10 },
  lockCircle: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: '#fff', letterSpacing: -0.5 },
  headerSubtitle: {
    fontSize: 13, fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)', textAlign: 'center',
  },

  formContainer: { padding: 20, gap: 16 },
  card: {
    borderRadius: 20, padding: 24, gap: 18,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 5,
  },
  cardTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', letterSpacing: -0.5 },
  cardSubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', lineHeight: 20, marginTop: -12 },

  banner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    padding: 12, borderRadius: 10, borderWidth: 1,
  },
  bannerText: { fontSize: 13, fontFamily: 'Inter_400Regular', flex: 1, lineHeight: 18 },

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
