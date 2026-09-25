import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, text } from '@/theme/theme';

import { KandooSymbol } from './Symbol';

export type EmptyStateProps = {
  /** The serif line — what's absent, stated plainly. */
  line: string;
  /** The help line — how the user fills it. */
  help: string;
};

/**
 * The shared empty state for every tab: the mark held at 40% opacity (idle, its
 * quietest state — a watermark, not a call for attention), one serif line, one
 * help line. Same shape everywhere so an empty Home and an empty Reminders read
 * as the same app resting, not four different blank screens.
 */
export function EmptyState({ line, help }: EmptyStateProps) {
  return (
    <View style={styles.wrap}>
      <View style={styles.mark}>
        <KandooSymbol state="idle" size={72} />
      </View>
      <Text style={styles.line}>{line}</Text>
      <Text style={styles.help}>{help}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    marginTop: spacing.space8,
  },
  mark: {
    opacity: 0.4,
    marginBottom: spacing.space5,
  },
  line: {
    ...text.displayL,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.space2,
  },
  help: {
    ...text.body,
    color: colors.inkMuted,
    textAlign: 'center',
    maxWidth: 280,
  },
});
