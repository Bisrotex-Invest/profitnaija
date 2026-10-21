import AsyncStorage from '@react-native-async-storage/async-storage';

export const PENDING_SIGNUP_KEY = 'pn_pending_signup_v2';
const INSTALLATION_ID_KEY = 'pn_installation_id_v1';

export type PendingSignup = {
  name: string;
  email: string;
  phone: string;
  referralCode?: string;
  isAgentRegistration: boolean;
  installationId: string;
};

function randomPart(): string {
  return Math.random().toString(36).slice(2, 12);
}

/** Stable per-installation identifier. It is not an advertising or hardware ID. */
export async function getInstallationId(): Promise<string> {
  const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
  if (existing) return existing;
  const installationId = `pn_${Date.now().toString(36)}_${randomPart()}${randomPart()}`;
  await AsyncStorage.setItem(INSTALLATION_ID_KEY, installationId);
  return installationId;
}

export async function getPendingSignup(): Promise<PendingSignup | null> {
  const raw = await AsyncStorage.getItem(PENDING_SIGNUP_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PendingSignup;
    if (!parsed.email || !parsed.phone || !parsed.installationId) throw new Error('Invalid pending signup');
    return parsed;
  } catch {
    await AsyncStorage.removeItem(PENDING_SIGNUP_KEY);
    return null;
  }
}

export async function clearPendingSignup(): Promise<void> {
  await AsyncStorage.multiRemove([PENDING_SIGNUP_KEY, 'pn_pending_verification']);
}

export function securityError(response: Response, body: { error?: string; message?: string }): string {
  const detail = body.error ?? body.message;
  if (response.status === 429) return 'Too many attempts. Please wait before trying again.';
  if (response.status === 401) return 'Your sign-in session expired. Please sign in again.';
  if (response.status === 403) return detail ?? 'This request was blocked by a security check. Please contact support if this continues.';
  if (response.status >= 500) return 'The security service is temporarily unavailable. Please try again shortly.';
  return detail ?? 'We could not complete the security verification. Please review your details and try again.';
}

export async function postSecurity(
  path: string,
  token: string,
  payload?: Record<string, string>,
): Promise<void> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  if (!domain) throw new Error('The security service is unavailable. Please try again later.');
  const response = await fetch(`https://${domain}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(payload ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(securityError(response, body));
}