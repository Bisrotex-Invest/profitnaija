export interface SubscriptionSetupState {
  requiredAt?: unknown;
  completedAt?: unknown;
}

export type SubscriptionSetupStage = 'opening' | 'purchase' | 'complete' | null;

export function hasActiveOpeningSnapshot(
  entries: readonly { type: string; ledgerStatus?: string }[],
): boolean {
  return entries.some(
    entry => entry.type === 'opening_balance' && entry.ledgerStatus === 'active',
  );
}

export function isPurchaseBlockedByOpeningSetup(
  entries: readonly { type: string; ledgerStatus?: string }[],
  setup: SubscriptionSetupState | null | undefined,
): boolean {
  return Boolean(setup?.requiredAt) && !hasActiveOpeningSnapshot(entries);
}

/**
 * Returns the next mandatory setup step for newly subscribed accounts.
 * A purchase only qualifies when its accounting date is after the opening
 * snapshot date, because an opening snapshot closes its chosen date.
 */
export function getSubscriptionSetupStage(
  entries: readonly { type: string; date: string; ledgerStatus?: string }[],
  setup: SubscriptionSetupState | null | undefined,
): SubscriptionSetupStage {
  if (!setup?.requiredAt || setup.completedAt) return null;

  const opening = entries.find(
    entry => entry.type === 'opening_balance' && entry.ledgerStatus === 'active',
  );
  if (!opening) return 'opening';

  const hasPostOpeningPurchase = entries.some(
    entry =>
      (entry.type === 'purchase' || entry.type === 'credit_purchase') &&
      entry.ledgerStatus !== 'void' &&
      entry.date > opening.date,
  );
  return hasPostOpeningPurchase ? 'complete' : 'purchase';
}
