// @firebase/auth's default types (dist/auth-public.d.ts) don't include
// getReactNativePersistence — it only appears in the RN-specific types.
// metro.config.js pins @firebase/auth → dist/rn/index.js at runtime;
// this declaration makes TypeScript aware of the export at compile time.
import type { Persistence } from '@firebase/auth';

declare module '@firebase/auth' {
  export function getReactNativePersistence(
    storage: import('@react-native-async-storage/async-storage').default,
  ): Persistence;
}
