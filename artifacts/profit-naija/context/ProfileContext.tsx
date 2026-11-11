/**
 * ProfileContext — persists personal + business profile.
 * Source of truth is Firestore (users/{uid}.profile) when signed in, with a
 * per-user AsyncStorage cache as offline fallback. Loads on mount and again
 * whenever the signed-in user changes; exposes saveProfile() for partial updates.
 *
 * Account isolation: each uid has its own cache key, and state resets to
 * DEFAULTS the moment the signed-in user changes, so one account's profile is
 * never shown to — or uploaded for — another account on the same device.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { normalizeAccountingYearEnd, validAccountingYearEnd } from '@workspace/accounting-core';
import { db } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import type { SubscriptionSetupState } from '@workspace/accounting-core';

export interface UserProfile {
  // Personal
  fullName: string;
  gender: string;
  phone: string;
  email: string;
  homeAddress: string;
  photoUri: string;
  // Business
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  natureOfBusiness: string;
  /** Annual income tax rate in percent (e.g. "20" = 20%). Empty = 0%. */
  incomeTaxRate: string;
  accountingYearEnd: string;
  accountingYearConfirmed: boolean;
  /** Set to true once the user accepts the Terms & Conditions. */
  termsAccepted: boolean;
  /** Set to true when the user accepts the Privacy Policy during onboarding. */
  privacyPolicyAccepted: boolean;
}

export const BUSINESS_TYPES = [
  'Trading',
  'Artisan / Crafts',
  'Food & Beverage',
  'Fashion & Clothing',
  'Electronics & Gadgets',
  'Agriculture / Farming',
  'Beauty & Cosmetics',
  'Auto / Mechanic',
  'Building Materials',
  'Healthcare / Pharmacy',
  'Education / Tutoring',
  'Transport / Logistics',
  'Other',
] as const;

const DEFAULTS: UserProfile = {
  fullName: '',
  gender: '',
  phone: '',
  email: '',
  homeAddress: '',
  photoUri: '',
  businessName: '',
  businessAddress: '',
  businessPhone: '',
  natureOfBusiness: '',
  incomeTaxRate: '',
  accountingYearEnd: '12-31',
  accountingYearConfirmed: false,
  termsAccepted: false,
  privacyPolicyAccepted: false,
};

/**
 * Legacy (pre cloud-sync) cache key. Not scoped to a user, so it is only ever
 * consumed once as a migration seed (then deleted) — never displayed directly
 * to a signed-in user. Still used as the live cache while signed out.
 */
const LEGACY_STORAGE_KEY = 'pn_user_profile';
const storageKeyFor = (uid: string) => `pn_user_profile:${uid}`;

/** Keep only known profile keys so stray Firestore fields can't pollute state. */
function sanitize(raw: any): Partial<UserProfile> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Partial<UserProfile> = {};
  (Object.keys(DEFAULTS) as (keyof UserProfile)[]).forEach((k) => {
    if (raw[k] !== undefined && raw[k] !== null) (out as any)[k] = raw[k];
  });
  out.termsAccepted = raw.termsAccepted === true;
  out.privacyPolicyAccepted = raw.privacyPolicyAccepted === true;
  out.accountingYearEnd = normalizeAccountingYearEnd(raw.accountingYearEnd);
  out.accountingYearConfirmed = raw.accountingYearConfirmed === true && validAccountingYearEnd(raw.accountingYearEnd);
  return out;
}

async function readCache(key: string): Promise<Partial<UserProfile>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {}
  return {};
}

function hydrateProfile(raw: any, cached: Partial<UserProfile>, user: { displayName?: string | null; email?: string | null } | null): UserProfile {
  const remote = sanitize(raw?.profile);
  const next = { ...DEFAULTS, ...cached, ...remote };
  if (!next.fullName.trim()) next.fullName = String(raw?.name || user?.displayName || cached.fullName || '');
  if (!next.phone.trim()) next.phone = String(raw?.phone || cached.phone || '');
  if (!next.email.trim()) next.email = String(user?.email || raw?.email || cached.email || '');
  return next;
}

interface ProfileContextValue {
  profile: UserProfile;
  saveProfile: (partial: Partial<UserProfile>, options?: { requireCloudSync?: boolean }) => Promise<void>;
  profileLoading: boolean;
  subscriptionSetup: SubscriptionSetupState | null;
  onboardingWelcomeEmailEligible: boolean;
  onboardingWelcomeEmailAccepted: boolean;
  completeSubscriptionSetup: () => Promise<void>;
}

const ProfileContext = createContext<ProfileContextValue>({
  profile: DEFAULTS,
  saveProfile: async () => {},
  profileLoading: true,
  subscriptionSetup: null,
  onboardingWelcomeEmailEligible: false,
  onboardingWelcomeEmailAccepted: false,
  completeSubscriptionSetup: async () => {},
});

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const userId = user?.uid ?? null;
  const [profile, setProfile] = useState<UserProfile>(DEFAULTS);
  const [profileLoading, setProfileLoading] = useState(true);
  const [subscriptionSetup, setSubscriptionSetup] = useState<SubscriptionSetupState | null>(null);
  const [onboardingWelcomeEmailEligible, setOnboardingWelcomeEmailEligible] = useState(false);
  const [onboardingWelcomeEmailAccepted, setOnboardingWelcomeEmailAccepted] = useState(false);
  // Latest profile, so saveProfile always merges onto fresh state even when
  // multiple saves race (e.g. photo + fields saved back-to-back).
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    let cancelled = false;
    // Reset immediately on any auth transition so a previous account's
    // profile can never bleed into the next one.
    setProfile(DEFAULTS);
    profileRef.current = DEFAULTS;
    setSubscriptionSetup(null);
    setOnboardingWelcomeEmailEligible(false);
    setOnboardingWelcomeEmailAccepted(false);
    setProfileLoading(true);

    (async () => {
      if (!userId) {
        // Signed out: device-local cache only (e.g. terms accepted pre-auth).
        const local = await readCache(LEGACY_STORAGE_KEY);
        if (!cancelled && Object.keys(local).length) {
          setProfile({ ...DEFAULTS, ...local });
        }
        return;
      }

      // 1. This user's own cache — instant, works offline.
      const cached = await readCache(storageKeyFor(userId));
      if (!cancelled && Object.keys(cached).length) {
        setProfile({ ...DEFAULTS, ...cached });
      }

      // 2. Firestore is the source of truth when reachable.
      try {
        const snap = await getDoc(doc(db, 'users', userId));
        const raw = snap.exists() ? snap.data() as any : null;
        if (!cancelled) {
          setSubscriptionSetup(raw?.subscriptionSetup ?? null);
          setOnboardingWelcomeEmailEligible(raw?.onboardingWelcomeEmailEligible === true);
          setOnboardingWelcomeEmailAccepted(raw?.onboardingWelcomeEmail?.status === 'accepted' || Boolean(raw?.onboardingWelcomeEmail?.acceptedAt));
        }
        let base = cached;
        if (!Object.keys(sanitize(raw?.profile)).length && !Object.keys(cached).length) {
          // No cloud profile and no per-user cache: one-time migration of the
          // legacy pre-cloud-sync cache. Consume-and-delete so it can only
          // ever seed the first account that signs in after the upgrade.
          const legacy = await readCache(LEGACY_STORAGE_KEY);
          if (Object.keys(legacy).length) {
            await AsyncStorage.removeItem(LEGACY_STORAGE_KEY).catch(() => {});
            base = legacy;
            setDoc(doc(db, 'users', userId), { profile: legacy }, { merge: true }).catch(() => {});
          }
        }
        const next = hydrateProfile(raw, base, user);
        if (!cancelled) {
          profileRef.current = next;
          setProfile(next);
        }
        AsyncStorage.setItem(storageKeyFor(userId), JSON.stringify(next)).catch(() => {});
      } catch (e: any) {
        // Offline or Firestore unavailable — keep this user's local cache.
        console.warn('[ProfileContext] cloud load failed, using local cache', e?.code ?? e?.message);
      }
    })().finally(() => {
      if (!cancelled) setProfileLoading(false);
    });

    const unsubscribe = userId ? onSnapshot(doc(db, 'users', userId), snap => {
      if (cancelled || !snap.exists()) return;
      const raw = snap.data();
      setSubscriptionSetup(raw.subscriptionSetup ?? null);
      setOnboardingWelcomeEmailEligible(raw.onboardingWelcomeEmailEligible === true);
      setOnboardingWelcomeEmailAccepted(raw.onboardingWelcomeEmail?.status === 'accepted' || Boolean(raw.onboardingWelcomeEmail?.acceptedAt));
      const next = hydrateProfile(raw, profileRef.current, user);
      profileRef.current = next;
      setProfile(next);
      AsyncStorage.setItem(storageKeyFor(userId), JSON.stringify(next))
        .catch(error => console.warn('[ProfileContext] cache sync failed', error?.message));
    }, error => console.warn('[ProfileContext] profile sync unavailable', error.code)) : undefined;
    return () => { cancelled = true; unsubscribe?.(); };
  }, [userId]);

  const saveProfile = async (partial: Partial<UserProfile>, options: { requireCloudSync?: boolean } = {}) => {
    if (partial.accountingYearEnd !== undefined && !validAccountingYearEnd(partial.accountingYearEnd)) {
      throw new Error('Select a valid accounting year-end.');
    }
    const next = { ...profileRef.current, ...partial };
    if (
      profileRef.current.termsAccepted !== true &&
      (next.termsAccepted !== true || next.privacyPolicyAccepted !== true)
    ) {
      throw new Error('Accept the Terms and Conditions and Privacy Policy before saving your profile.');
    }
    const enablesWelcomeEmail = options.requireCloudSync &&
      partial.termsAccepted === true &&
      partial.privacyPolicyAccepted === true &&
      profileRef.current.termsAccepted !== true;
    if (options.requireCloudSync) {
      if (!userId) throw new Error('Sign in again before completing your profile.');
      try {
        await setDoc(doc(db, 'users', userId), {
          profile: partial,
          ...(enablesWelcomeEmail ? { onboardingWelcomeEmailEligible: true } : {}),
        }, { merge: true });
      } catch {
        throw new Error('Your profile could not be synced. Check your connection and try saving again.');
      }
      if (enablesWelcomeEmail) setOnboardingWelcomeEmailEligible(true);
    }
    profileRef.current = next;
    setProfile(next);
    const key = userId ? storageKeyFor(userId) : LEGACY_STORAGE_KEY;
    await AsyncStorage.setItem(key, JSON.stringify(next));
    // Sync to the cloud when signed in. Fire-and-forget: an offline save must
    // not fail — Firestore will also retry queued writes while the app is open.
    if (userId) {
      if (options.requireCloudSync) return;
      const write = setDoc(doc(db, 'users', userId), { profile: partial }, { merge: true });
      if (partial.accountingYearEnd !== undefined || partial.accountingYearConfirmed !== undefined) {
        try { await write; }
        catch { throw new Error('Saved on this device, but cloud sync failed. Reconnect and save again to update both apps.'); }
      } else {
        write.catch((e: any) => console.warn('[ProfileContext] cloud save failed (kept locally)', e?.code ?? e?.message));
      }
    }
  };

  const completeSubscriptionSetup = useCallback(async () => {
    if (!userId) return;
    await setDoc(doc(db, 'users', userId), {
      subscriptionSetup: { completedAt: serverTimestamp() },
    }, { merge: true });
  }, [userId]);

  return (
    <ProfileContext.Provider value={{ profile, saveProfile, profileLoading, subscriptionSetup, onboardingWelcomeEmailEligible, onboardingWelcomeEmailAccepted, completeSubscriptionSetup }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
