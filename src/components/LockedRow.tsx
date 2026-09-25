import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, text } from '@/theme/theme';

export type LockedRowProps = {
  title: string;
  onPress: () => void;
  /** Long-press to delete the item, same as any unlocked row. */
  onLongPress?: () => void;
};

/**
 * A memory beyond the free ten-day window. No blur, no teaser — the title reads
 * in ink-faint with a small lock and "Part of Kandoo Pro" where the date would
 * sit. Tapping opens the paywall. Reused by People detail and the Memory list.
 */
export function LockedRow({ title, onPress, onLongPress }: LockedRowProps) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
    >
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.right}>
        <LockGlyph />
        <Text style={styles.pro}>Part of Kandoo Pro</Text>
      </View>
    </Pressable>
  );
}

function LockGlyph() {
  return (
    <View style={styles.lock} pointerEvents="none">
      <View style={styles.shackle} />
      <View style={styles.body} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: spacing.space3,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  title: {
    ...text.body,
    color: colors.inkFaint,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space1,
    marginTop: 2,
  },
  pro: {
    ...text.caption,
    color: colors.inkFaint,
  },
  lock: {
    width: 12,
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginRight: 2,
  },
  shackle: {
    width: 7,
    height: 5,
    borderWidth: 1.5,
    borderColor: colors.inkFaint,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    borderBottomWidth: 0,
  },
  body: {
    width: 11,
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.inkFaint,
    marginTop: -1,
  },
});
