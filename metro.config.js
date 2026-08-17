const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const { createRequire } = require('module');

const config = getDefaultConfig(__dirname);

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

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform !== 'web') {
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
