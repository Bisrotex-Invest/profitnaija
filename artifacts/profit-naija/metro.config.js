const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { createRequire } = require('module');

const config = getDefaultConfig(__dirname);

// ── Expo Go shim for react-native-keyboard-controller ────────────────────────
// The real module requires native code not shipped with Expo Go. When Metro is
// serving the dev bundle we swap it out for a NOOP/passthrough shim so the app
// launches without crashing. Production APK/IPA builds use the real module.
const keyboardControllerShim = path.join(
  __dirname,
  'lib/mocks/react-native-keyboard-controller.js',
);

// ── Expo Go shim for react-native-worklets ────────────────────────────────────
// react-native-worklets calls init() at module load time.  init() calls
// installRNBindingsOnUIRuntime() which throws a WorkletsError when
// WorkletsModule (a TurboModule) is absent from the Expo Go binary.
// app/(tabs)/index.tsx is the DEFAULT INITIAL ROUTE rendered by Expo Router
// immediately on startup; it imports react-native-reanimated → worklets →
// init() → crash before any React tree renders.
//
// This shim provides safe NOOP implementations so the app boots.  The real
// module is resolved in production / EAS builds where the native binary is
// compiled in.
const workletsShim = path.join(
  __dirname,
  'lib/mocks/react-native-worklets.js',
);

// Replit's Android simulator can run an Expo Go binary whose Reanimated native
// module is unavailable. Reanimated reads that module during import, before the
// worklets shim can help, so use static Views for development preview only.
const reanimatedShim = path.join(
  __dirname,
  'lib/mocks/react-native-reanimated.js',
);

// ── Root cause: two @firebase/app instances ───────────────────────────────────
//
// pnpm puts @firebase/app@0.10.5 and @firebase/app@0.15.1 in separate virtual
// store entries. firebase/app resolves to one; @firebase/auth's internal
// require('@firebase/app') resolves to the other. Each has its own component
// registry (_providers Map), so when @firebase/auth calls registerAuth() it
// writes to registry B while initializeAuth checks registry A — giving
// "Component auth has not been registered yet".
//
// Fix: resolve both @firebase/app and @firebase/auth from firebase's own
// node_modules so they share a single component registry instance.

const firebaseRoot = path.dirname(require.resolve('firebase/package.json'));
const resolveFromFirebase = createRequire(path.join(firebaseRoot, 'package.json'));

// Single @firebase/app instance (0.10.5, the one firebase/app itself uses)
const firebaseAppBundle = path.join(
  path.dirname(resolveFromFirebase.resolve('@firebase/app/package.json')),
  'dist/esm/index.esm2017.js',
);

// Single @firebase/auth RN bundle
const firebaseAuthRnBundle = path.join(
  path.dirname(resolveFromFirebase.resolve('@firebase/auth/package.json')),
  'dist/rn/index.js',
);

// Shims are only needed in Expo Go development mode (where native modules are
// missing from the Expo Go binary).  In EAS / production builds the real native
// modules are compiled into the APK/IPA, so we skip the shims there.
// EXPO_GO_DEV is set only by the Expo Go development script. Production EAS
// builds and Expo exports do not set it, so they still resolve native modules.
const isExpoGoDev = process.env.EXPO_GO_DEV === '1';

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web') {
    if (isExpoGoDev) {
      // Swap react-native-keyboard-controller for a NOOP shim in Expo Go.
      // The real module requires native code not included in Expo Go, causing a
      // crash on launch. The shim provides passthrough implementations so the app
      // runs normally. Custom dev builds / production binaries link the real module.
      if (moduleName === 'react-native-keyboard-controller') {
        return { filePath: keyboardControllerShim, type: 'sourceFile' };
      }
      // Shim react-native-worklets to prevent init() crash when WorkletsModule
      // TurboModule is absent from the Expo Go binary.  app/(tabs)/index.tsx is
      // the default initial route rendered by Expo Router on startup; it imports
      // react-native-reanimated → worklets → init() which throws if the
      // TurboModule is absent.  In production APK/IPA builds the real worklets
      // native code is compiled in and animations work normally.
      if (moduleName === 'react-native-worklets') {
        return { filePath: workletsShim, type: 'sourceFile' };
      }
      if (moduleName === 'react-native-reanimated') {
        return { filePath: reanimatedShim, type: 'sourceFile' };
      }
    }
    // Pin all @firebase/app imports to the same module so registerAuth() and
    // initializeAuth() share the same _providers Map.
    if (moduleName === '@firebase/app' || moduleName === '@firebase/app/') {
      return { filePath: firebaseAppBundle, type: 'sourceFile' };
    }
    // Pin @firebase/auth to the RN bundle (exports getReactNativePersistence).
    if (moduleName === '@firebase/auth') {
      return { filePath: firebaseAuthRnBundle, type: 'sourceFile' };
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

// ── Blockist ──────────────────────────────────────────────────────────────────
const { blockList } = config.resolver ?? {};
const existingBlockList = Array.isArray(blockList)
  ? blockList : blockList ? [blockList] : [];

config.resolver.blockList = [
  ...existingBlockList,
  /firebase_tmp_/,
  /@firebase\/auth_tmp_/,
];

module.exports = config;
