import { StyleSheet, Text, View } from 'react-native';

import { useOffline } from '@/services/offlineCache';
import { colors, radius, spacing, text } from '@/theme/theme';

/**
 * One quiet line while the screens are showing what's saved on this phone
 * because Kandoo can't be reached. Renders nothing when online.
 */
export function OfflineNote() {
  const offline = useOffline();
  if (!offline) return null;

  return (
    <View style={styles.row} accessibilityRole="text" accessibilityLiveRegion="polite">
      <View style={styles.dot} />
      <Text style={styles.text}>Offline · showing what’s saved</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    marginBottom: spacing.space3,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.inkFaint,
  },
  text: {
    ...text.caption,
    color: colors.inkMuted,
  },
});
