/**
 * Crashlytics is deliberately loaded lazily.
 *
 * Expo Go does not contain the native Crashlytics module, so importing or
 * calling it must never prevent the JavaScript app from starting. Production
 * EAS builds include the module through the config plugin below.
 */
type CrashlyticsInstance = {
  log: (message: string) => void;
  recordError: (error: Error) => void;
  setCrashlyticsCollectionEnabled?: (enabled: boolean) => Promise<void> | void;
};

let nativeCrashlytics: CrashlyticsInstance | null | undefined;

function getCrashlytics(): CrashlyticsInstance | null {
  if (nativeCrashlytics !== undefined) return nativeCrashlytics;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require('@react-native-firebase/crashlytics').default;
    nativeCrashlytics = module() as CrashlyticsInstance;
  } catch {
    // Expo Go and web do not ship the native module.
    nativeCrashlytics = null;
  }

  return nativeCrashlytics;
}

function errorForCrashlytics(error: unknown): Error {
  const source = error instanceof Error
    ? error
    : typeof error === 'string'
      ? new Error(error)
      : new Error('Unknown application error');
  const safeError = new Error(sanitize(source.message));
  if (source.stack) safeError.stack = sanitize(source.stack);
  return safeError;
}

function sanitize(value: string): string {
  return value
    // Keep diagnostics useful while ensuring common account/contact values
    // never leave the device.
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(?:\+?234|0)\d{10}/g, '[phone]')
    .replace(/(?:https?:\/\/|profit-naija:\/\/)[^\s)]+/gi, '[url]')
    .replace(/\b[0-9a-f]{24,}\b/gi, '[id]')
    .slice(0, 4000);
}

/**
 * Send a non-fatal error without including account identifiers, emails,
 * document contents, URLs, request bodies, or other business data.
 */
export function reportCrash(
  error: unknown,
  context: string,
  componentStack?: string,
): void {
  const client = getCrashlytics();
  if (!client) return;

  const safeContext = context.replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 80);
  try {
    client.log(`error_boundary:${safeContext}`);
    if (componentStack) client.log('component_stack_present');
    client.recordError(errorForCrashlytics(error));
  } catch {
    // Crash reporting must never become a second crash.
  }
}

/** Configure collection only on an installed build, never in Expo Go/web. */
export function initializeCrashReporting(): void {
  if (__DEV__) return;
  const client = getCrashlytics();
  if (!client?.setCrashlyticsCollectionEnabled) return;
  try {
    void client.setCrashlyticsCollectionEnabled(true);
  } catch {
    // Native setup is best-effort; app startup must continue.
  }
}

/**
 * Development-only verification hook. In a dev build, set
 * EXPO_PUBLIC_CRASHLYTICS_TEST=1 and reload the app to send one non-fatal
 * event. The guard makes this impossible to trigger in production.
 */
export function verifyCrashReportingInDevelopment(): void {
  if (!__DEV__ || process.env.EXPO_PUBLIC_CRASHLYTICS_TEST !== '1') return;
  reportCrash(new Error('ProfitNaija Crashlytics verification event'), 'dev_verification');
}