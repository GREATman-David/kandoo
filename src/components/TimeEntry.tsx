import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, text } from '@/theme/theme';

export type TimeEntryProps = {
  visible: boolean;
  /** The time to start from; the chosen time is applied to this date (or today
   *  for a fresh pick), rolling to tomorrow if it would otherwise be in the past. */
  initialISO?: string | null;
  saveLabel?: string;
  onClose: () => void;
  onSave: (iso: string) => void;
};

type AmPm = 'AM' | 'PM';

function fromISO(iso?: string | null): { buf: string; ampm: AmPm } {
  const d = iso ? new Date(iso) : new Date();
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  const h = base.getHours();
  const m = base.getMinutes();
  const ampm: AmPm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return {
    buf: String(h12).padStart(2, '0') + String(m).padStart(2, '0'),
    ampm,
  };
}

/**
 * Time entry — digital only, no clock dial. Digits flow in left-to-right and the
 * display right-justifies into HH:MM (type "7 0 0" → 07:00). Reached from the
 * review sheet's time chip, a reminder's detail, and manual creation.
 */
export function TimeEntry({
  visible,
  initialISO,
  saveLabel = 'Save',
  onClose,
  onSave,
}: TimeEntryProps) {
  const [buf, setBuf] = useState('');
  const [ampm, setAmpm] = useState<AmPm>('AM');

  useEffect(() => {
    if (!visible) return;
    const start = fromISO(initialISO);
    setBuf(start.buf);
    setAmpm(start.ampm);
  }, [visible, initialISO]);

  const padded = buf.padStart(4, '0');
  const hh = parseInt(padded.slice(0, 2), 10);
  const mm = parseInt(padded.slice(2, 4), 10);
  const valid = hh >= 1 && hh <= 12 && mm >= 0 && mm <= 59;

  const press = (d: string) => setBuf((b) => (b + d).slice(-4));
  const back = () => setBuf((b) => b.slice(0, -1));

  const save = () => {
    if (!valid) return;
    const h24 = (hh % 12) + (ampm === 'PM' ? 12 : 0);
    const base =
      initialISO && !Number.isNaN(Date.parse(initialISO))
        ? new Date(initialISO)
        : new Date();
    base.setHours(h24, mm, 0, 0);
    if (base.getTime() <= Date.now()) base.setDate(base.getDate() + 1);
    onSave(base.toISOString());
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>✕</Text>
          </Pressable>
          <Pressable onPress={save} hitSlop={12} disabled={!valid}>
            <Text style={[styles.save, !valid && styles.saveDisabled]}>
              {saveLabel}
            </Text>
          </Pressable>
        </View>

        <View style={styles.display}>
          <Text style={styles.time}>
            {padded.slice(0, 2)}:{padded.slice(2, 4)}
          </Text>
          <View style={styles.ampmRow}>
            {(['AM', 'PM'] as AmPm[]).map((v) => (
              <Pressable
                key={v}
                style={[styles.ampm, ampm === v && styles.ampmOn]}
                onPress={() => setAmpm(v)}
              >
                <Text style={[styles.ampmText, ampm === v && styles.ampmTextOn]}>
                  {v}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.keypad}>
          {keys.map((k, i) =>
            k === '' ? (
              <View key={i} style={styles.key} />
            ) : (
              <Pressable
                key={i}
                style={styles.key}
                onPress={() => (k === '⌫' ? back() : press(k))}
              >
                <Text style={styles.keyText}>{k}</Text>
              </Pressable>
            )
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.base,
    paddingHorizontal: spacing.space4,
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.space7,
    paddingBottom: spacing.space4,
  },
  close: {
    ...text.displayL,
    color: colors.inkMuted,
  },
  save: {
    ...text.bodyStrong,
    color: colors.accent,
  },
  saveDisabled: {
    color: colors.inkFaint,
  },
  display: {
    alignItems: 'center',
    marginTop: spacing.space6,
    marginBottom: spacing.space7,
  },
  time: {
    fontFamily: text.displayXl.fontFamily,
    fontSize: 72,
    lineHeight: 80,
    color: colors.ink,
  },
  ampmRow: {
    flexDirection: 'row',
    gap: spacing.space2,
    marginTop: spacing.space4,
  },
  ampm: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingVertical: spacing.space2,
    paddingHorizontal: spacing.space4,
  },
  ampmOn: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  ampmText: {
    ...text.bodyStrong,
    color: colors.inkMuted,
  },
  ampmTextOn: {
    color: colors.base,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.space3,
  },
  key: {
    width: '30%',
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  keyText: {
    fontFamily: text.displayL.fontFamily,
    fontSize: 26,
    color: colors.ink,
  },
});
