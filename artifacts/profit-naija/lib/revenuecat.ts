import { Platform } from 'react-native';
import Purchases from 'react-native-purchases';
import type { StoreProductChangeInfo } from 'react-native-purchases';
import {
  planFromRevenueCatProductIdentifier,
  intervalFromRevenueCatProductIdentifier,
  productChangeInfoForPlan,
  REVENUECAT_PRODUCTS,
} from '@/lib/revenuecatHelpers';
export { planFromRevenueCatProductIdentifier, productChangeInfoForPlan } from '@/lib/revenuecatHelpers';

export const REVENUECAT_ENTITLEMENT = process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT || 'paid_access';

let configuredForUser: string | null = null;

function apiKey() {
  if (Platform.OS !== 'android') return null;
  return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || null;
}

export async function configureRevenueCat(uid: string) {
  const key = apiKey();
  if (!key || !uid) return false;
  if (!configuredForUser) {
    Purchases.configure({ apiKey: key, appUserID: uid });
    configuredForUser = uid;
  } else if (configuredForUser !== uid) {
    await Purchases.logIn(uid);
    configuredForUser = uid;
  }
  return true;
}

export async function logOutRevenueCat() {
  if (configuredForUser) {
    await Purchases.logOut().catch(() => undefined);
    configuredForUser = null;
  }
}

export function revenueCatConfigured() {
  return Platform.OS === 'android' && configuredForUser !== null;
}

export async function getRevenueCatCustomerInfo(uid: string) {
  if (!(await configureRevenueCat(uid))) return null;
  return Purchases.getCustomerInfo();
}

export async function getRevenueCatOfferings(uid: string) {
  if (!(await configureRevenueCat(uid))) return null;
  return Purchases.getOfferings();
}

export async function purchaseRevenueCatPlan(
  uid: string,
  plan: 'starter' | 'pro',
  interval: 'monthly' | 'yearly',
  replaceFrom?: { productIdentifier: string; plan: 'starter' | 'pro' },
) {
  if (!(await configureRevenueCat(uid))) {
    throw new Error('Google Play subscriptions are unavailable on this platform.');
  }
  const offerings = await Purchases.getOfferings();
  const currentInfo = await Purchases.getCustomerInfo();
  const activeEntitlement = currentInfo.entitlements.active?.[REVENUECAT_ENTITLEMENT];
  const activeProduct = activeEntitlement?.productIdentifier;
  const activePlan = activeProduct ? planFromRevenueCatProductIdentifier(activeProduct) : null;
  const packages = offerings.current?.availablePackages || [];

  const target = packages.find((item) =>
    planFromRevenueCatProductIdentifier(item.product.identifier) === plan &&
    intervalFromRevenueCatProductIdentifier(item.product.identifier) === interval
  );

  if (!target) {
    throw new Error('This plan is not available in Google Play yet. Please try again later.');
  }
  if (activeProduct === target.product.identifier) {
    throw new Error('This Google Play subscription is already active.');
  }

  const effectiveReplaceFrom = activeProduct && activePlan
    ? { productIdentifier: activeProduct, plan: activePlan }
    : replaceFrom;

  const changeInfo = effectiveReplaceFrom
    ? productChangeInfoForPlan(effectiveReplaceFrom.productIdentifier, effectiveReplaceFrom.plan, plan) as StoreProductChangeInfo | null
    : null;

  return Purchases.purchasePackage(target, null, changeInfo);
}

export async function restoreRevenueCatPurchases(uid: string) {
  if (!(await configureRevenueCat(uid))) return null;
  return Purchases.restorePurchases();
}