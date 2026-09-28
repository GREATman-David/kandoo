import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontFamily, spacing, text } from '@/theme/theme';
import { DAY_LETTERS, normalizeDays, repeatSentence } from '@/utils/repeat';

const BACK_ICON = require('@/assets/images/icons/chevron-left.png');
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type RepeatSelectionProps = {
  visible: boolean;
  /** Weekdays already chosen (0 = Sunday … 6 = Saturday); null = none. */
  days: number[] | null;
  onClose: () => void;
  /** The chosen weekdays, or null for "doesn't repeat". */
  onSave: (days: number[] | null) => void;
};

/**
 * Repeat selection (Figma: kandoo-repeat-selection). Tap the days a reminder
 * should come back on; the line beneath reads the choice back in words. No days
 * chosen means it happens once. Reached from the Repeat row in Time entry.
 */
export function RepeatSelection({ visible, days, onClose, onSave }: RepeatSelectionProps) {
  const insets = useSafeAreaInsets();
  const [chosen, setChosen] = useState<number[]>([]);

  useEffect(() => {
    if (visible) setChosen(days ?? []);
  }, [visible, days]);

  const toggle = (day: number) =>
    setChosen((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day]
    );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={[styles.bar, { marginTop: insets.top + spacing.space4 }]}>
          <Pressable
            style={styles.backBtn}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Image source={BACK_ICON} style={styles.backIcon} />
          </Pressable>
          <Pressable
            onPress={() => onSave(normalizeDays(chosen))}
            hitSlop={12}
            accessibilityRole="button"
          >
            <Text style={styles.save}>Save</Text>
          </Pressable>
        </View>

        <Text style={styles.eyebrow}>Repeat on</Text>

        <View style={styles.days}>
          {DAY_LETTERS.map((letter, day) => {
            const on = chosen.includes(day);
            return (
              <Pressable
                key={day}
                style={[styles.day, on && styles.dayOn]}
                onPress={() => toggle(day)}
                hitSlop={4}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={DAY_NAMES[day]}
              >
                <Text style={[styles.dayText, on && styles.dayTextOn]}>{letter}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.summary}>{repeatSentence(chosen)}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backIcon: { width: 20, height: 20, tintColor: colors.ink },
  save: { ...text.bodyStrong, color: colors.markRing },
  eyebrow: {
    ...text.label,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    textAlign: 'center',
    color: colors.markRing,
    marginTop: 48,
    marginBottom: 20,
  },
  days: { flexDirection: 'row', justifyContent: 'space-between' },
  day: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentWash,
  },
  dayOn: { backgroundColor: colors.markCore, borderColor: colors.markCore },
  dayText: { fontFamily: fontFamily.textSemiBold, fontSize: 15, color: colors.inkMuted },
  dayTextOn: { color: colors.ink },
  summary: {
    ...text.caption,
    textAlign: 'center',
    color: colors.inkMuted,
    marginTop: spacing.space5,
  },
});
