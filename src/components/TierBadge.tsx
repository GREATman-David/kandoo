import { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { Tier } from '@/services/purchases';
import { colors, fontFamily, radius, spacing } from '@/theme/theme';

/**
 * The account pill on Home, which says what the user has. Three steps, each
 * one richer, all built from the mark's own fixed colours (AGENTS §7):
 *   - Free:  a quiet outline.
 *   - Pro:   a pale-gold pill with the mark as a small medallion.
 *   - Elite: the mark's dark-brown ground, a gold rim and gold words; a light
 *            passes across it once when it appears, and it carries a soft glow.
 * The mark is never deformed — the medallion is the same concentric rings,
 * uniformly scaled.
 */

type Props = { tier: Tier; onPress: () => void };

const MEDAL = 14;

/** The Adinkrahene mark at badge size, still, in its fixed brand colours. */
function Medallion({ ground, rim }: { ground: string; rim?: boolean }) {
  const mark = (
    <View style={[styles.medalOuter, { backgroundColor: ground }]}>
      <View style={[styles.medalRing, { backgroundColor: ground }]}>
        <View style={styles.medalCore} />
      </View>
    </View>
  );
  // On Elite's dark ground the mark's dark outer ring would vanish: a gold
  // rim around the medallion keeps the whole mark visible.
  return rim ? <View style={styles.medalRim}>{mark}</View> : mark;
}

export function TierBadge({ tier, onPress }: Props) {
  const pop = useSharedValue(1);
  const sweep = useSharedValue(-1);
  const [width, setWidth] = useState(0);

  // Announce a new tier: a small settle-in, and for Elite one pass of light.
  useEffect(() => {
    if (tier === 'free') return;
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!active || reduce) return;
      const easing = Easing.out(Easing.cubic);
      pop.value = withSequence(withTiming(1.08, { duration: 220, easing }), withTiming(1, { duration: 320, easing }));
      if (tier === 'elite') {
        sweep.value = -1;
        sweep.value = withDelay(400, withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.quad) }));
      }
    });
    return () => {
      active = false;
      cancelAnimation(pop);
      cancelAnimation(sweep);
    };
  }, [tier, pop, sweep]);

  const popStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));
  const sweepStyle = useAnimatedStyle(() => ({
    opacity: sweep.value <= -1 || sweep.value >= 1 ? 0 : 0.55,
    transform: [{ translateX: ((sweep.value + 1) / 2) * (width + 40) - 40 }, { skewX: '-20deg' }],
  }));

  const label = tier === 'elite' ? 'Kandoo Elite' : tier === 'pro' ? 'Kandoo Pro' : 'Free';

  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Account, ${label}`}>
      <Animated.View
        style={[styles.pill, tier === 'free' ? styles.free : tier === 'pro' ? styles.pro : styles.elite, popStyle]}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      >
        {tier !== 'free' ? <Medallion ground={tier === 'elite' ? colors.markPale : colors.base} rim={tier === 'elite'} /> : null}
        <Text style={tier === 'free' ? styles.freeText : tier === 'pro' ? styles.proText : styles.eliteText}>{label}</Text>
        {tier === 'elite' ? <Animated.View pointerEvents="none" style={[styles.sweep, sweepStyle]} /> : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.full,
    paddingVertical: 5,
    paddingHorizontal: spacing.space3,
    overflow: 'hidden',
  },
  free: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  pro: {
    borderWidth: 1,
    borderColor: colors.markRing,
    backgroundColor: colors.markPale,
    paddingLeft: 6,
  },
  elite: {
    borderWidth: 1.5,
    borderColor: colors.markCore,
    backgroundColor: colors.markOuter,
    paddingLeft: 6,
    shadowColor: colors.markCore,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 4,
  },
  freeText: { fontFamily: fontFamily.textSemiBold, fontSize: 12, lineHeight: 16, color: colors.inkMuted, letterSpacing: 0.5 },
  proText: { fontFamily: fontFamily.displayItalic, fontSize: 14, lineHeight: 18, color: colors.markOuter },
  eliteText: { fontFamily: fontFamily.displayItalic, fontSize: 14, lineHeight: 18, color: colors.markPale, letterSpacing: 0.2 },
  medalOuter: {
    width: MEDAL,
    height: MEDAL,
    borderRadius: MEDAL / 2,
    borderWidth: MEDAL * (9 / 72) + 0.5,
    borderColor: colors.markOuter,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalRing: {
    width: MEDAL * (40 / 72),
    height: MEDAL * (40 / 72),
    borderRadius: MEDAL,
    borderWidth: MEDAL * (8 / 72) + 0.5,
    borderColor: colors.markRing,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalRim: {
    width: MEDAL + 4,
    height: MEDAL + 4,
    borderRadius: (MEDAL + 4) / 2,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medalCore: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.markCore },
  sweep: {
    position: 'absolute',
    top: -4,
    bottom: -4,
    left: 0,
    width: 22,
    backgroundColor: colors.markPale,
  },
});
