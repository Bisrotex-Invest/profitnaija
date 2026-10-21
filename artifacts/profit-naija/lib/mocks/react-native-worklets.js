/**
 * Expo Go shim for react-native-worklets.
 *
 * react-native-worklets requires a native TurboModule (WorkletsModule) that is
 * NOT included in the standard Expo Go binary even though it appears in
 * bundledNativeModules.json.  When WorkletsModule is null, the package's
 * index.ts calls init() which calls installRNBindingsOnUIRuntime() which throws
 * a WorkletsError — crashing the app before React renders anything.
 *
 * This shim replaces the whole package with safe NOOP/passthrough exports so
 * the app boots in Expo Go.  Animations that depend on the UI thread will be
 * silently skipped (elements still appear, just without motion).
 *
 * The real native module is compiled into production APK/IPA builds, where
 * Metro resolves the REAL react-native-worklets module instead of this shim.
 */
'use strict';

const NOOP = () => undefined;
const identity = (v) => v;

// ── RuntimeKind enum ─────────────────────────────────────────────────────────
const RuntimeKind = Object.freeze({
  ReactNative: 'ReactNative',
  Worklet: 'Worklet',
  Node: 'Node',
});

// ── WorkletsModule stub ───────────────────────────────────────────────────────
// Must be truthy so the "if (!WorkletsModule) throw" guard passes.
const WorkletsModule = {
  executeOnUIRuntimeSync: NOOP,
  scheduleOnUI: NOOP,
  installValueUnpacker: NOOP,
  installCoreCoreHandler: NOOP,
  createWorkletRuntime: NOOP,
};

// ── Thread helpers ────────────────────────────────────────────────────────────
// executeOnUIRuntimeSync(worklet) must return a CALLABLE so callers can do
// executeOnUIRuntimeSync(fn)() without a TypeError.
function executeOnUIRuntimeSync(/* worklet */) {
  return NOOP; // Returns a no-op callable — the worklet is never executed.
}

// runOnUI: schedule work on UI thread — fall through to JS in Expo Go.
function runOnUI(fn) {
  return function (...args) {
    // In Expo Go there is no UI thread runtime; just swallow silently.
    return undefined;
  };
}

// runOnJS: wrap a JS-thread callback so UI-thread worklets can call it.
// In Expo Go, everything runs on JS anyway.
function runOnJS(fn) {
  return fn;
}

function callMicrotasks() {
  // No-op — no UI runtime to drain.
}

// ── Shareables ────────────────────────────────────────────────────────────────
// In production, shareables are values that can cross the JS↔UI thread
// boundary.  In this shim they are just the original values.
function makeShareable(value) {
  return value;
}
function makeShareableCloneRecursive(value) {
  return value;
}
function makeShareableCloneOnUIRecursive(value) {
  return value;
}
function isShareableRef(value) {
  return false;
}
const shareableMappingCache = {
  has: () => false,
  set: NOOP,
  get: () => undefined,
  delete: NOOP,
};

// ── Serializables ─────────────────────────────────────────────────────────────
function createSerializable(fn) {
  return fn; // Identity — no cross-runtime serialization needed.
}
function isSerializableRef(value) {
  return false;
}
const serializableMappingCache = {
  has: () => false,
  set: NOOP,
  get: () => undefined,
  delete: NOOP,
};

// ── Feature flags ─────────────────────────────────────────────────────────────
const _flags = {};
function getStaticFeatureFlag(name) {
  return _flags[name] ?? false;
}
function setDynamicFeatureFlag(name, value) {
  _flags[name] = value;
}

// ── Runtimes ──────────────────────────────────────────────────────────────────
function createWorkletRuntime(/* name, initializer */) {
  return null;
}
function runOnRuntime(/* runtime, worklet */) {
  return NOOP;
}

// ── Synchronizables ───────────────────────────────────────────────────────────
function isSynchronizable(value) {
  return false;
}
function createSynchronizable(/* init */) {
  return null;
}

// ── Misc ──────────────────────────────────────────────────────────────────────
function getRuntimeKind() {
  return RuntimeKind.ReactNative;
}
function isWorkletFunction(fn) {
  return false;
}

// ── init ──────────────────────────────────────────────────────────────────────
// The real init() calls installRNBindingsOnUIRuntime() which throws when
// WorkletsModule is absent.  Here it is a safe NOOP.
function init() {
  // Intentionally empty.
}

module.exports = {
  // Core
  init,
  WorkletsModule,
  RuntimeKind,

  // Thread helpers
  executeOnUIRuntimeSync,
  runOnUI,
  runOnJS,
  callMicrotasks,

  // Shareables
  makeShareable,
  makeShareableCloneRecursive,
  makeShareableCloneOnUIRecursive,
  isShareableRef,
  shareableMappingCache,

  // Serializables
  createSerializable,
  isSerializableRef,
  serializableMappingCache,

  // Feature flags
  getStaticFeatureFlag,
  setDynamicFeatureFlag,

  // Runtimes
  createWorkletRuntime,
  runOnRuntime,

  // Synchronizables
  isSynchronizable,
  createSynchronizable,

  // Misc
  getRuntimeKind,
  isWorkletFunction,
};
