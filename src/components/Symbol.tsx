import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { colors, duration, radius, shadow, withOpacity } from '@/theme/theme';

export type SymbolState =
  | 'idle'
  | 'listening'
  | 'understanding'
  | 'remembered'
  | 'moment'
  | 'alarm';

export type SymbolProps = {
  state: SymbolState;
  size: number;
};

/**
 * The mark — Adinkrahene, concentric rings signifying leadership. Its ring
 * colours are FIXED brand colours in every state (dark-brown outer, olive-gold
 * ring, amber core, cream gaps): the mark itself never recolours. State is
 * carried entirely by the GLOW behind it and its MOTION — a listening orange
 * glow with a pulse, an understanding amber glow with a breath, a still and
 * glowless remembered, a calm and glowless idle. Never deform it: uniform scale,
 * glow and opacity only.
 *
 * Ring geometry as fractions of `size`, sampled from the canonical asset:
 * outer ring 0.79..1.00, middle ring 0.40..0.60, core 0..0.21 of the radius.
 */
const OUTER_BORDER = 0.07;
const MIDDLE_DIAMETER = 0.72;
const MIDDLE_BORDER = 0.19;
const CORE_DIAMETER = 0.22;

type Motion = 'breathe' | 'pulse' | 'moment' | 'still';

type StateStyle = {
  ground: string | null;
  glow: ViewStyle | null;
  motion: Motion;
  label: string;
};

const STATES: Record<SymbolState, StateStyle> = {
  idle: { ground: null, glow: null, motion: 'breathe', label: 'Kandoo is idle' },
  listening: {
    // A low-opacity live-orange wash reads orange on cream; the fixed liveWash
    // token washed out to pink at this size.
    ground: withOpacity(colors.live, 0.15),
    glow: shadow.live,
    motion: 'pulse',
    label: 'Kandoo is listening',
  },
  understanding: {
    ground: null,
    glow: shadow.accent,
    motion: 'breathe',
    label: 'Kandoo is working it out',
  },
  remembered: {
    ground: null,
    glow: null,
    motion: 'still',
    label: 'Kandoo remembered this',
  },
  moment: {
    ground: null,
    glow: shadow.accent,
    motion: 'moment',
    label: 'Kandoo has something for you',
  },
  alarm: {
    ground: colors.alarm,
    glow: { ...shadow.live, shadowColor: colors.alarm, shadowOpacity: 0.45 },
    motion: 'breathe',
    label: 'Kandoo needs your attention',
  },
};

const BREATH_SCALE = 1.05;
const PULSE_SCALE = 1.1;
const MOMENT_SCALE = 1.12;
const PULSE_MS = 900;

/** The ground circle reads as a wash around the mark, not a tight disc. */
const GROUND_RATIO = 1.45;

export function KandooSymbol({ state, size }: SymbolProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const scale = useSharedValue(1);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  const { motion } = STATES[state];

  useEffect(() => {
    cancelAnimation(scale);

    // Reduced motion, and the deliberately still states, hold flat.
    if (reduceMotion || motion === 'still') {
      scale.value = 1;
      return;
    }

    const easing = Easing.inOut(Easing.ease);

    if (motion === 'moment') {
      // Two pulses, then rest. Not a loop.
      const pulse = withSequence(
        withTiming(MOMENT_SCALE, { duration: 320, easing }),
        withTiming(1, { duration: 480, easing })
      );
      scale.value = withSequence(pulse, pulse);
      return;
    }

    // Listening pulses (livelier, faster); everything else breathes slowly.
    const peak = motion === 'pulse' ? PULSE_SCALE : BREATH_SCALE;
    const period = motion === 'pulse' ? PULSE_MS : duration.breath;
    scale.value = withRepeat(
      withSequence(
        withTiming(peak, { duration: period / 2, easing }),
        withTiming(1, { duration: period / 2, easing })
      ),
      -1,
      false
    );
  }, [motion, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const { ground, glow, label } = STATES[state];
  const groundSize = size * GROUND_RATIO;

  const middle = size * MIDDLE_DIAMETER;
  const core = size * CORE_DIAMETER;

  return (
    <View
      style={[styles.container, { width: groundSize, height: groundSize }]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
    >
      {ground || glow ? (
        <View
          style={[
            styles.ground,
            {
              width: groundSize,
              height: groundSize,
              borderRadius: radius.full,
              backgroundColor: ground ?? 'transparent',
            },
            glow ?? null,
          ]}
        />
      ) : null}

      <Animated.View style={animatedStyle}>
        {/* Fixed brand colours; gaps fall through to the cream ground. */}
        <View
          style={{
            width: size,
            height: size,
            borderRadius: radius.full,
            borderWidth: size * OUTER_BORDER,
            borderColor: colors.markOuter,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: middle,
              height: middle,
              borderRadius: radius.full,
              borderWidth: size * MIDDLE_BORDER,
              borderColor: colors.markRing,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: core,
                height: core,
                borderRadius: radius.full,
                backgroundColor: colors.markCore,
              }}
            />
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ground: {
    position: 'absolute',
  },
});

export default KandooSymbol;
