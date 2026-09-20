import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type TextStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { MMERE_DANE_PATH } from '@/components/Symbol';
import { colors, radius, shadow, spacing, text } from '@/theme/theme';

export type BrandIntroProps = {
  /** Fired when the sequence is over. The component owns all of its timing. */
  onDone: () => void;
};

const AnimatedPath = Animated.createAnimatedComponent(Path);

const WORDMARK = 'Kandoo';
const MOTTO = 'Yes You Kan';

/**
 * Fragments of a person's day, drawn in and absorbed by the mark. Real
 * captured text in the app's own typeface, never icons. Positions are offsets
 * from the stage centre. Six, no more.
 */
const FRAGMENTS = [
  { text: 'call Jed at 4', x: -96, y: -128 },
  { text: 'budget cut 15%', x: 84, y: -150 },
  { text: 'Dr. Mensah, Tuesday', x: -78, y: 132 },
  { text: 'book the review room', x: 70, y: 118 },
  { text: "Sam's number", x: 112, y: -22 },
  { text: 'pick up rice', x: -108, y: 26 },
] as const;

/**
 * The mark is rendered at SPLASH_SIZE and only ever transformed, so the
 * geometry is never re-laid-out: uniform scale, never deformation.
 */
const SPLASH_SIZE = 132;
const INTRO_SIZE = 74;
const SHRINK = INTRO_SIZE / SPLASH_SIZE;
const LIFT = 58;
const HIT_SCALE = 1.08;
const HALO_SIZE = 150;

/** Timing table, ms from mount. */
const T_HANDOFF = 700;
const T_SURFACE = 900;
const T_SURFACE_GAP = 70;
const T_PULL = 1500;
const T_PULL_GAP = 95;
const T_LAND_AFTER_PULL = 300;
const T_SETTLE = 2550;
const T_LETTERS = 2700;
const T_LETTER_GAP = 55;
const T_MOTTO = 3250;
const T_EXIT = 4300;

const GROUND_FADE = 500;
const SHRINK_MS = 650;
const RECOLOUR_MS = 400;
const SURFACE_MS = 420;
const DRIFT_MS = 900;
const PULL_MS = 420;
const PULL_FADE_MS = 340;
const HIT_MS = 190;
const SETTLE_MS = 300;
const LETTER_MS = 260;
const MOTTO_MS = 520;
const EXIT_MS = 460;

/** Home mounts once the stage has fully lifted away. */
const T_DONE = T_EXIT + EXIT_MS;

/** Reduced motion: no gathering, fade the words in together, hold, cut. */
const REDUCED_FADE = 400;
const REDUCED_HOLD = 900;

/**
 * Where the wordmark and motto sit, in the mark box's frame. They are
 * positioned absolutely so that, while invisible, they take no layout space:
 * the native splash centres the mark exactly, and anything in the flow beneath
 * it would push it off-centre on frame one — that offset is the jump this
 * component exists to prevent.
 */
const WORD_TOP = SPLASH_SIZE / 2 + 6;
const MOTTO_TOP = SPLASH_SIZE / 2 + 62;

const EASE_HANDOFF = Easing.bezier(0.22, 0.8, 0.3, 1);
/** Gravity: starts slow, accelerates into the centre. Never constant speed. */
const EASE_GRAVITY = Easing.bezier(0.5, 0, 0.75, 0);
const EASE_OUT = Easing.out(Easing.ease);
const EASE_IN = Easing.in(Easing.ease);
const EASE = Easing.inOut(Easing.ease);

type Timer = ReturnType<typeof setTimeout>;

export function BrandIntro({ onDone }: BrandIntroProps) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);

  const ground = useSharedValue(0);
  const markScale = useSharedValue(1);
  const markLift = useSharedValue(0);
  const markHit = useSharedValue(0);
  const markFill = useSharedValue<string>(colors.base);
  const halo = useSharedValue(0);
  const words = useSharedValue(0);
  const motto = useSharedValue(0);
  const exit = useSharedValue(0);

  // Per-fragment progress. Declared unrolled because hooks cannot live in a loop.
  const f0 = useFragmentValues();
  const f1 = useFragmentValues();
  const f2 = useFragmentValues();
  const f3 = useFragmentValues();
  const f4 = useFragmentValues();
  const f5 = useFragmentValues();
  const fragments = [f0, f1, f2, f3, f4, f5];

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) setReduceMotion(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;

    // The splash is held until fonts are ready and this component mounts only
    // after that, so hiding here is the handoff that avoids the white flash.
    SplashScreen.hideAsync().catch((error: unknown) => {
      // Usually just "already hidden"; still worth a line, never silence.
      console.warn('Splash hide failed:', error);
    });

    const timers: Timer[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms));
    };

    if (reduceMotion) {
      ground.value = 1;
      markScale.value = SHRINK;
      markLift.value = 1;
      markFill.value = colors.settled;
      words.value = withTiming(1, { duration: REDUCED_FADE });
      motto.value = withTiming(1, { duration: REDUCED_FADE });
      at(REDUCED_FADE + REDUCED_HOLD, onDone);
      return () => timers.forEach(clearTimeout);
    }

    // 700 — splash handoff: ground fades, mark shrinks and recedes.
    at(T_HANDOFF, () => {
      ground.value = withTiming(1, { duration: GROUND_FADE });
      markScale.value = withTiming(SHRINK, {
        duration: SHRINK_MS,
        easing: EASE_HANDOFF,
      });
      markFill.value = withTiming(colors.inkFaint, { duration: RECOLOUR_MS });
    });

    fragments.forEach((fragment, i) => {
      // 900 — fragments surface, blurred, drifting inward slowly.
      at(T_SURFACE + i * T_SURFACE_GAP, () => {
        fragment.surface.value = withTiming(1, { duration: SURFACE_MS });
        fragment.drift.value = withTiming(1, {
          duration: DRIFT_MS,
          easing: EASE_OUT,
        });
      });

      // 1500 — each fragment is drawn in under gravity.
      at(T_PULL + i * T_PULL_GAP, () => {
        fragment.pull.value = withTiming(1, {
          duration: PULL_MS,
          easing: EASE_GRAVITY,
        });
        fragment.fade.value = withTiming(1, {
          duration: PULL_FADE_MS,
          easing: EASE_IN,
        });
      });

      // The mark brightens as each one lands, then relaxes.
      at(T_PULL + i * T_PULL_GAP + T_LAND_AFTER_PULL, () => {
        markFill.value = withSequence(
          withTiming(colors.accent, { duration: 80 }),
          withTiming(colors.inkFaint, { duration: HIT_MS })
        );
        markHit.value = withSequence(
          withTiming(1, { duration: 80 }),
          withTiming(0, { duration: HIT_MS })
        );
        halo.value = withSequence(
          withTiming(1, { duration: 80 }),
          withTiming(0, { duration: HIT_MS + 70 })
        );
      });
    });

    // 2550 — everything absorbed; the mark settles, lifts, and goes still.
    at(T_SETTLE, () => {
      markFill.value = withTiming(colors.settled, { duration: RECOLOUR_MS });
      markLift.value = withTiming(1, { duration: SETTLE_MS, easing: EASE });
    });

    // 2700 — the wordmark draws in. Letters take their own stagger below.
    at(T_LETTERS, () => {
      words.value = 1;
    });

    // 3250 — the motto.
    at(T_MOTTO, () => {
      motto.value = withTiming(1, { duration: MOTTO_MS });
    });

    // 4300 — lift away to Home.
    at(T_EXIT, () => {
      exit.value = withTiming(1, { duration: EXIT_MS });
    });
    at(T_DONE, onDone);

    return () => timers.forEach(clearTimeout);
    // Shared values are stable refs; fragments is rebuilt each render but its
    // members are not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion, onDone]);

  const groundStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColorHex(ground.value, colors.accent, colors.base),
  }));

  const stageStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ translateY: -28 * exit.value }],
  }));

  const markStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: -LIFT * markLift.value },
      { scale: markScale.value * (1 + (HIT_SCALE - 1) * markHit.value) },
    ],
  }));

  const markProps = useAnimatedProps(() => ({ fill: markFill.value }));

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.34 * halo.value,
    transform: [{ translateY: -LIFT * markLift.value }],
  }));

  const mottoStyle = useAnimatedStyle(() => ({ opacity: motto.value }));

  return (
    <Animated.View style={[styles.ground, groundStyle]}>
      <Animated.View style={[styles.stage, stageStyle]}>
        <View style={styles.markBox}>
          <View style={styles.centre}>
            <Animated.View style={[styles.halo, haloStyle]} />
          </View>

          {FRAGMENTS.map((fragment, i) => (
            <Fragment
              key={fragment.text}
              text={fragment.text}
              x={fragment.x}
              y={fragment.y}
              values={fragments[i]}
            />
          ))}

          <Animated.View style={[styles.markLayer, markStyle]}>
            <Svg width={SPLASH_SIZE} height={SPLASH_SIZE} viewBox="0 0 100 100">
              <AnimatedPath
                d={MMERE_DANE_PATH}
                animatedProps={markProps}
                fillRule="evenodd"
              />
            </Svg>
          </Animated.View>

          <View style={[styles.textRow, { top: WORD_TOP }]}>
            <View style={styles.word} accessible accessibilityLabel={WORDMARK}>
              {WORDMARK.split('').map((character, index) => (
                <Letter
                  key={`${character}-${index}`}
                  character={character}
                  index={index}
                  go={words}
                  reduceMotion={reduceMotion === true}
                />
              ))}
            </View>
          </View>

          <Animated.Text style={[styles.textRow, styles.motto, { top: MOTTO_TOP }, mottoStyle]}>
            {MOTTO}
          </Animated.Text>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

/**
 * Reanimated animates colour strings in withTiming, but interpolating between
 * two hex tokens inside a worklet needs a numeric driver. Mixes channel-wise.
 */
function interpolateColorHex(t: number, from: string, to: string): string {
  'worklet';
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const mix = (shift: number) => {
    const x = (a >> shift) & 0xff;
    const y = (b >> shift) & 0xff;
    return Math.round(x + (y - x) * t);
  };
  const r = mix(16);
  const g = mix(8);
  const bl = mix(0);
  return `rgb(${r}, ${g}, ${bl})`;
}

type FragmentValues = {
  surface: SharedValue<number>;
  drift: SharedValue<number>;
  pull: SharedValue<number>;
  fade: SharedValue<number>;
};

function useFragmentValues(): FragmentValues {
  return {
    surface: useSharedValue(0),
    drift: useSharedValue(0),
    pull: useSharedValue(0),
    fade: useSharedValue(0),
  };
}

type FragmentProps = {
  text: string;
  x: number;
  y: number;
  values: FragmentValues;
};

function Fragment({ text: label, x, y, values }: FragmentProps) {
  const style = useAnimatedStyle((): TextStyle => {
    const s = values.surface.value;
    const d = values.drift.value;
    const p = values.pull.value;
    const f = values.fade.value;

    // Surface out at the scatter point, creep 6% inward while drifting, then
    // get pulled to the centre.
    const driftX = x * (1 - 0.06 * d);
    const driftY = y * (1 - 0.06 * d);

    return {
      opacity: 0.85 * s * (1 - f),
      transform: [
        { translateX: driftX * (1 - p) },
        { translateY: driftY * (1 - p) },
        { scale: (0.92 + 0.08 * s) * (1 - 0.72 * p) },
      ],
      filter: `blur(${4 * (1 - s) + 2 * f}px)`,
    };
  });

  return (
    <View style={styles.centre} pointerEvents="none">
      <Animated.Text style={[styles.fragment, style]} numberOfLines={1}>
        {label}
      </Animated.Text>
    </View>
  );
}

type LetterProps = {
  character: string;
  index: number;
  go: SharedValue<number>;
  reduceMotion: boolean;
};

/** Each letter draws in on its own delay, 55ms behind the one before it. */
function Letter({ character, index, go, reduceMotion }: LetterProps) {
  const shown = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      shown.value = withTiming(1, { duration: REDUCED_FADE });
      return;
    }
    const timer = setTimeout(() => {
      shown.value = withTiming(1, {
        duration: LETTER_MS,
        easing: EASE_HANDOFF,
      });
    }, T_LETTERS + index * T_LETTER_GAP);
    return () => clearTimeout(timer);
  }, [index, reduceMotion, shown]);

  const style = useAnimatedStyle(() => ({
    // `go` gates the letters to the sequence; each then runs its own fade.
    opacity: shown.value * (reduceMotion ? 1 : go.value),
    transform: [{ translateY: interpolate(shown.value, [0, 1], [8, 0]) }],
  }));

  return <Animated.Text style={[styles.letter, style]}>{character}</Animated.Text>;
}

const styles = StyleSheet.create({
  ground: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markBox: {
    width: SPLASH_SIZE,
    height: SPLASH_SIZE,
  },
  markLayer: {
    ...StyleSheet.absoluteFill,
  },
  /** A zero-size anchor at the mark's centre; children centre on that point. */
  centre: {
    position: 'absolute',
    left: SPLASH_SIZE / 2,
    top: SPLASH_SIZE / 2,
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  halo: {
    width: HALO_SIZE,
    height: HALO_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
    ...shadow.accent,
  },
  fragment: {
    ...text.caption,
    color: colors.inkMuted,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  textRow: {
    position: 'absolute',
    left: -SPLASH_SIZE * 2,
    right: -SPLASH_SIZE * 2,
    alignItems: 'center',
    textAlign: 'center',
  },
  word: {
    flexDirection: 'row',
  },
  letter: {
    ...text.wordmark,
    color: colors.ink,
  },
  motto: {
    // The BrandIntro spec sets the motto at 12px, one step below the motto
    // token, keeping the token's 0.28em tracking.
    ...text.motto,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 12 * 0.28,
    color: colors.inkMuted,
    marginTop: spacing.space1,
  },
});

export default BrandIntro;
