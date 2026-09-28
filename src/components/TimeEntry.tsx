import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';
import { nextOccurrence, normalizeDays, repeatShort } from '@/utils/repeat';

import { RepeatSelection } from './RepeatSelection';

export type TimeEntryProps = {
  visible: boolean;
  /** The time to start from; the chosen time is applied to this date (or today
   *  for a fresh pick), rolling to tomorrow if it would otherwise be in the past. */
  initialISO?: string | null;
  saveLabel?: string;
  /** Show the Repeat row. Its days come back as the second argument of onSave. */
  allowRepeat?: boolean;
  /** Weekdays the reminder already repeats on (0 = Sunday … 6 = Saturday). */
  repeatDays?: number[] | null;
  onClose: () => void;
  /** The chosen time; for a repeating choice, its next occurrence. */
  onSave: (iso: string, repeatDays: number[] | null) => void;
};

type AmPm = 'AM' | 'PM';

const CLOSE_ICON = require('@/assets/images/icons/x-circle.png');
const OPEN_ICON = require('@/assets/images/icons/chevron-right.png');

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

/** One row of a wheel, and how many rows show at once (the middle is chosen). */
const ROW = 48;
const VISIBLE_ROWS = 5;

function fromISO(iso?: string | null): { hour: number; minute: number; ampm: AmPm } {
  const d = iso ? new Date(iso) : new Date();
  const base = Number.isNaN(d.getTime()) ? new Date() : d;
  const h = base.getHours();
  return {
    hour: h % 12 === 0 ? 12 : h % 12,
    minute: base.getMinutes(),
    ampm: h >= 12 ? 'PM' : 'AM',
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Time entry (Figma: kandoo-time-entry). Scroll the hour and minute wheels to
 * the time you want — the big display follows as you scroll — then AM or PM.
 * The keypad it replaces asked people to type digits that right-justified into
 * HH:MM, which was easy to get wrong. Reached from a reminder's detail and
 * manual creation.
 */
export function TimeEntry({
  visible,
  initialISO,
  saveLabel = 'Save',
  allowRepeat = false,
  repeatDays = null,
  onClose,
  onSave,
}: TimeEntryProps) {
  const insets = useSafeAreaInsets();
  const [hour, setHour] = useState(12);
  const [minute, setMinute] = useState(0);
  const [ampm, setAmpm] = useState<AmPm>('AM');
  // Bumped on each open so the wheels remount at the starting time.
  const [openKey, setOpenKey] = useState(0);
  const [days, setDays] = useState<number[] | null>(null);
  const [repeatOpen, setRepeatOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const start = fromISO(initialISO);
    setHour(start.hour);
    setMinute(start.minute);
    setAmpm(start.ampm);
    setDays(normalizeDays(repeatDays));
    setOpenKey((k) => k + 1);
  }, [visible, initialISO, repeatDays]);

  const save = () => {
    const h24 = (hour % 12) + (ampm === 'PM' ? 12 : 0);
    const base =
      initialISO && !Number.isNaN(Date.parse(initialISO))
        ? new Date(initialISO)
        : new Date();
    base.setHours(h24, minute, 0, 0);
    const chosenDays = allowRepeat ? normalizeDays(days) : null;
    if (chosenDays) {
      // Repeating: the reminder's time is its next chosen day at this time.
      onSave(nextOccurrence(base.toISOString(), chosenDays).toISOString(), chosenDays);
      return;
    }
    if (base.getTime() <= Date.now()) base.setDate(base.getDate() + 1);
    onSave(base.toISOString(), null);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={[styles.bar, { marginTop: insets.top + spacing.space4 }]}>
          <Pressable
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Image source={CLOSE_ICON} style={styles.closeIcon} />
          </Pressable>
          <Pressable onPress={save} hitSlop={12} accessibilityRole="button">
            <Text style={styles.save}>{saveLabel}</Text>
          </Pressable>
        </View>

        <View style={styles.display}>
          <Text style={styles.time} accessibilityLiveRegion="polite">
            {pad(hour)}:{pad(minute)}
          </Text>
          <View style={styles.ampmRow}>
            {(['AM', 'PM'] as AmPm[]).map((v) => (
              <Pressable
                key={v}
                style={[styles.ampm, ampm === v && styles.ampmOn]}
                onPress={() => setAmpm(v)}
                accessibilityRole="radio"
                accessibilityState={{ selected: ampm === v }}
              >
                <Text style={[styles.ampmText, ampm === v && styles.ampmTextOn]}>{v}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.wheels}>
          {/* The band that marks the chosen row, behind both wheels. */}
          <View style={styles.band} pointerEvents="none" />
          <Wheel
            key={`h${openKey}`}
            values={HOURS}
            value={hour}
            format={pad}
            onChange={setHour}
            label="Hour"
          />
          <Text style={styles.colon}>:</Text>
          <Wheel
            key={`m${openKey}`}
            values={MINUTES}
            value={minute}
            format={pad}
            onChange={setMinute}
            label="Minute"
          />
        </View>

        {allowRepeat ? (
          <Pressable
            style={styles.repeatRow}
            onPress={() => setRepeatOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Repeat: ${repeatShort(days)}`}
          >
            <Text style={styles.repeatLabel}>Repeat</Text>
            <View style={styles.repeatValueWrap}>
              <Text style={styles.repeatValue} numberOfLines={1}>
                {repeatShort(days)}
              </Text>
              <Image source={OPEN_ICON} style={styles.repeatIcon} />
            </View>
          </Pressable>
        ) : null}
      </View>

      <RepeatSelection
        visible={repeatOpen}
        days={days}
        onClose={() => setRepeatOpen(false)}
        onSave={(chosen) => {
          setDays(chosen);
          setRepeatOpen(false);
        }}
      />
    </Modal>
  );
}

type WheelProps = {
  values: number[];
  value: number;
  format: (n: number) => string;
  onChange: (n: number) => void;
  label: string;
};

/** Rows in a wheel's scroll: its values repeated so the ends are never in reach. */
const LOOP_ROWS = 300;

/**
 * A snapping scroll wheel that goes round: after 59 comes 00, before 1 comes
 * 12. The values repeat down a long list and the wheel starts in the middle;
 * whenever it comes to rest it is moved, invisibly, back to the same value in
 * the middle copy, so the user can keep scrolling either way for ever. The row
 * in the middle is the choice; it updates as the wheel moves (with a light
 * tick), and a tap on any row scrolls it there. Built on ScrollView so it needs
 * no new native module.
 */
function Wheel({ values, value, format, onChange, label }: WheelProps) {
  const ref = useRef<ScrollView>(null);
  const count = values.length;
  // An odd number of copies, so there is a true middle one.
  const copies = Math.max(3, Math.ceil(LOOP_ROWS / count) | 1);
  const middle = Math.floor(copies / 2) * count;

  // Fixed at mount: the wheel remounts on each open, and a start that followed
  // `value` would re-apply the offset and fight the user's scroll.
  const [startIndex] = useState(() => middle + Math.max(0, values.indexOf(value)));
  const current = useRef(startIndex);
  const placed = useRef(false);
  const [selected, setSelected] = useState(startIndex);

  const indexAt = (y: number) =>
    Math.min(count * copies - 1, Math.max(0, Math.round(y / ROW)));

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = indexAt(e.nativeEvent.contentOffset.y);
    if (index === current.current) return;
    const changed = index % count !== current.current % count;
    current.current = index;
    setSelected(index);
    if (!changed) return;
    onChange(values[index % count]);
    void Haptics.selectionAsync().catch(() => {
      // Haptics are a nicety; a device without them still picks the time.
    });
  };

  // At rest: hop back to the same value in the middle copy. Same value, same
  // look, so the jump can't be seen — and the wheel never runs out.
  const recenter = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = indexAt(e.nativeEvent.contentOffset.y);
    const centred = middle + (index % count);
    if (centred === index) return;
    current.current = centred;
    setSelected(centred);
    ref.current?.scrollTo({ y: centred * ROW, animated: false });
  };

  const rows = Array.from({ length: count * copies }, (_, i) => values[i % count]);

  return (
    <ScrollView
      ref={ref}
      style={styles.wheel}
      contentContainerStyle={{ paddingVertical: ROW * Math.floor(VISIBLE_ROWS / 2) }}
      contentOffset={{ x: 0, y: startIndex * ROW }}
      onLayout={() => {
        if (placed.current) return;
        placed.current = true;
        ref.current?.scrollTo({ y: startIndex * ROW, animated: false });
      }}
      snapToInterval={ROW}
      decelerationRate="fast"
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      onMomentumScrollEnd={recenter}
      scrollEventThrottle={16}
      nestedScrollEnabled
      accessibilityLabel={label}
      accessibilityValue={{ text: format(values[selected % count]) }}
    >
      {rows.map((v, i) => (
        <Pressable
          key={i}
          style={styles.row}
          onPress={() => ref.current?.scrollTo({ y: i * ROW, animated: true })}
        >
          <Text style={[styles.rowText, i === selected && styles.rowTextOn]}>{format(v)}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // Figma: kandoo-time-entry.
  screen: {
    flex: 1,
    backgroundColor: colors.base,
    paddingHorizontal: spacing.space5,
  },
  bar: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  closeBtn: { width: 40, height: 40, justifyContent: 'center' },
  closeIcon: { width: 20, height: 20, tintColor: colors.ink },
  save: { ...text.bodyStrong, color: colors.markRing },
  display: {
    alignItems: 'center',
    gap: spacing.space4,
    marginTop: spacing.space6,
    marginBottom: spacing.space6,
  },
  time: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 64,
    lineHeight: 76,
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  ampmRow: { flexDirection: 'row', gap: spacing.space2 },
  ampm: {
    width: 44,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  ampmOn: { backgroundColor: colors.markCore, borderColor: colors.markCore },
  ampmText: { ...text.caption, color: colors.inkMuted },
  ampmTextOn: { fontFamily: fontFamily.textSemiBold, color: colors.ink },
  wheels: {
    height: ROW * VISIBLE_ROWS,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  band: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: ROW * Math.floor(VISIBLE_ROWS / 2),
    height: ROW,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  wheel: { width: 96, height: ROW * VISIBLE_ROWS, flexGrow: 0 },
  colon: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 24,
    color: colors.ink,
    marginHorizontal: spacing.space3,
  },
  row: { height: ROW, alignItems: 'center', justifyContent: 'center' },
  repeatRow: {
    marginTop: spacing.space6,
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.space3,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  repeatLabel: { ...text.bodyStrong, color: colors.ink },
  repeatValueWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.space1, flexShrink: 1 },
  repeatValue: { ...text.body, color: colors.inkMuted, flexShrink: 1 },
  repeatIcon: { width: 16, height: 16, tintColor: colors.inkMuted },
  rowText: {
    fontFamily: fontFamily.textRegular,
    fontSize: 22,
    color: colors.inkFaint,
    fontVariant: ['tabular-nums'],
  },
  rowTextOn: { fontFamily: fontFamily.textSemiBold, fontSize: 24, color: colors.ink },
});
