export const LEGACY_BILLING_GRACE_MS = 5 * 60 * 1000;

/** Legacy Paystack access is usable offline only after a live verification
 * in this process; a cold start has no trusted status to reuse. */
export function isWithinLegacyBillingGrace(verifiedAt: number | null, now = Date.now()): boolean {
  return verifiedAt !== null && now >= verifiedAt && now - verifiedAt <= LEGACY_BILLING_GRACE_MS;
}

export type EntitlementSource = 'google_play' | 'paystack' | 'grant/admin' | 'none';

/** Retry an unavailable access check on tap, but never guess the billing
 * provider: an existing Paystack subscription must not be charged in Play. */
export async function resolveCheckoutStatus<T extends { state: string; accessReason?: string }>(
  status: T,
  refresh: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  if (status.state !== 'unknown') return status;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const verified = await Promise.race([
      refresh(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(
          'The subscription check timed out. Check your internet connection and tap Continue again. No purchase was started.',
        )), timeoutMs);
      }),
    ]);
    if (verified.state === 'unknown') {
      throw new Error(
        `We could not confirm your existing subscription. ${verified.accessReason || 'Check your internet connection and try again.'} No purchase was started.`,
      );
    }
    return verified;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function canPurchaseGooglePlay(source: EntitlementSource): boolean {
  return source === 'none' || source === 'google_play';
}

export function usesPaystackManagement(source: EntitlementSource): boolean {
  return source === 'paystack';
}