'use strict';

const React = require('react');
const { View } = require('react-native');

const AnimatedView = React.forwardRef(function AnimatedView(
  { entering, exiting, layout, ...props },
  ref,
) {
  return React.createElement(View, { ...props, ref });
});

const transition = {
  delay() { return this; },
  springify() { return this; },
  damping() { return this; },
  duration() { return this; },
  easing() { return this; },
};

const Animated = {
  View: AnimatedView,
};

module.exports = {
  __esModule: true,
  default: Animated,
  FadeIn: transition,
  FadeInDown: transition,
  FadeInUp: transition,
  FadeOut: transition,
};