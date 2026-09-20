import { useEffect, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
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

import { colors, duration, radius, shadow } from '@/theme/theme';

const MARK = require('@/assets/images/mark-template.png');

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
 * The Mmere Dane path, kept as the canonical geometry even though we render a
 * PNG right now. react-native-svg's Fabric ViewManagers don't register on RN
 * 0.86 ("Can't find ViewManager 'RNSVGPath'"), so the mark is drawn as a
 * white template PNG tinted per state — assets/images/mark-template.png is
 * rasterised from exactly this path. When react-native-svg is fixed, swap the
 * <Image> below back to <Svg><Path d={MMERE_DANE_PATH} .../></Svg> and it's a
 * ten-minute change. Do not delete this.
 */
export const MMERE_DANE_PATH =
  'M23.83 0.00 L2.71 22.04 L0.00 28.75 L7.00 37.00 L11.71 35.54 L22.67 23.50 L28.38 29.00 L30.38 33.96 L17.21 47.50 L16.46 50.25 L30.38 66.00 L30.29 68.29 L22.67 76.46 L11.71 64.42 L7.00 62.96 L0.71 68.67 L0.00 73.96 L23.83 99.96 L28.38 97.75 L40.12 83.54 L42.96 85.92 L44.33 94.17 L47.38 99.33 L53.58 98.38 L57.00 85.92 L59.83 83.54 L71.58 97.75 L76.12 99.96 L97.25 77.92 L99.96 71.21 L92.96 62.96 L88.25 64.42 L77.29 76.46 L71.58 70.96 L69.58 66.00 L82.75 52.46 L83.50 49.71 L69.58 33.96 L69.67 31.67 L77.29 23.50 L88.25 35.54 L92.96 37.00 L99.25 31.29 L99.96 26.00 L76.12 0.00 L71.58 2.21 L59.83 16.42 L57.00 14.04 L55.62 5.79 L52.58 0.62 L46.38 1.58 L42.96 14.04 L40.12 16.42 L28.38 2.21 Z M48.71 34.92 L51.42 35.00 L56.88 40.67 L57.00 41.58 L63.50 48.21 L63.54 48.96 L63.96 49.46 L63.96 50.50 L63.54 51.00 L63.50 51.75 L57.00 58.38 L56.88 59.29 L51.25 65.04 L48.54 64.96 L43.08 59.29 L42.96 58.38 L36.46 51.75 L36.42 51.00 L36.00 50.50 L36.00 49.46 L36.42 48.96 L36.46 48.21 L42.96 41.58 L43.08 40.67 Z';

type StateStyle = {
  /** The tint applied to the white template. Its former SVG fill. */
  tint: string;
  ground: string | null;
  glow: ViewStyle | null;
  label: string;
};

const STATES: Record<SymbolState, StateStyle> = {
  idle: { tint: colors.inkFaint, ground: null, glow: null, label: 'Kandoo is idle' },
  listening: {
    tint: colors.live,
    ground: colors.liveWash,
    glow: shadow.live,
    label: 'Kandoo is listening',
  },
  understanding: {
    tint: colors.accent,
    ground: null,
    glow: shadow.accent,
    label: 'Kandoo is working it out',
  },
  remembered: {
    tint: colors.settled,
    ground: null,
    glow: null,
    label: 'Kandoo remembered this',
  },
  moment: {
    tint: colors.accent,
    ground: null,
    glow: shadow.accent,
    label: 'Kandoo has something for you',
  },
  alarm: {
    tint: colors.ink,
    ground: colors.alarm,
    glow: { ...shadow.live, shadowColor: colors.alarm, shadowOpacity: 0.45 },
    label: 'Kandoo needs your attention',
  },
};

const BREATH_SCALE = 1.07;
const PULSE_SCALE = 1.12;
const ALARM_BREATH = 1100;

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

  useEffect(() => {
    cancelAnimation(scale);

    // Reduced motion holds the state colour and drops the movement entirely.
    // Remembered is deliberately still: stillness is the payoff.
    if (reduceMotion || state === 'remembered') {
      scale.value = 1;
      return;
    }

    const easing = Easing.inOut(Easing.ease);

    if (state === 'moment') {
      // Two pulses, then rest. Not a loop.
      const pulse = withSequence(
        withTiming(PULSE_SCALE, { duration: 320, easing }),
        withTiming(1, { duration: 480, easing })
      );
      scale.value = withSequence(pulse, pulse);
      return;
    }

    const breath = state === 'alarm' ? ALARM_BREATH : duration.breath;
    scale.value = withRepeat(
      withSequence(
        withTiming(BREATH_SCALE, { duration: breath / 2, easing }),
        withTiming(1, { duration: breath / 2, easing })
      ),
      -1,
      false
    );
  }, [state, reduceMotion, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const { tint, ground, glow, label } = STATES[state];
  const groundSize = size * GROUND_RATIO;

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
        {/* White template tinted per state — see MMERE_DANE_PATH above. */}
        <Image
          source={MARK}
          style={{ width: size, height: size, tintColor: tint }}
          resizeMode="contain"
        />
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
