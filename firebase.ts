import { initializeApp, getApps } from 'firebase/app';
import { initializeFirestore, getFirestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain:        'profitnaija.firebaseapp.com',
  projectId:         'profitnaija',
  storageBucket:     'profitnaija.firebasestorage.app',
  messagingSenderId: '185642629410',
  appId:             '1:185642629410:web:991f428b3fd2607b070d7b',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// experimentalForceLongPolling: Expo Go proxies traffic through a tunnel that
// blocks WebSocket/gRPC. Long-polling uses plain HTTP and works through it.
// Wrapped in try/catch because initializeFirestore throws if called twice on
// the same app (e.g. Metro hot-reload reuses the Firebase app instance).
// experimentalForceLongPolling: Expo Go tunnel blocks WebSocket/gRPC.
// useFetchStreams: false: React Native's Fetch API doesn't support the streaming
//   required by WebChannel, causing "transport errored" warnings and write timeouts.
//   Disabling fetch streams forces XMLHttpRequest which works reliably in RN.
// Wrapped in try/catch: initializeFirestore throws on hot-reload re-init.
// The Firestore database was created with ID "default" (no parentheses), NOT the
// special "(default)" database the SDK uses by default. Pass the ID explicitly.
const FIRESTORE_DB_ID = 'default';

let db: ReturnType<typeof getFirestore>;
try {
  db = initializeFirestore(app, {
    experimentalForceLongPolling: true,
    useFetchStreams: false,
  }, FIRESTORE_DB_ID);
} catch {
  db = getFirestore(app, FIRESTORE_DB_ID);
}
export { db };

// ── Firestore connectivity probe ──────────────────────────────────────────────
// Returns true if Firestore is reachable (200 or 403 = rules-blocked but exists).
// 404 with a valid key = database not yet created; without a key = API key not set.
// Never throws — failures are silent so the app never crashes here.
export async function checkFirestoreConnectivity(): Promise<boolean> {
  const apiKey = process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '';
  if (!apiKey) {
    console.log('[Firestore] API key not set — skipping probe.');
    return false;
  }
  const url =
    `https://firestore.googleapis.com/v1/projects/profitnaija/databases/(default)/documents?key=${apiKey}&pageSize=1`;
  try {
    const res = await fetch(url);
    if (res.status === 200 || res.status === 403) {
      console.log('[Firestore] ✓ Connected — status', res.status);
      return true;
    }
    // 404 most likely means the API key isn't authorised for the REST endpoint
    // (the Firestore SDK uses gRPC, not this REST URL, and works regardless).
    console.log('[Firestore] probe returned', res.status, '— SDK will still connect via gRPC/long-poll.');
    return false;
  } catch (e: any) {
    console.log('[Firestore] probe failed:', e.message, '— continuing with SDK connection.');
    return false;
  }
}

// ── Lazy auth ─────────────────────────────────────────────────────────────────
let _auth: any = null;
export const getAuthInstance = async () => {
  if (_auth) return _auth;
  const { initializeAuth, getReactNativePersistence } = await import('@firebase/auth');
  _auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
  return _auth;
};
