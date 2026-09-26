import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useEffect, useRef } from 'react';

import { colors, duration, radius, shadow, spacing, text } from '@/theme/theme';

export type MemoryCardState = 'pending' | 'confirmed' | 'past';

export type MemoryCardChip = {
  label: string;
  guessed?: boolean;
};

export type MemoryCardProps = {
  state: MemoryCardState;
  /** e.g. "Needs review", "Check the time", "Saved", "Scheduled", "Reminded you" — copy is the host's call, per the design system's component contract. */
  label: string;
  content: string;
  chips?: MemoryCardChip[];
  onConfirm?: () => void;
  onEdit?: () => void;
  onPress?: () => void;
};

// Matches the preview's rail/background transition curve (cubic-bezier(.22,.8,.3,1)).
const SETTLE_EASING = Easing.bezier(0.22, 0.8, 0.3, 1);
const BREATHE_EASING = Easing.inOut(Easing.ease);

const shadowShape = {
  shadowColor: shadow.pending.shadowColor,
  shadowOffset: shadow.pending.shadowOffset,
  shadowRadius: shadow.pending.shadowRadius,
};

/**
 * The one card Kandoo uses for reminders, memories and recall results. See
 * the design system's MemoryCard README for the full state table — this
 * covers pending (incl. low-confidence, which is styling the host drives via
 * `label` + `chip.guessed`, not a separate state), confirmed and past, plus
 * the settle animation that plays on pending -> confirmed.
 *
 * Not built here: swipe-to-dismiss-with-undo and inline chip editing. The
 * design system's preview.html doesn't demonstrate either, and they're
 * separate scope from "the four states and the settle animation."
 */
export function MemoryCard({
  state,
  label,
  content,
  chips = [],
  onConfirm,
  onEdit,
  onPress,
}: MemoryCardProps) {
  const isPast = state === 'past';
  const progress = useSharedValue(state === 'confirmed' ? 1 : 0);
  const hasMounted = useRef(false);

  useEffect(() => {
    if (isPast) return;
    const target = state === 'confirmed' ? 1 : 0;
    if (!hasMounted.current) {
      hasMounted.current = true;
      progress.value = target;
      return;
    }
    progress.value = withTiming(target, {
      duration: duration.settle,
      easing: SETTLE_EASING,
    });
  }, [state, isPast, progress]);

  const breathe = useSharedValue(1);
  useEffect(() => {
    if (state !== 'pending') {
      breathe.value = 1;
      return;
    }
    breathe.value = withRepeat(
      withSequence(
        withTiming(0.35, { duration: duration.breath / 2, easing: BREATHE_EASING }),
        withTiming(1, { duration: duration.breath / 2, easing: BREATHE_EASING })
      ),
      -1,
      false
    );
  }, [state, breathe]);

  const cardAnimatedStyle = useAnimatedStyle(() => {
    if (isPast) return {};
    return {
      backgroundColor: interpolateColor(
        progress.value,
        [0, 1],
        [colors.accentWash, colors.settledWash]
      ),
      shadowOpacity: shadow.pending.shadowOpacity * (1 - progress.value),
      elevation: shadow.pending.elevation * (1 - progress.value),
      transform: [{ translateY: -1 * (1 - progress.value) }],
    };
  });

  const railAnimatedStyle = useAnimatedStyle(() => {
    if (isPast) return { backgroundColor: colors.inkFaint };
    return {
      backgroundColor: interpolateColor(progress.value, [0, 1], [colors.accent, colors.settledFill]),
    };
  });

  const dotAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [colors.accent, colors.settledFill]),
    opacity: state === 'pending' ? breathe.value : 1,
  }));

  const labelColor = isPast
    ? colors.inkMuted
    : state === 'confirmed'
      ? colors.settled
      : colors.accent;

  return (
    <Animated.View
      style={[styles.card, isPast ? styles.cardPast : shadowShape, cardAnimatedStyle]}
    >
      <Pressable style={styles.pressable} onPress={onPress}>
        <View style={styles.head}>
          {state === 'confirmed' ? (
            <View style={[styles.dot, styles.dotConfirmed]}>
              <Text style={styles.check}>✓</Text>
            </View>
          ) : (
            <Animated.View
              style={[styles.dot, isPast ? { backgroundColor: colors.inkFaint } : dotAnimatedStyle]}
            />
          )}
          <Text style={[styles.label, { color: labelColor }]}>{label}</Text>
        </View>

        <Text style={styles.content}>{content}</Text>

        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((chip, index) => (
              <View key={`${chip.label}-${index}`} style={[styles.chip, chip.guessed && styles.chipWarn]}>
                <Text style={[styles.chipText, chip.guessed && styles.chipTextWarn]}>{chip.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {state === 'pending' && (onConfirm || onEdit) ? (
          <View style={styles.actions}>
            {onConfirm ? (
              <Pressable style={styles.btnPrimary} onPress={onConfirm}>
                <Text style={styles.btnPrimaryText}>Confirm</Text>
              </Pressable>
            ) : null}
            {onEdit ? (
              <Pressable style={styles.btn} onPress={onEdit}>
                <Text style={styles.btnText}>Edit</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Pressable>

      <Animated.View
        style={[styles.rail, isPast ? { backgroundColor: colors.inkFaint } : railAnimatedStyle]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: 'hidden',
  },
  cardPast: {
    backgroundColor: colors.surface,
    opacity: 0.6,
  },
  pressable: {
    padding: spacing.space4,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    marginBottom: spacing.space3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotConfirmed: {
    backgroundColor: colors.settledFill,
  },
  check: {
    fontSize: 7,
    lineHeight: 8,
    color: colors.base,
  },
  label: {
    ...text.label,
  },
  content: {
    ...text.memory,
    color: colors.ink,
    marginBottom: spacing.space3,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.space2,
  },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipWarn: {
    borderColor: colors.alarmText,
  },
  chipText: {
    ...text.caption,
    color: colors.inkMuted,
  },
  chipTextWarn: {
    color: colors.alarmText,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.space2,
    marginTop: spacing.space4,
  },
  btn: {
    minHeight: 44,
    paddingVertical: 9,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    ...text.bodyStrong,
    color: colors.inkMuted,
  },
  btnPrimary: {
    minHeight: 44,
    paddingVertical: 9,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    ...text.bodyStrong,
    color: colors.ink,
  },
  rail: {
    position: 'absolute',
    left: 0,
    bottom: 0,
    height: 2,
    width: '100%',
  },
});
