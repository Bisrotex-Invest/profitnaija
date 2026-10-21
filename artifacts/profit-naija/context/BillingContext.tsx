/**
 * BillingContext — ProfitNaija subscription state (Paystack, via our API server).
 *
 * Pricing: ₦3,000/month + 7.5% VAT = ₦3,225 total. New users get a 7-day free
 * trial after adding a payment method (₦50 card-check charge tokenizes it).
 * Yearly options offer a 10% discount.
 *
 * The server computes status live from Paystack; we cache the last known
 * status per-user so a paying user is never locked out while offline.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '@/context/AuthContext';
import {
  getRevenueCatCustomerInfo,
  logOutRevenueCat,
  purchaseRevenueCatPlan,
  restoreRevenueCatPurchases,
  getRevenueCatOfferings,
} from '@/lib/revenuecat';
import { planFromRevenueCatProductIdentifier, intervalFromRevenueCatProductIdentifier } from '@/lib/revenuecatHelpers';
import { canPurchaseGooglePlay, isWithinLegacyBillingGrace, usesPaystackManagement } from '@/lib/billingPolicy';

export interface BillingStatus {
  /** none = never subscribed · trial · active · expired = lapsed · unknown = can't reach server */
  state: 'none' | 'trial' | 'active' | 'expired' | 'unknown';
  hasAccess: boolean;
  everSubscribed?: boolean;
  currentPlan: 'starter' | 'pro' | 'business' | 'none';
  currentPlanName?: string | null;
  billingInterval?: 'monthly' | 'yearly';
  baseAmountNaira?: number | null;
  nextRenewalDate?: string | null;
  paymentStatus?: string;
  failedRenewalReason?: string | null;
  reconciliationState?: 'none' | 'payment_received_access_pending';
  reconciliationMessage?: string | null;
  isAdmin?: boolean;
  freeGrant?: boolean;
  grantType?: string;
  accessCode?: string;
  accessReason?: string;
  entitlementSource: 'google_play' | 'paystack' | 'grant/admin' | 'none';
}

const UNKNOWN: BillingStatus = {
  state: 'unknown',
  hasAccess: false,
  currentPlan: 'none',
  billingInterval: 'monthly',
  accessCode: 'BILLING_STATUS_UNKNOWN',
  accessReason: 'We could not confirm your access. Check your connection and try again.',
  entitlementSource: 'none',
};

function apiBase(): string | null {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/api` : null;
}

export interface NativePrices {
  starter: { monthly: string | null; yearly: string | null };
  pro: { monthly: string | null; yearly: string | null };
}

interface BillingContextValue {
  billing: BillingStatus;
  billingLoading: boolean;
  hasProAccess: boolean;
  /** Refetch status from the server. */
  refreshBilling: () => Promise<BillingStatus>;
  /** Open Paystack checkout to add a payment method / subscribe. Resolves after the browser closes. */
  startCheckout: (planCode: 'starter' | 'pro', interval?: 'monthly' | 'yearly') => Promise<BillingStatus>;
  /** Switch to a different plan when already subscribed. */
  switchPlan: (planCode: 'starter' | 'pro', interval?: 'monthly' | 'yearly') => Promise<BillingStatus>;
  /** Open Paystack's card-update / cancel page. */
  openManage: () => Promise<void>;
  /** Cancel auto renewal. */
  cancelRenewal: () => Promise<void>;
  /** List billing payment history. */
  listPayments: () => Promise<any[]>;
  nativePrices: NativePrices;
  restorePurchases: () => Promise<void>;
}

const BillingContext = createContext<BillingContextValue>({
  billing: UNKNOWN,
  billingLoading: true,
  hasProAccess: false,
  refreshBilling: async () => UNKNOWN,
  startCheckout: async () => UNKNOWN,
  switchPlan: async () => UNKNOWN,
  openManage: async () => {},
  cancelRenewal: async () => {},
  listPayments: async () => [],
  nativePrices: { starter: { monthly: null, yearly: null }, pro: { monthly: null, yearly: null } },
  restorePurchases: async () => {},
});

export function BillingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const email = user?.email?.toLowerCase() ?? null;
  const uid = user?.uid ?? null;
  const [billing, setBilling] = useState<BillingStatus>(UNKNOWN);
  const [billingLoading, setBillingLoading] = useState(true);
  const [nativePrices, setNativePrices] = useState<NativePrices>({
    starter: { monthly: null, yearly: null },
    pro: { monthly: null, yearly: null },
  });

  const verifiedLegacyRef = useRef<{ status: BillingStatus; verifiedAt: number } | null>(null);

  // All billing endpoints authenticate with the Firebase ID token; the server
  // derives the billing email from the verified token, never from the client.
  const authHeaders = useCallback(async () => {
    const token = await user?.getIdToken();
    if (!token) throw new Error('You must be signed in first.');
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  }, [user]);

  const fetchStatus = useCallback(async (): Promise<BillingStatus> => {
    const base = apiBase();
    if (!base || !email) return UNKNOWN;
    const res = await fetch(`${base}/billing/status`, { headers: await authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.accessReason ?? body.error ?? `status ${res.status}`);
    }
    const data = await res.json();
    return {
      state: data.state ?? 'unknown',
      hasAccess: !!data.hasAccess,
      everSubscribed: !!data.everSubscribed,
      currentPlan: data.currentPlan ?? 'none',
      currentPlanName: data.currentPlanName ?? null,
      billingInterval: data.billingInterval === 'yearly' ? 'yearly' : 'monthly',
      baseAmountNaira: data.baseAmountNaira ?? null,
      nextRenewalDate: data.nextRenewalDate ?? data.nextPaymentDate ?? null,
      paymentStatus: data.paymentStatus ?? null,
      failedRenewalReason: data.failedRenewalReason ?? null,
      reconciliationState: data.reconciliationState ?? 'none',
      reconciliationMessage: data.reconciliationMessage ?? null,
      isAdmin: !!data.isAdmin,
      freeGrant: !!data.freeGrant,
      grantType: data.grantType,
      accessCode: data.accessCode,
      accessReason: data.accessReason,
      entitlementSource: data.entitlementSource ?? 'none',
    };
  }, [email]);

  const applyNativeEntitlement = useCallback(async (
    status: BillingStatus,
    purchaseCustomerInfo?: Awaited<ReturnType<typeof getRevenueCatCustomerInfo>>,
  ): Promise<BillingStatus> => {
    if (Platform.OS !== 'android' || !uid) return status;
    const info = purchaseCustomerInfo ?? await getRevenueCatCustomerInfo(uid);
    const entitlement = info?.entitlements.active?.paid_access;
    if (!entitlement) return status;
    const identifier = entitlement.productIdentifier || '';
    const plan = planFromRevenueCatProductIdentifier(identifier);
    if (!plan || entitlement.isActive === false) return status;
    return {
      ...status,
      state: 'active' as const,
      hasAccess: true,
      everSubscribed: true,
      currentPlan: plan,
      currentPlanName: plan === 'pro' ? 'ProfitNaija Pro' : 'ProfitNaija Starter',
      billingInterval: intervalFromRevenueCatProductIdentifier(identifier) ?? 'monthly',
      accessCode: 'REVENUECAT_ACTIVE',
      accessReason: 'Your Google Play subscription is active.',
      entitlementSource: 'google_play' as const,
    };
  }, [uid]);

  const refreshBilling = useCallback(async () => {
    if (!uid || !email) return UNKNOWN;
    try {
      const status = await fetchStatus();
      const unified = await applyNativeEntitlement(status);
      setBilling(unified);
      if (unified.entitlementSource === 'paystack' && unified.hasAccess) {
        verifiedLegacyRef.current = { status: unified, verifiedAt: Date.now() };
      }
      return unified;
    } catch (e: any) {
      console.warn('[Billing] status fetch failed:', e?.message);
      // Offline / server unreachable: fall back to the last known status so a
      // paying user keeps access; a never-subscribed user stays gated.
      try {
        const native = Platform.OS === 'android' ? await applyNativeEntitlement(UNKNOWN).catch(() => UNKNOWN) : UNKNOWN;
        if (native.hasAccess) { setBilling(native); return native; }
        const verified = verifiedLegacyRef.current;
        if (verified && isWithinLegacyBillingGrace(verified.verifiedAt)) {
          setBilling(verified.status);
          return verified.status;
        }
      } catch {}
      const unavailable = { ...UNKNOWN, accessReason: e?.message ?? UNKNOWN.accessReason };
      setBilling(unavailable);
      return unavailable;
    }
  }, [uid, email, fetchStatus, applyNativeEntitlement]);

  useEffect(() => {
    let cancelled = false;
    setBilling(UNKNOWN);
    setBillingLoading(true);
    if (!uid) {
      setBillingLoading(false);
      return;
    }
    (async () => {
      await refreshBilling();
    })().finally(() => {
      if (!cancelled) setBillingLoading(false);
    });
    return () => { cancelled = true; };
  }, [uid, refreshBilling]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !uid) {
      setNativePrices({ starter: { monthly: null, yearly: null }, pro: { monthly: null, yearly: null } });
      return;
    }
    getRevenueCatOfferings(uid).then((offerings) => {
      const packages = offerings?.current?.availablePackages ?? [];
      const prices: NativePrices = { starter: { monthly: null, yearly: null }, pro: { monthly: null, yearly: null } };
      for (const item of packages) {
        const p = planFromRevenueCatProductIdentifier(item.product.identifier);
        const i = intervalFromRevenueCatProductIdentifier(item.product.identifier);
        if (p === 'starter' && i === 'monthly') prices.starter.monthly = item.product.priceString;
        if (p === 'starter' && i === 'yearly') prices.starter.yearly = item.product.priceString;
        if (p === 'pro' && i === 'monthly') prices.pro.monthly = item.product.priceString;
        if (p === 'pro' && i === 'yearly') prices.pro.yearly = item.product.priceString;
      }
      setNativePrices(prices);
    }).catch(() => undefined);
  }, [uid]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !uid) return;
    return () => { logOutRevenueCat().catch(() => undefined); };
  }, [uid]);

  // Re-check when the app returns to the foreground so an expired or newly
  // activated subscription is picked up without a restart.
  useEffect(() => {
    if (!uid) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshBilling();
    });
    return () => sub.remove();
  }, [uid, refreshBilling]);

  const startCheckout = useCallback(async (planCode: 'starter' | 'pro', interval: 'monthly' | 'yearly' = 'monthly') => {
    if (Platform.OS === 'android' && billing.entitlementSource === 'grant/admin') {
      throw new Error('Administrator-granted access must be migrated before purchasing a Google Play subscription.');
    }
    if (Platform.OS === 'android' && canPurchaseGooglePlay(billing.entitlementSource)) {
      const purchase = await purchaseRevenueCatPlan(uid!, planCode, interval);
      const serverStatus = await fetchStatus().catch(() => UNKNOWN);
      const activated = await applyNativeEntitlement(serverStatus, purchase.customerInfo);
      if (!activated.hasAccess) {
        throw new Error('Google Play confirmed the payment, but access is still syncing. Tap “Already paid?” to refresh.');
      }
      setBilling(activated);
      return activated;
    }
    const base = apiBase();
    if (!base || !email) throw new Error('You must be signed in first.');
    const res = await fetch(`${base}/billing/start`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ planCode, billingInterval: interval })
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409) {
      const refreshed = await refreshBilling();
      if (data.code === 'PLAN_SWITCH_UNSUPPORTED') {
        throw new Error(data.error ?? 'Contact support to change an active subscription plan.');
      }
      return refreshed;
    }
    if (!res.ok || !data.url) throw new Error(data.error ?? data.message ?? 'Could not start payment.');
    await WebBrowser.openBrowserAsync(data.url);
    // Native resolves when the browser is dismissed; on web the tab is separate,
    // so poll for a little while.
    if (Platform.OS === 'web') {
      for (let i = 0; i < 12; i++) {
        await new Promise(r => setTimeout(r, 5000));
        await refreshBilling();
      }
    } else {
      return await refreshBilling();
    }
    return await refreshBilling();
  }, [uid, email, authHeaders, refreshBilling, billing.entitlementSource, fetchStatus, applyNativeEntitlement]);

  const switchPlan = useCallback(async (planCode: 'starter' | 'pro', interval: 'monthly' | 'yearly' = 'monthly') => {
    if (Platform.OS === 'android' && billing.entitlementSource === 'grant/admin') {
      throw new Error('Administrator-granted access must be migrated before purchasing a Google Play subscription.');
    }
    if (Platform.OS === 'android' && billing.entitlementSource === 'google_play') {
      const purchase = await purchaseRevenueCatPlan(uid!, planCode, interval);
      const serverStatus = await fetchStatus().catch(() => UNKNOWN);
      const activated = await applyNativeEntitlement(serverStatus, purchase.customerInfo);
      if (!activated.hasAccess) {
        throw new Error('Google Play confirmed the change, but access is still syncing. Tap “Already paid?” to refresh.');
      }
      setBilling(activated);
      return activated;
    }
    const base = apiBase();
    if (!base || !email) throw new Error('You must be signed in first.');
    const res = await fetch(`${base}/billing/switch`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ planCode, billingInterval: interval })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error ?? data.message ?? 'Could not switch plan.');
    }
    return await refreshBilling();
  }, [uid, email, authHeaders, refreshBilling, billing.entitlementSource, fetchStatus, applyNativeEntitlement]);

  const restorePurchases = useCallback(async () => {
    if (Platform.OS !== 'android' || !uid) return;
    await restoreRevenueCatPurchases(uid);
    await refreshBilling();
  }, [uid, refreshBilling]);

  const openManage = useCallback(async () => {
    if (Platform.OS === 'android' && billing.entitlementSource === 'grant/admin') {
      throw new Error('Administrator-granted access does not have a Google Play subscription to manage.');
    }
    if (Platform.OS === 'android' && !usesPaystackManagement(billing.entitlementSource)) {
      await WebBrowser.openBrowserAsync('https://play.google.com/store/account/subscriptions?package=com.profitnaija.app');
      return;
    }
    const base = apiBase();
    if (!base || !email) throw new Error('You must be signed in first.');
    const res = await fetch(`${base}/billing/manage`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) throw new Error(data.error ?? 'Could not open subscription settings.');
    await WebBrowser.openBrowserAsync(data.url);
    await refreshBilling();
  }, [email, authHeaders, refreshBilling, billing.entitlementSource]);

  const cancelRenewal = useCallback(async () => {
    if (Platform.OS === 'android' && billing.entitlementSource === 'grant/admin') {
      throw new Error('Administrator-granted access does not have a Google Play subscription to cancel.');
    }
    if (Platform.OS === 'android' && !usesPaystackManagement(billing.entitlementSource)) {
      await WebBrowser.openBrowserAsync('https://play.google.com/store/account/subscriptions?package=com.profitnaija.app');
      return;
    }
    const base = apiBase();
    if (!base || !email) throw new Error('You must be signed in first.');
    const res = await fetch(`${base}/billing/cancel`, {
      method: 'POST',
      headers: await authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message ?? data.error ?? 'Could not cancel renewal.');
    await refreshBilling();
  }, [email, authHeaders, refreshBilling, billing.entitlementSource]);

  const listPayments = useCallback(async () => {
    const base = apiBase();
    if (!base || !email) return [];
    const res = await fetch(`${base}/billing/payments`, { headers: await authHeaders() });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return data.payments || [];
  }, [email, authHeaders]);

  const hasProAccess =
    (billing.hasAccess && (billing.currentPlan === 'pro' || billing.currentPlan === 'business')) ||
    !!billing.isAdmin || 
    !!billing.freeGrant;

  return (
    <BillingContext.Provider value={{ billing, billingLoading, hasProAccess, refreshBilling, startCheckout, switchPlan, openManage, cancelRenewal, listPayments, nativePrices, restorePurchases }}>
      {children}
    </BillingContext.Provider>
  );
}

export function useBilling() {
  return useContext(BillingContext);
}
