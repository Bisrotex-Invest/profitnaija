export const REVENUECAT_PRODUCTS = {
  starter_monthly: 'profitnaija_starter_monthly',
  pro_monthly: 'profitnaija_pro_monthly',
  starter_yearly: 'profitnaija_starter_yearly',
  pro_yearly: 'profitnaija_pro_yearly',
} as const;

export type RevenueCatPlan = 'starter' | 'pro';
export type RevenueCatInterval = 'monthly' | 'yearly';

function baseProductIdentifier(identifier: string): string {
  return identifier.toLowerCase().split(':', 1)[0];
}

export function planFromRevenueCatProductIdentifier(identifier: string): RevenueCatPlan | null {
  const product = baseProductIdentifier(identifier);
  if (product === REVENUECAT_PRODUCTS.pro_monthly || product === REVENUECAT_PRODUCTS.pro_yearly) return 'pro';
  if (product === REVENUECAT_PRODUCTS.starter_monthly || product === REVENUECAT_PRODUCTS.starter_yearly) return 'starter';
  return null;
}

export function intervalFromRevenueCatProductIdentifier(identifier: string): RevenueCatInterval | null {
  const product = baseProductIdentifier(identifier);
  if (product === REVENUECAT_PRODUCTS.starter_yearly || product === REVENUECAT_PRODUCTS.pro_yearly) return 'yearly';
  if (product === REVENUECAT_PRODUCTS.starter_monthly || product === REVENUECAT_PRODUCTS.pro_monthly) return 'monthly';
  return null;
}

export function productChangeInfoForPlan(
  currentProductIdentifier: string,
  currentPlan: RevenueCatPlan,
  nextPlan: RevenueCatPlan,
) {
  if (!currentProductIdentifier) return null;
  return {
    oldProductIdentifier: currentProductIdentifier,
    replacementMode: currentPlan === 'starter' && nextPlan === 'pro'
      ? 'CHARGE_PRORATED_PRICE' as const
      : 'DEFERRED' as const,
  };
}