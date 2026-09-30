import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KandooSymbol } from '@/components/Symbol';
import { checkPasscode, PASSCODE_LENGTH, setPasscode } from '@/services/appLock';
import { colors, radius, spacing, text } from '@/theme/theme';

/**
 * The passcode screen, in three modes:
 *   - 'set'    choose a passcode, then enter it again to confirm;
 *   - 'unlock' open Kandoo (full screen, no way around it but the passcode or
 *              "Forgot passcode?", which signs out);
 *   - 'verify' prove it's you before changing or removing the lock.
 * Its own keypad, so no system keyboard, autofill or suggestion bar ever sees
 * the digits. The mark stays whole; state is colour (AGENTS §7).
 */

export type PasscodeMode = 'set' | 'unlock' | 'verify';

export type PasscodeScreenProps = {
  visible: boolean;
  mode: PasscodeMode;
  userId: string;
  onDone: () => void;
  /** 'set' and 'verify' can be backed out of; 'unlock' cannot. */
  onCancel?: () => void;
  /** 'unlock' only: sign out, which clears the lock. */
  onForgot?: () => void;
  /** 'set' only: why Kandoo is asking (the first-time offer). */
  intro?: string;
};

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'] as const;

export function PasscodeScreen({ visible, mode, userId, onDone, onCancel, onForgot, intro }: PasscodeScreenProps) {
  const insets = useSafeAreaInsets();
  const [entry, setEntry] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitUntil, setWaitUntil] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!visible) return;
    setEntry('');
    setFirst(null);
    setMessage(null);
  }, [visible, mode]);

  // Count down a cool-down after too many wrong tries.
  useEffect(() => {
    if (waitUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [waitUntil]);
  const waiting = waitUntil > now;

  const title =
    mode === 'set'
      ? first === null
        ? 'Choose a passcode'
        : 'Enter it again'
      : mode === 'unlock'
        ? 'Enter your passcode'
        : 'Enter your current passcode';

  const submit = async (code: string) => {
    setBusy(true);
    try {
      if (mode === 'set') {
        if (first === null) {
          setFirst(code);
          setEntry('');
          setMessage(null);
          return;
        }
        if (code !== first) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          setFirst(null);
          setEntry('');
          setMessage('Those didn’t match. Choose it again.');
          return;
        }
        await setPasscode(userId, code);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onDone();
        return;
      }
      const result = await checkPasscode(userId, code);
      if (result.ok) {
        onDone();
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setEntry('');
      if (result.waitMs > 0) {
        setWaitUntil(Date.now() + result.waitMs);
        setNow(Date.now());
        setMessage('Too many tries. Wait a moment.');
      } else {
        setMessage(`That’s not it. ${result.triesLeft} ${result.triesLeft === 1 ? 'try' : 'tries'} before a short wait.`);
      }
    } catch (error) {
      console.warn('Passcode step failed:', error);
      setEntry('');
      setMessage('That didn’t work just now. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const press = (key: (typeof KEYS)[number]) => {
    if (busy || waiting || !key) return;
    void Haptics.selectionAsync();
    if (key === 'del') {
      setEntry((e) => e.slice(0, -1));
      return;
    }
    const next = (entry + key).slice(0, PASSCODE_LENGTH);
    setEntry(next);
    if (next.length === PASSCODE_LENGTH) void submit(next);
  };

  const seconds = Math.ceil((waitUntil - now) / 1000);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => onCancel?.()}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space7, paddingBottom: insets.bottom + spacing.space5 }]}>
        <View style={styles.head}>
          <KandooSymbol state={message && !waiting ? 'alarm' : 'idle'} size={56} />
          <Text style={styles.title}>{title}</Text>
          {mode === 'set' && first === null ? (
            <Text style={styles.hint}>
              {intro ?? `${PASSCODE_LENGTH} digits. Kandoo will ask for it when you open the app.`}
            </Text>
          ) : null}
          <View style={styles.dots} accessibilityLabel={`${entry.length} of ${PASSCODE_LENGTH} digits`}>
            {Array.from({ length: PASSCODE_LENGTH }, (_, i) => (
              <View key={i} style={[styles.dot, i < entry.length && styles.dotFilled]} />
            ))}
          </View>
          <Text style={styles.message}>{waiting ? `Try again in ${seconds}s` : message ?? ' '}</Text>
        </View>

        <View style={styles.pad}>
          {KEYS.map((key, i) => (
            <Pressable
              key={i}
              style={({ pressed }) => [styles.key, !key && styles.keyEmpty, pressed && key && styles.keyPressed]}
              onPress={() => press(key)}
              disabled={!key}
              accessibilityRole={key ? 'button' : undefined}
              accessibilityLabel={key === 'del' ? 'Delete' : key || undefined}
            >
              <Text style={styles.keyText}>{key === 'del' ? '⌫' : key}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.footer}>
          {mode === 'unlock' && onForgot ? (
            <Pressable onPress={onForgot} hitSlop={10} accessibilityRole="button">
              <Text style={styles.link}>Forgot passcode? Sign out</Text>
            </Pressable>
          ) : onCancel ? (
            <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
              <Text style={styles.link}>{mode === 'set' ? 'Not now' : 'Cancel'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const KEY_SIZE = 72;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, alignItems: 'center', justifyContent: 'space-between' },
  head: { alignItems: 'center', gap: spacing.space3, paddingHorizontal: spacing.space5 },
  title: { ...text.displayL, color: colors.ink, textAlign: 'center', marginTop: spacing.space3 },
  hint: { ...text.body, color: colors.inkMuted, textAlign: 'center' },
  dots: { flexDirection: 'row', gap: spacing.space4, marginTop: spacing.space4 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.markRing },
  dotFilled: { backgroundColor: colors.markRing },
  message: { ...text.caption, color: colors.alarmText, minHeight: 20, textAlign: 'center' },
  pad: { flexDirection: 'row', flexWrap: 'wrap', width: KEY_SIZE * 3 + spacing.space5 * 2, gap: spacing.space5, justifyContent: 'center' },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyPressed: { backgroundColor: colors.accentWash },
  keyText: { ...text.displayL, color: colors.ink },
  footer: { minHeight: 44, justifyContent: 'center' },
  link: { ...text.bodyStrong, color: colors.markRing },
});
