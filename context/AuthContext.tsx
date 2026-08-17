import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import {
  User,
  ActionCodeSettings,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  applyActionCode,
  confirmPasswordReset,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { getAuthInstance, db } from '@/lib/firebase';
import {API_URL} from '../config';

// ── Action code settings ──────────────────────────────────────────────────────
// handleCodeInApp: true tells Firebase to format links so Android intent filters
// can open the app directly instead of routing through the browser.
const ACTION_CODE_SETTINGS: ActionCodeSettings = {
  url: 'https://profitnaija.firebaseapp.com',
  handleCodeInApp: true,
  android: {
    packageName: 'com.profitnaija.app',
    installApp: false,
  },
  iOS: {
    bundleId: 'com.profitnaija.app',
  },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthContextValue {
  user: User | null;
  loginWithEmail: (email: string, password: string) => Promise<User>;
  registerWithEmail: (name: string, phone: string, email: string, password: string) => Promise<any>;
  sendVerificationEmail: () => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  /** Apply a verifyEmail oobCode from a Firebase email action link. */
  verifyEmailWithCode: (oobCode: string) => Promise<void>;
  /** Apply a resetPassword oobCode + new password from a Firebase email action link. */
  resetPasswordWithCode: (oobCode: string, newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
const registerWithEmail = useCallback(async (name: string, phone: string, email: string, password: string) => {
  // 1. Create user in Firebase
  const cred = await createUserWithEmailAndPassword(getAuthInstance(), email, password);
  await updateProfile(cred.user, { displayName: name.trim() });
  const idToken = await cred.user.getIdToken();

  // 2. Create user in YOUR Render backend
  await fetch(`${API_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
    body: JSON.stringify({ email, name, phone })
  });

  // 3. Save to Firestore too
  await setDoc(doc(db, 'users', cred.user.uid), {
    name: name.trim(),
    phone: phone.trim(),
    email: email.trim(),
    createdAt: Date.now(),
  }).catch(() => {});
  
  setUser(cred.user);
  return cred.user;
}, []);
  const loginWithEmail = useCallback(async (email: string, password: string) => {
  // 1. Login with Firebase
  const cred = await signInWithEmailAndPassword(getAuthInstance(), email, password);
  const idToken = await cred.user.getIdToken();
  
  // 2. Tell your Render backend
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${idToken}`
    },
  });
  
  if (!res.ok) throw new Error('Backend login failed');
  const backendData = await res.json();
  
  setUser(cred.user);
  return { firebaseUser: cred.user, backendUser: backendData };
}, []);
  

  const sendVerificationEmail = useCallback(async () => {
    const u = (await getAuthInstance()).currentUser;
    if (!u) throw new Error('No authenticated user. Please sign in first.');
    await sendEmailVerification(u, ACTION_CODE_SETTINGS);
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    const a = await getAuthInstance();
    await sendPasswordResetEmail(a, email.trim(), ACTION_CODE_SETTINGS);
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

  return (
    <AuthContext.Provider value={{ user, loginWithEmail, registerWithEmail, sendVerificationEmail, forgotPassword, verifyEmailWithCode, resetPasswordWithCode, signOut }}>
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
