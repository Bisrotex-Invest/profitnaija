import { Platform } from 'react-native';
import { getAuthInstance } from './firebase';
import type { AccountingRecord, OpeningPayload, OwnerPayload } from './utils/equityLedger';

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const auth = await getAuthInstance();
  const user = auth.currentUser;
  if (!user) throw new Error('Sign in to manage opening balances and equity.');
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (Platform.OS !== 'web' && !domain) throw new Error('The accounting server is not configured.');
  const base = Platform.OS === 'web' ? '' : `https://${domain}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`${base}/api/accounting${path}`, {
      method, headers: { Authorization: `Bearer ${await user.getIdToken()}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: controller.signal,
    });
    const data = await response.json();
    if (auth.currentUser?.uid !== user.uid) throw new Error('Your account changed. Reload this page.');
    if (!response.ok) throw new Error(data.error ?? 'Accounting request failed. Reload and retry.');
    return data;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('The request timed out. Refresh to check whether it saved before retrying.');
    throw error;
  } finally { clearTimeout(timeout); }
}
export const getAccountingLedger = () => request<{ opening: AccountingRecord | null; movements: AccountingRecord[]; openingRevision: number }>('/ledger');
export const saveOpeningBalance = (payload: OpeningPayload) => request<{ entry: AccountingRecord }>('/opening', 'PUT', payload);
export const deleteOpeningBalance = (expectedRevision: number) => request('/opening', 'DELETE', { expectedRevision });
export const createOwnerMovement = (payload: OwnerPayload) => request<{ entry: AccountingRecord }>('/owner-movements', 'POST', payload);
export const updateOwnerMovement = (id: string, payload: OwnerPayload) => request<{ entry: AccountingRecord }>(`/owner-movements/${encodeURIComponent(id)}`, 'PATCH', payload);
export const deleteOwnerMovement = (id: string, expectedRevision: number, reason: string) => request(`/owner-movements/${encodeURIComponent(id)}`, 'DELETE', { expectedRevision, reason });
