import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
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
import {
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  setPersistence,
} from '@firebase/auth';
import { AppState, Platform } from 'react-native';
import { doc, setDoc } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getAuthInstance, db } from '@/lib/firebase';
import { defaultDashboardSelection, type DashboardPeriodSelection } from '@/lib/dashboardPeriod';

const SESSION_IDLE_LIMIT_MS = 20 * 60 * 1000;
const lastActivityKey = (uid: string) => `pn_last_activity_${uid}`;

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
  sessionExpired: boolean;
  recordActivity: () => void;
  signIn: (email: string, password: string, rememberMe?: boolean) => Promise<User>;
  signUp: (name: string, phone: string, email: string, password: string) => Promise<User>;
  refreshUser: () => Promise<User | null>;
  sendVerificationEmail: (name?: string) => Promise<void>;
  sendOnboardingWelcomeEmail: () => Promise<void>;
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
  const [sessionExpired, setSessionExpired] = useState(false);
  const [dashboardPeriodSelection, setDashboardPeriodSelection] = useState<DashboardPeriodSelection>(() => defaultDashboardSelection());
  const lastActivityAt = useRef(0);
  const lastActivityPersistedAt = useRef(0);

  useEffect(() => {
    setDashboardPeriodSelection(defaultDashboardSelection());
  }, [user?.uid]);

  // React Native Firebase Auth persists sessions in AsyncStorage. Wait for that
  // persisted session to hydrate before routing so a backgrounded or restarted
  // app does not send an already-signed-in user back to onboarding/sign-in.
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let mounted = true;
    let authEventVersion = 0;
    getAuthInstance()
      .then((auth) => {
        if (!mounted) return;
        unsubscribe = onAuthStateChanged(
          auth,
          (nextUser) => {
            const eventVersion = ++authEventVersion;
            void (async () => {
              if (nextUser && Platform.OS !== 'web') {
                const key = lastActivityKey(nextUser.uid);
                let storedAt = 0;
                try {
                  const value = await AsyncStorage.getItem(key);
                  const parsed = value ? Number(value) : 0;
                  if (Number.isFinite(parsed) && parsed > 0) storedAt = parsed;
                } catch {
                  // If the local timestamp is unavailable, start a fresh timer.
                }
                if (!mounted || eventVersion !== authEventVersion) return;
                if (storedAt && Date.now() - storedAt >= SESSION_IDLE_LIMIT_MS) {
                  setSessionExpired(true);
                  await AsyncStorage.removeItem(key).catch(() => {});
                  await firebaseSignOut(auth).catch(() => {});
                  return;
                }
                const now = Date.now();
                lastActivityAt.current = storedAt || now;
                lastActivityPersistedAt.current = storedAt || now;
                if (!storedAt) AsyncStorage.setItem(key, String(now)).catch(() => {});
              } else {
                lastActivityAt.current = 0;
                lastActivityPersistedAt.current = 0;
              }
              if (!mounted || eventVersion !== authEventVersion) return;
              setUser(nextUser);
              setAuthLoading(false);
            })();
          },
          () => { if (mounted) setAuthLoading(false); },
        );
      })
      .catch(() => { if (mounted) setAuthLoading(false); });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const signOut = useCallback(async () => {
    const knownUid = user?.uid;
    try {
      const a = await getAuthInstance();
      const uid = a.currentUser?.uid ?? knownUid;
      if (uid) await AsyncStorage.removeItem(lastActivityKey(uid)).catch(() => {});
      await firebaseSignOut(a);
    } catch {
      if (knownUid) await AsyncStorage.removeItem(lastActivityKey(knownUid)).catch(() => {});
    } finally {
      lastActivityAt.current = 0;
      lastActivityPersistedAt.current = 0;
      setUser(null);
    }
  }, [user?.uid]);

  const recordActivity = useCallback(() => {
    const uid = user?.uid;
    if (!uid || Platform.OS === 'web') return;
    const now = Date.now();
    if (lastActivityAt.current && now - lastActivityAt.current >= SESSION_IDLE_LIMIT_MS) {
      setSessionExpired(true);
      void signOut();
      return;
    }
    lastActivityAt.current = now;
    if (now - lastActivityPersistedAt.current >= 3_000) {
      lastActivityPersistedAt.current = now;
      AsyncStorage.setItem(lastActivityKey(uid), String(now)).catch(() => {});
    }
  }, [user?.uid, signOut]);

  useEffect(() => {
    if (!user || Platform.OS === 'web') return;
    const checkIdleTimeout = () => {
      if (lastActivityAt.current && Date.now() - lastActivityAt.current >= SESSION_IDLE_LIMIT_MS) {
        setSessionExpired(true);
        void signOut();
      }
    };
    const timer = setInterval(checkIdleTimeout, 15_000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') checkIdleTimeout();
    });
    return () => {
      clearInterval(timer);
      appStateSubscription.remove();
    };
  }, [user?.uid, signOut]);

  const signIn = useCallback(async (email: string, password: string, rememberMe = true): Promise<User> => {
    const a = await getAuthInstance();
    if (Platform.OS === 'web') {
      await setPersistence(a, rememberMe ? browserLocalPersistence : browserSessionPersistence);
    } else {
      const { getReactNativePersistence } = await import('@firebase/auth');
      await setPersistence(a, rememberMe ? getReactNativePersistence(AsyncStorage) : inMemoryPersistence);
    }
    const cred = await signInWithEmailAndPassword(a, email.trim(), password);
    const now = Date.now();
    lastActivityAt.current = now;
    lastActivityPersistedAt.current = now;
    setSessionExpired(false);
    await AsyncStorage.setItem(lastActivityKey(cred.user.uid), String(now)).catch(() => {});
    setUser(cred.user);
    return cred.user;
  }, []);

  const signUp = useCallback(async (name: string, phone: string, email: string, password: string): Promise<User> => {
    const a = await getAuthInstance();
    const cred = await createUserWithEmailAndPassword(a, email.trim(), password);
    const now = Date.now();
    lastActivityAt.current = now;
    lastActivityPersistedAt.current = now;
    setSessionExpired(false);
    await AsyncStorage.setItem(lastActivityKey(cred.user.uid), String(now)).catch(() => {});
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

  const sendVerificationEmail = useCallback(async (name?: string) => {
    const u = (await getAuthInstance()).currentUser;
    if (!u) throw new Error('No authenticated user. Please sign in first.');
    await requestAuthEmail(
      '/auth/email/verification',
      name?.trim() ? { name: name.trim() } : undefined,
      await u.getIdToken(),
    );
  }, []);

  const sendOnboardingWelcomeEmail = useCallback(async () => {
    const u = (await getAuthInstance()).currentUser;
    if (!u) throw new Error('No authenticated user. Please sign in first.');
    await requestAuthEmail('/auth/email/welcome', undefined, await u.getIdToken());
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
    setSessionExpired(false);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ dashboardPeriodSelection, setDashboardPeriodSelection, user, authLoading, sessionExpired, recordActivity, signIn, signUp, refreshUser, sendVerificationEmail, sendOnboardingWelcomeEmail, forgotPassword, verifyEmailWithCode, resetPasswordWithCode, signOut, deleteAccount }}>
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
