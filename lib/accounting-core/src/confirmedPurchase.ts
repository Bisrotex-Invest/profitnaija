/** A timeout must not turn an uncertain financial write into a new purchase.
 * Keep its document IDs until the same operation is confirmed. */
export interface PurchaseAttempt {
  ids: { entry: string; product: string; movement: string };
  payload: Record<string, unknown>;
  confirmationPending?: boolean;
}
// This shared library is compiled without DOM or Node ambient types. Native,
// browsers and Node all provide these two runtime timer functions.
const timers = globalThis as unknown as {
  setTimeout(callback: () => void, delay: number): unknown;
  clearTimeout(handle: unknown): void;
};
export interface PurchaseAttemptStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}
export const purchaseAttemptKey = (uid: string) => `pn_pending_purchase_v1:${uid}`;

export async function readPurchaseAttempt(store: PurchaseAttemptStore, uid: string): Promise<PurchaseAttempt | null> {
  const raw = await store.getItem(purchaseAttemptKey(uid));
  return raw ? JSON.parse(raw) as PurchaseAttempt : null;
}

export async function preparePurchaseAttempt(
  store: PurchaseAttemptStore,
  uid: string,
  payload: Record<string, unknown>,
  createIds: () => PurchaseAttempt['ids'],
) {
  const previous = await readPurchaseAttempt(store, uid);
  if (previous) {
    if (JSON.stringify(previous.payload) !== JSON.stringify(payload)) {
      throw Object.assign(new Error(
        'An earlier purchase still needs confirmation. Use “Check pending purchase” before recording a different purchase.',
      ), { code: 'PURCHASE_CONFIRMATION_PENDING' });
    }
    return previous;
  }
  const attempt = { ids: createIds(), payload };
  await store.setItem(purchaseAttemptKey(uid), JSON.stringify(attempt));
  return attempt;
}

export async function confirmPurchaseAttempt(
  store: PurchaseAttemptStore,
  uid: string,
  attempt: PurchaseAttempt,
  execute: (beforeCommit: () => void) => Promise<void>,
  timeoutMs = 20_000,
) {
  let expired = false;
  let writesStarted = false;
  let timer: unknown;
  const timeoutError = () => Object.assign(new Error(writesStarted || attempt.confirmationPending
    ? 'The purchase is still waiting for confirmation. Do not enter it again. Use “Check pending purchase” to confirm the same purchase without duplicating stock or payment.'
    : 'The purchase could not be checked in time. No purchase was submitted. Check your connection and try again.'),
  { code: 'PURCHASE_CONFIRMATION_PENDING', confirmationPending: writesStarted || !!attempt.confirmationPending });
  const beforeCommit = () => {
    if (expired) throw timeoutError();
    writesStarted = true;
  };
  // A process can stop after dispatching the transaction but before its
  // timeout handler runs. Persist uncertainty before any network write.
  await store.setItem(purchaseAttemptKey(uid), JSON.stringify({ ...attempt, confirmationPending: true }));
  try {
    await Promise.race([
      execute(beforeCommit),
      new Promise<never>((_, reject) => {
        timer = timers.setTimeout(() => { expired = true; reject(timeoutError()); }, timeoutMs);
      }),
    ]);
    await store.removeItem(purchaseAttemptKey(uid));
  } catch (error: any) {
    // Before the first write there can be no late commit: beforeCommit rejects
    // after expiry. Keep uncertain commits durable across app restarts.
    if (writesStarted || attempt.confirmationPending) {
      await store.setItem(purchaseAttemptKey(uid), JSON.stringify({ ...attempt, confirmationPending: true }));
    } else {
      await store.removeItem(purchaseAttemptKey(uid));
    }
    throw error;
  } finally {
    if (timer !== undefined) timers.clearTimeout(timer);
  }
}

/** Only for read-only preflight work; never race an unprotected write. */
export async function purchaseReadDeadline<T>(read: Promise<T>, timeoutMs = 15_000): Promise<T> {
  let timer: unknown;
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = timers.setTimeout(() => reject(new Error(
          'Your live Cash and Bank balances could not be checked in time. No purchase was submitted. Check your connection and try again.',
        )), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) timers.clearTimeout(timer);
  }
}
