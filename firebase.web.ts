import { initializeApp, getApps } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain:        'profitnaija.firebaseapp.com',
  projectId:         'profitnaija',
  storageBucket:     'profitnaija.firebasestorage.app',
  messagingSenderId: '185642629410',
  appId:             '1:185642629410:web:991f428b3fd2607b070d7b',
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Web uses browserLocalPersistence — same lazy pattern for interface consistency.
let _auth: any = null;
export const getAuthInstance = async () => {
  if (_auth) return _auth;
  const { initializeAuth, browserLocalPersistence } = await import('firebase/auth');
  _auth = initializeAuth(app, {
    persistence: browserLocalPersistence,
  });
  return _auth;
};

// No-op on web — the REST ping is native-only; the Firestore SDK connects fine.
export async function checkFirestoreConnectivity(): Promise<boolean> {
  console.log('[Firestore] web — skipping REST probe, SDK connects directly.');
  return true;
}

