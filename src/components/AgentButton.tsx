import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontFamily, radius, shadow, spacing } from '@/theme/theme';

/**
 * The door to Kandoo Agent: Kandoo's portrait, drawn as line art, resting on
 * the right edge of Home. It behaves like the bottom tabs — muted ink at rest,
 * olive-gold when pressed and while the conversation is open — so it reads as
 * part of the same navigation, not a floating ad.
 */

const SIZE = 44;

type Props = {
  /** The Agent conversation is open. */
  active: boolean;
  onPress: () => void;
};

export function AgentButton({ active, onPress }: Props) {
  const [pressed, setPressed] = useState(false);
  const lit = active || pressed;
  const tint = lit ? colors.markRing : colors.inkMuted;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      hitSlop={8}
      style={styles.wrap}
      accessibilityRole="button"
      accessibilityLabel="Talk to Mr. Kandoo"
      accessibilityState={{ selected: active }}
    >
      <View style={[styles.disc, lit && styles.discLit]}>
        <Image
          source={require('@/assets/images/agent/kandoo-agent.png')}
          style={[styles.portrait, { tintColor: tint }]}
          resizeMode="contain"
        />
      </View>
      <Text style={[styles.label, lit && styles.labelLit]}>Mr. Kandoo</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2 },
  disc: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...shadow.pending,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  portrait: { width: SIZE - 6, height: SIZE - 6 },
  discLit: { borderColor: colors.markRing, backgroundColor: colors.accentWash },
  label: { fontFamily: fontFamily.textRegular, fontSize: 11, lineHeight: 14, color: colors.inkMuted },
  labelLit: { fontFamily: fontFamily.textSemiBold, color: colors.markRing },
});
