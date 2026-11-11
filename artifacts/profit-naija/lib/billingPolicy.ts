export const LEGACY_BILLING_GRACE_MS = 5 * 60 * 1000;

/** Legacy Paystack access is usable offline only after a live verification
 * in this process; a cold start has no trusted status to reuse. */
export function isWithinLegacyBillingGrace(verifiedAt: number | null, now = Date.now()): boolean {
  return verifiedAt !== null && now >= verifiedAt && now - verifiedAt <= LEGACY_BILLING_GRACE_MS;
}

export type EntitlementSource = 'google_play' | 'paystack' | 'grant/admin' | 'none';

export function canPurchaseGooglePlay(source: EntitlementSource): boolean {
  return source === 'none' || source === 'google_play';
}

export function usesPaystackManagement(source: EntitlementSource): boolean {
  return source === 'paystack';
}