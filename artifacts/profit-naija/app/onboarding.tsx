/**
 * Onboarding — 3 slides shown every launch before sign-in.
 *
 * Layout per slide:
 *  ┌──────────────────────────────┐
 *  │  IMAGE  (50 % screen height) │  portrait 9:16, anchored top-center, cover crop
 *  │  ░░░ dark fade at bottom 40%  │
 *  ├──────────────────────────────┤
 *  │  CONTENT (dark bg)           │  eyebrow · title · subtitle
 *  │  dots + CTA button           │
 *  └──────────────────────────────┘
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  ListRenderItemInfo,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewToken,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInUp, FadeOut } from 'react-native-reanimated';
import { ArrowRight } from 'lucide-react-native';

// ── Slide data ─────────────────────────────────────────────────────────────────

const SLIDES = [
  {
    id: '1',
    image: require('../assets/images/onboarding1.jpg'),
    accent: '#22C55E',
    dark:   '#061A0F',
    eyebrow: 'FOR TRADERS',
    title: 'Track Profits',
    subtitle:
      'Log every sale instantly. No spreadsheets, no guesswork — see your real profit after every cost and expense.',
  },
  {
    id: '2',
    image: require('../assets/images/minimart-dashboard.jpg'),
    accent: '#3B82F6',
    dark:   '#050E1F',
    eyebrow: 'FOR SHOP OWNERS',
    title: 'Manage Stock',
    subtitle:
      "Know what you have and what's running out before you lose a sale.",
  },
  {
    id: '3',
    image: require('../assets/images/onboarding3.jpg'),
    accent: '#F59E0B',
    dark:   '#1A1000',
    eyebrow: 'GROW YOUR BUSINESS',
    title: 'Grow Business',
    subtitle:
      'Revenue, costs, net profit summarised daily. Make decisions with clarity, not assumptions.',
  },
] as const;

type Slide = typeof SLIDES[number];

// ── Dot ────────────────────────────────────────────────────────────────────────

function Dot({ active, accent }: { active: boolean; accent: string }) {
  return (
    <View
      style={[
        dotStyles.dot,
        active
          ? [dotStyles.active, { backgroundColor: accent }]
          : { backgroundColor: 'rgba(255,255,255,0.30)' },
      ]}
    />
  );
}

const dotStyles = StyleSheet.create({
  dot:    { height: 7, width: 7, borderRadius: 4 },
  active: { width: 26, height: 7, borderRadius: 4 },
});

// ── Slide card ─────────────────────────────────────────────────────────────────

function SlideCard({ item, width, height }: { item: Slide; width: number; height: number }) {
  const portraitHeight = Math.round(width * (16 / 9));

  return (
    <View style={[styles.slide, { width }]}>

      {/* ── Image panel (top 50 %) ── */}
      <View style={[styles.imagePanel, { width, height }]}>
        {/*
          Portrait image anchored to top-center:
          • width  = W           → fills full width, no side gaps
          • height = PORTRAIT_H  → 9:16 ratio, taller than panel
          • top: 0               → object-position: center top
          The panel's overflow:hidden clips the bottom — showing face/upper body.
        */}
        <Image
          source={item.image}
          style={[styles.image, { width, height: portraitHeight }]}
          resizeMode="cover"
        />

        {/*
          Dark gradient overlay — bottom 40 % of image panel.
          Simulated with 3 stacked views of increasing opacity
          so the transition into the content area is smooth.
        */}
        <View style={[styles.fadeLayer, { height: height * 0.40, opacity: 0.25, backgroundColor: item.dark }]} />
        <View style={[styles.fadeLayer, { height: height * 0.28, opacity: 0.55, backgroundColor: item.dark }]} />
        <View style={[styles.fadeLayer, { height: height * 0.16, opacity: 0.90, backgroundColor: item.dark }]} />
      </View>

      {/* ── Content area — overlaid on image ── */}
      <Animated.View
        entering={FadeInUp.delay(80).springify().damping(20)}
        style={styles.contentArea}
      >
        <View
          style={[
            styles.eyebrowPill,
            { backgroundColor: item.accent + '28', borderColor: item.accent + '55' },
          ]}
        >
          <Text style={[styles.eyebrow, { color: item.accent }]}>{item.eyebrow}</Text>
        </View>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.subtitle}>{item.subtitle}</Text>
      </Animated.View>

    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [activeIdx, setActiveIdx] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);

  const current = SLIDES[activeIdx];
  const isLast  = activeIdx === SLIDES.length - 1;

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const idx = viewableItems[0]?.index;
      if (idx != null) setActiveIdx(idx);
    },
    [],
  );

  const finish = () => router.replace('/sign-in');

  const handleNext = () => {
    if (!isLast) {
      const nextIndex = activeIdx + 1;
      setActiveIdx(nextIndex);
      listRef.current?.scrollToOffset({ offset: width * nextIndex, animated: true });
    } else {
      finish();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: current.dark }]}>
      <StatusBar translucent backgroundColor="transparent" barStyle="light-content" />

      {/* Skip */}
      {!isLast && (
        <Animated.View
          entering={FadeIn}
          exiting={FadeOut}
          style={[styles.skipWrap, { top: insets.top + 14 }]}
        >
          <Pressable onPress={finish} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* Slides */}
      <FlatList<Slide>
        ref={listRef}
        data={SLIDES as unknown as Slide[]}
        keyExtractor={(s) => s.id}
        renderItem={useCallback(
          ({ item }: ListRenderItemInfo<Slide>) => (
            <SlideCard item={item} width={width} height={height} />
          ),
          [height, width],
        )}
        getItemLayout={(_, index) => ({
          length: width,
          offset: width * index,
          index,
        })}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 51 }}
        scrollEventThrottle={16}
        style={{ flex: 1 }}
      />

      {/* Bottom bar — dots + CTA */}
      <View
        style={[
          styles.bottomBar,
          {
            backgroundColor: current.dark,
            paddingBottom: Math.max(insets.bottom, 20) + 8,
          },
        ]}
      >
        <View style={styles.dotsRow}>
          {SLIDES.map((s, i) => (
            <Dot key={s.id} active={i === activeIdx} accent={current.accent} />
          ))}
        </View>

        <Pressable
          onPress={handleNext}
          style={({ pressed }) => [
            styles.ctaBtn,
            { backgroundColor: current.accent, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Text style={styles.ctaText}>{isLast ? 'Get Started' : 'Next'}</Text>
          {!isLast && <ArrowRight size={18} color="#fff" strokeWidth={2.5} />}
        </Pressable>
      </View>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  skipWrap: { position: 'absolute', right: 24, zIndex: 20 },
  skipText:  { fontSize: 14, fontFamily: 'Inter_500Medium', color: 'rgba(255,255,255,0.6)' },

  // Each slide = full screen width; height driven by children (imagePanel + contentArea)
  slide: { flex: 1 },

  // ── Image panel ──────────────────────────────────────────────────────────────
  imagePanel: {
    overflow: 'hidden',        // clips portrait image to 50% height
    backgroundColor: '#111',   // fallback while image loads
  },

  image: {
    position: 'absolute',
    top: 0,                    // object-position: center top — shows head/body
    left: 0,
  },

  // Stacked gradient simulation layers (positioned at bottom of image panel)
  fadeLayer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },

  // ── Content area — absolute overlay at bottom of full-screen image ───────────
  contentArea: {
    position: 'absolute',
    bottom: 160,
    left: 0,
    right: 0,
    paddingHorizontal: 28,
    gap: 12,
  },

  eyebrowPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
  },
  eyebrow: { fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 1.4 },

  title: {
    fontSize: 36,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.8,
    lineHeight: 42,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)',
    lineHeight: 24,
    maxWidth: 320,
  },

  // ── Bottom bar ───────────────────────────────────────────────────────────────
  bottomBar: {
    paddingTop: 14,
    paddingHorizontal: 28,
    gap: 16,
    alignItems: 'center',
  },
  dotsRow: { flexDirection: 'row', gap: 7, alignItems: 'center' },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    height: 54,
    borderRadius: 16,
  },
  ctaText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
