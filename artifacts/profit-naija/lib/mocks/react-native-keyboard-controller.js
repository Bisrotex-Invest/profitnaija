/**
 * Expo Go shim for react-native-keyboard-controller.
 *
 * react-native-keyboard-controller requires a custom dev build (its native
 * module is not bundled in Expo Go). This shim provides NOOP / passthrough
 * implementations of every export the app actually uses so the bundle runs
 * in Expo Go without crashing.
 *
 * The real native module is compiled into the production APK/IPA and
 * takes over there via the normal Metro resolution.
 */
const React = require('react');
const { ScrollView, KeyboardAvoidingView, Platform } = require('react-native');

// ── KeyboardProvider ──────────────────────────────────────────────────────────
// Just passes children through; keyboard offset is handled per-screen by
// KeyboardAvoidingView in this shim build.
function KeyboardProvider({ children }) {
  return children;
}

// ── KeyboardAwareScrollView ───────────────────────────────────────────────────
// Falls back to the built-in KeyboardAvoidingView + ScrollView combo.
function KeyboardAwareScrollView({
  children,
  keyboardShouldPersistTaps = 'handled',
  style,
  contentContainerStyle,
  ...rest
}) {
  return React.createElement(
    KeyboardAvoidingView,
    {
      behavior: Platform.OS === 'ios' ? 'padding' : 'height',
      style: [{ flex: 1 }, style],
    },
    React.createElement(
      ScrollView,
      {
        keyboardShouldPersistTaps,
        contentContainerStyle,
        ...rest,
      },
      children,
    ),
  );
}

// ── Other exports (NOOP / passthrough) ───────────────────────────────────────
const NOOP = () => {};
const KeyboardController = {
  setDefaultMode: NOOP,
  setInputMode: NOOP,
  preload: NOOP,
  dismiss: NOOP,
  setFocusTo: NOOP,
  addListener: NOOP,
  removeListeners: NOOP,
};
const KeyboardEvents = {
  addListener: () => ({ remove: NOOP }),
};

module.exports = {
  KeyboardProvider,
  KeyboardAwareScrollView,
  KeyboardController,
  KeyboardEvents,
  useReanimatedKeyboardAnimation: () => ({ height: { value: 0 }, state: { value: 0 } }),
  useKeyboardHandler: NOOP,
  KeyboardStickyView: ({ children }) => children,
  KeyboardToolbar: () => null,
  KeyboardGestureArea: ({ children }) => children,
};
