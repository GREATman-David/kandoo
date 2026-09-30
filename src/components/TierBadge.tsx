import { Pressable, StyleSheet, Text } from 'react-native';

import type { Tier } from '@/services/purchases';
import { colors, fontFamily, radius, text } from '@/theme/theme';

/**
 * The account pill on Home, which says what the user has. Free and Pro share
 * the quiet pale-gold pill; Elite keeps the same size (so the top bar never
 * overflows a phone) but wears a thicker gold border and its name in the
 * display face — bolder, a little regal. Mark colours only (AGENTS §7).
 */

type Props = { tier: Tier; onPress: () => void };

export function TierBadge({ tier, onPress }: Props) {
  const elite = tier === 'elite';
  const label = elite ? 'Elite' : tier === 'pro' ? 'Pro' : 'Free';

  return (
    <Pressable
      style={[styles.pill, elite && styles.elite]}
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={`Account, Kandoo ${label}`}
    >
      <Text style={elite ? styles.eliteText : styles.text} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    backgroundColor: colors.accentWash,
    borderRadius: radius.full,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  text: {
    ...text.label,
    textTransform: 'none',
    letterSpacing: 1,
    color: colors.markRing,
  },
  // Same outer size as the other pills: the thicker border comes out of the
  // padding, and the name keeps the label's height — only bolder and regal.
  elite: {
    borderWidth: 2,
    borderColor: colors.markCore,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  eliteText: {
    fontFamily: fontFamily.displayItalic,
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 0.6,
    color: colors.markOuter,
  },
});
