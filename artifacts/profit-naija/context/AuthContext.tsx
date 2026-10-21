import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from 'react';
import {
  User,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  applyActionCode,
  confirmPasswordReset,
  signOut as firebaseSignOut,
  updateProfile,
  EmailAuthProvider,
  reauthenticateWithCredential,
  onAuthStateChanged,
} from 'firebase/auth';
import { Platform } from 'react-native';
import { doc, setDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthInstance, db } from '@/lib/firebase';
import { defaultDashboardSelection, type DashboardPeriodSelection } from '@/lib/dashboardPeriod';

function apiBase(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/api`;
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error('Server domain is unavailable.');
  return `https://${domain}/api`;
}

async function requestAuthEmail(path: string, body?: object, token?: string) {
  const response = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'Could not send the email. Please try again.');
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  dashboardPeriodSelection: DashboardPeriodSelection;
  setDashboardPeriodSelection: (selection: DashboardPeriodSelection) => void;
  user: User | null;
  authLoading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (name: string, phone: string, email: string, password: string) => Promise<User>;
  refreshUser: () => Promise<User | null>;
  sendVerificationEmail: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  /** Apply a verifyEmail oobCode from a Firebase email action link. */
  verifyEmailWithCode: (oobCode: string) => Promise<void>;
  /** Apply a resetPassword oobCode + new password from a Firebase email action link. */
  resetPasswordWithCode: (oobCode: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Permanently delete the user's data and account. Requires their password. */
  deleteAccount: (password: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [dashboardPeriodSelection, setDashboardPeriodSelection] = useState<DashboardPeriodSelection>(() => defaultDashboardSelection());

  useEffect(() => {
    setDashboardPeriodSelection(defaultDashboardSelection());
  }, [user?.uid]);

  // React Native Firebase Auth persists sessions in AsyncStorage. Wait for that
  // persisted session to hydrate before routing so a backgrounded or restarted
  // app does not send an already-signed-in user back to onboarding/sign-in.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let mounted = true;
    getAuthInstance()
      .then((auth) => {
        if (!mounted) return;
        unsubscribe = onAuthStateChanged(
          auth,
          (nextUser) => {
            setUser(nextUser);
            setAuthLoading(false);
          },
          () => setAuthLoading(false),
        );
      })
      .catch(() => setAuthLoading(false));
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<User> => {
    const a = await getAuthInstance();
    const cred = await signInWithEmailAndPassword(a, email.trim(), password);
    setUser(cred.user);
    return cred.user;
  }, []);

  const signUp = useCallback(async (name: string, phone: string, email: string, password: string): Promise<User> => {
    const a = await getAuthInstance();
    const cred = await createUserWithEmailAndPassword(a, email.trim(), password);
    // Fire-and-forget — do NOT await these; they can hang on slow networks
    // and block the user from reaching the dashboard.
    if (name.trim()) {
      updateProfile(cred.user, { displayName: name.trim() }).catch(() => {});
    }
    setDoc(doc(db, 'users', cred.user.uid), {
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      createdAt: Date.now(),
    }).catch(() => {});
    await requestAuthEmail('/auth/email/verification', undefined, await cred.user.getIdToken());
    setUser(cred.user);
    return cred.user;
  }, []);

  const refreshUser = useCallback(async (): Promise<User | null> => {
    const a = await getAuthInstance();
    const current = a.currentUser;
    if (!current) {
      setUser(null);
      return null;
    }
    await current.reload();
    setUser(a.currentUser);
    return a.currentUser;
  }, []);

  const sendVerificationEmail = useCallback(async () => {
    const u = (await getAuthInstance()).currentUser;
    if (!u) throw new Error('No authenticated user. Please sign in first.');
    await requestAuthEmail('/auth/email/verification', undefined, await u.getIdToken());
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    await requestAuthEmail('/auth/email/password-reset', { email: email.trim() });
  }, []);

  const verifyEmailWithCode = useCallback(async (oobCode: string) => {
    const a = await getAuthInstance();
    await applyActionCode(a, oobCode);
    // Refresh the local user so emailVerified reflects the change
    await a.currentUser?.reload();
    setUser(a.currentUser);
  }, []);

  const resetPasswordWithCode = useCallback(async (oobCode: string, newPassword: string) => {
    const a = await getAuthInstance();
    await confirmPasswordReset(a, oobCode, newPassword);
  }, []);

  const signOut = useCallback(async () => {
    try {
      const a = await getAuthInstance();
      await firebaseSignOut(a);
    } catch {
      // Swallow — always clear local state
    } finally {
      setUser(null);
    }
  }, []);

  // Permanently delete all Firestore data + the Firebase Auth account.
  // Firebase requires a recent sign-in for account deletion, so we
  // re-authenticate with the user's password first.
  const deleteAccount = useCallback(async (password: string) => {
    const a = await getAuthInstance();
    const current = a.currentUser;
    if (!current || !current.email) throw new Error('No authenticated user. Please sign in again.');

    // 1. Re-authenticate (throws auth/wrong-password if incorrect)
    const cred = EmailAuthProvider.credential(current.email, password);
    await reauthenticateWithCredential(current, cred);

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
    await requestAuthEmail('/account/delete', { requestId }, await current.getIdToken(true));
    await AsyncStorage.clear().catch(() => {});
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ dashboardPeriodSelection, setDashboardPeriodSelection, user, authLoading, signIn, signUp, refreshUser, sendVerificationEmail, forgotPassword, verifyEmailWithCode, resetPasswordWithCode, signOut, deleteAccount }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
