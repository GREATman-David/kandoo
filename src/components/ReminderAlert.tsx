import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KandooSymbol } from '@/components/Symbol';
import { logFailure, updateReminder, userMessage } from '@/services/interpretationService';
import {
  cancelReminder,
  isScheduledRepeating,
  scheduleReminder,
  snoozeRepeatingOnce,
} from '@/services/localNotifications';
import { colors, fontFamily, radius, spacing } from '@/theme/theme';

/** What the alert needs, all of it carried by the notification itself. */
export type AlertReminder = {
  reminderId: string;
  /** The OS notification that raised it, cleared from the shade on close. */
  notificationId: string | null;
  title: string;
  body: string;
  repeating: boolean;
  insistent: boolean;
};

export type ReminderAlertProps = {
  alert: AlertReminder | null;
  onClose: () => void;
};

const ICONS = {
  clock: require('@/assets/images/icons/clock-3.png'),
  check: require('@/assets/images/icons/alert-check.png'),
  x: require('@/assets/images/icons/x.png'),
};

/** Snooze lengths the − / + step through, in minutes. */
const SNOOZE_STEPS = [5, 10, 15, 30, 60];

const SQUARE = 16;
/** Each border side cycles four brand colours, out of step with its neighbours. */
const BORDER = {
  top: [colors.markRing, colors.markCore, colors.markPale, colors.ink],
  right: [colors.markRing, colors.markPale, colors.ink, colors.markCore],
  bottom: [colors.markCore, colors.ink, colors.markRing, colors.markPale],
  left: [colors.markCore, colors.ink, colors.markPale, colors.markRing],
};

/**
 * The full-screen reminder (Figma: Kandoo reminder alert). Shown the moment a
 * reminder fires while the app is open, and when a reminder notification is
 * tapped — from the lock screen once the phone is unlocked, or from the shade.
 *
 *   Snooze  — a one-off reminder moves to now + the chosen minutes; a repeating
 *             one gets a single extra alert and keeps its weekly time.
 *   Done    — a one-off reminder is completed (it moves to History). A
 *             repeating one has done today's; the series carries on.
 *   Dismiss — closes the alert and changes nothing; the reminder stays listed.
 */
export function ReminderAlert({ alert, onClose }: ReminderAlertProps) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (alert) {
      setStep(0);
      setError(null);
    }
  }, [alert]);

  if (!alert) {
    return <Modal visible={false} transparent onRequestClose={onClose} />;
  }

  const minutes = SNOOZE_STEPS[step];

  const close = () => {
    if (alert.notificationId) {
      Notifications.dismissNotificationAsync(alert.notificationId).catch((caught: unknown) =>
        logFailure('Clearing the reminder notification failed:', caught)
      );
    }
    onClose();
  };

  // A reminder scheduled before the alert existed doesn't say whether it
  // repeats; the device's own schedule does.
  const repeats = async () => alert.repeating || (await isScheduledRepeating(alert.reminderId));

  const run = async (action: () => Promise<void>, failure: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      close();
    } catch (caught) {
      logFailure(failure, caught);
      setError(userMessage(caught, 'Couldn’t do that just now. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const snooze = () =>
    run(async () => {
      if (await repeats()) {
        await snoozeRepeatingOnce(alert, minutes);
        return;
      }
      const dueAt = new Date(Date.now() + minutes * 60_000).toISOString();
      const updated = await updateReminder(alert.reminderId, { dueAt, status: 'confirmed' });
      await scheduleReminder(updated);
    }, 'Snoozing the reminder failed:');

  const done = () =>
    run(async () => {
      if (await repeats()) return;
      await updateReminder(alert.reminderId, { status: 'fired' });
      await cancelReminder(alert.reminderId);
    }, 'Completing the reminder failed:');

  return (
    <Modal
      visible
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={close}
    >
      <View
        style={styles.screen}
        onLayout={(e) =>
          setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })
        }
      >
        {/* Faint rings off the top-right corner, under the border. */}
        <View style={[styles.ring, styles.ringLarge]} pointerEvents="none" />
        <View style={[styles.ring, styles.ringSmall]} pointerEvents="none" />

        <CheckerBorder width={size.width} height={size.height} />

        <View
          style={[
            styles.content,
            {
              paddingTop: insets.top + spacing.space6 - spacing.space1,
              paddingBottom: insets.bottom + spacing.space5,
            },
          ]}
        >
          <View style={styles.brandRow}>
            <Text style={styles.wordmark}>Kandoo</Text>
            <View style={styles.badge}>
              <View style={styles.liveDot} />
              <Text style={styles.badgeText}>Reminder</Text>
            </View>
          </View>

          <View style={styles.middle}>
            <View style={styles.markWrap}>
              <View style={styles.markGlow} />
              <KandooSymbol state="idle" size={112} gapColor={colors.accentWash} />
            </View>
            <View style={styles.message}>
              <Text style={styles.eyebrow}>It’s time</Text>
              <Text style={styles.task} accessibilityRole="header">
                {alert.title}
              </Text>
            </View>
          </View>

          <View style={styles.actions}>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            <View style={styles.snooze}>
              <Pressable
                style={styles.snoozeLabel}
                onPress={snooze}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Snooze for ${minutes} minutes`}
              >
                <Image source={ICONS.clock} style={styles.snoozeIcon} />
                <Text style={styles.snoozeText}>{busy ? 'One moment…' : 'Snooze'}</Text>
              </Pressable>
              <View style={styles.duration}>
                <Pressable
                  style={[styles.stepBtn, step === 0 && styles.stepBtnOff]}
                  onPress={() => setStep((s) => Math.max(0, s - 1))}
                  disabled={step === 0}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Shorter snooze"
                >
                  <View style={styles.bar} />
                </Pressable>
                <Text style={styles.durationText}>
                  {minutes < 60 ? `${minutes} min` : '1 hour'}
                </Text>
                <Pressable
                  style={[styles.stepBtn, step === SNOOZE_STEPS.length - 1 && styles.stepBtnOff]}
                  onPress={() => setStep((s) => Math.min(SNOOZE_STEPS.length - 1, s + 1))}
                  disabled={step === SNOOZE_STEPS.length - 1}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Longer snooze"
                >
                  <View style={styles.plus}>
                    <View style={[styles.bar, styles.barAcross]} />
                    <View style={[styles.bar, styles.barDown]} />
                  </View>
                </Pressable>
              </View>
            </View>

            <View style={styles.otherActions}>
              <Pressable
                style={styles.secondary}
                onPress={done}
                disabled={busy}
                accessibilityRole="button"
              >
                <Image source={ICONS.check} style={styles.secondaryIcon} />
                <Text style={styles.secondaryText}>Done</Text>
              </Pressable>
              <Pressable
                style={styles.secondary}
                onPress={close}
                disabled={busy}
                accessibilityRole="button"
              >
                <Image source={ICONS.x} style={styles.secondaryIcon} />
                <Text style={styles.secondaryText}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** The 16px checkered frame round the edge of the screen. */
function CheckerBorder({ width, height }: { width: number; height: number }) {
  if (!width || !height) return null;
  const across = Math.ceil(width / SQUARE);
  const down = Math.ceil(Math.max(0, height - 2 * SQUARE) / SQUARE);
  const squares = (count: number, cycle: string[]) =>
    Array.from({ length: count }, (_, i) => (
      <View key={i} style={[styles.square, { backgroundColor: cycle[i % cycle.length] }]} />
    ));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.edgeRow, { top: 0 }]}>{squares(across, BORDER.top)}</View>
      <View style={[styles.edgeRow, { bottom: 0 }]}>{squares(across, BORDER.bottom)}</View>
      <View style={[styles.edgeColumn, { left: 0 }]}>{squares(down, BORDER.left)}</View>
      <View style={[styles.edgeColumn, { right: 0 }]}>{squares(down, BORDER.right)}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.accentWash, overflow: 'hidden' },

  square: { width: SQUARE, height: SQUARE },
  edgeRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: SQUARE,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  edgeColumn: {
    position: 'absolute',
    top: SQUARE,
    bottom: SQUARE,
    width: SQUARE,
    overflow: 'hidden',
  },

  ring: {
    position: 'absolute',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.markRing,
    opacity: 0.12,
  },
  ringLarge: { width: 180, height: 180, top: -72, right: -68 },
  ringSmall: { width: 116, height: 116, top: -40, right: -36 },

  content: {
    flex: 1,
    paddingHorizontal: spacing.space5,
    justifyContent: 'space-between',
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wordmark: { fontFamily: fontFamily.displayItalic, fontSize: 16, color: colors.ink },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.markPale,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.markRing },
  badgeText: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.markRing,
  },

  middle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  markWrap: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  markGlow: {
    position: 'absolute',
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: colors.ink,
    opacity: 0.08,
  },
  message: { alignItems: 'center', gap: spacing.space2, alignSelf: 'stretch' },
  eyebrow: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.markRing,
  },
  task: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 29,
    lineHeight: 35,
    textAlign: 'center',
    color: colors.ink,
  },

  actions: { gap: spacing.space3 },
  error: {
    fontFamily: fontFamily.textRegular,
    fontSize: 13,
    textAlign: 'center',
    color: colors.alarmText,
  },
  snooze: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    paddingHorizontal: 18,
    borderRadius: 14,
    backgroundColor: colors.markCore,
    shadowColor: colors.markRing,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 18,
    elevation: 4,
  },
  snoozeLabel: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, height: '100%' },
  snoozeIcon: { width: 20, height: 20, tintColor: colors.ink },
  snoozeText: { fontFamily: fontFamily.textRegular, fontSize: 16, color: colors.ink },
  duration: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space2,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  stepBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentWash,
  },
  stepBtnOff: { opacity: 0.45 },
  bar: { width: 10, height: 2, borderRadius: 1, backgroundColor: colors.markRing },
  plus: { width: 10, height: 10 },
  barAcross: { position: 'absolute', top: 4, left: 0 },
  barDown: { position: 'absolute', top: 0, left: 4, width: 2, height: 10 },
  durationText: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 14,
    color: colors.ink,
    minWidth: 44,
    textAlign: 'center',
  },
  otherActions: { flexDirection: 'row', gap: spacing.space3 },
  secondary: {
    flex: 1,
    height: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.space2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  secondaryIcon: { width: 17, height: 17, tintColor: colors.ink },
  secondaryText: { fontFamily: fontFamily.textSemiBold, fontSize: 14, color: colors.ink },
});
