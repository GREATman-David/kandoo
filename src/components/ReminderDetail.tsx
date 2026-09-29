import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchCaptureNote,
  updateReminder,
  type CreatedReminder,
  userMessage,
  logFailure,
} from '@/services/interpretationService';
import {
  cancelReminder,
  rescheduleReminder,
  scheduleReminder,
} from '@/services/localNotifications';
import { colors, radius, spacing, text } from '@/theme/theme';
import { formatDueDate, formatPlaceWhen } from '@/utils/formatDueDate';
import { isRepeating, repeatWhen } from '@/utils/repeat';
import { timeAgo } from '@/utils/timeAgo';

import { TimeEntry } from './TimeEntry';

export type ReminderDetailProps = {
  reminder: CreatedReminder | null;
  visible: boolean;
  onClose: () => void;
  /** Refetch the list after any change. */
  onChanged: () => void;
  onOpenNote: (captureId: string) => void;
};

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  edit: require('@/assets/images/icons/pencil.png'),
  person: require('@/assets/images/icons/chip-person.png'),
  open: require('@/assets/images/icons/chevron-right.png'),
};

const SNOOZE = [
  { label: '15 minutes', ms: 15 * 60 * 1000 },
  { label: '1 hour', ms: 60 * 60 * 1000 },
  { label: 'Tomorrow morning', ms: null },
] as const;

function tomorrowMorning(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

export function ReminderDetail({
  reminder,
  visible,
  onClose,
  onChanged,
  onOpenNote,
}: ReminderDetailProps) {
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState<CreatedReminder | null>(reminder);
  const [editing, setEditing] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [personDraft, setPersonDraft] = useState('');
  const [timeOpen, setTimeOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The note the reminder came from, for the "From <note> · <when>" line.
  // Best-effort: without it the line reads "From what you said".
  const [sourceTitle, setSourceTitle] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCurrent(reminder);
      setEditing(false);
      setError(null);
    }
  }, [visible, reminder]);

  useEffect(() => {
    setSourceTitle(null);
    const captureId = reminder?.capture_id;
    if (!visible || !captureId) return;
    let active = true;
    fetchCaptureNote(captureId)
      .then((capture) => {
        if (active) setSourceTitle(capture?.note?.title ?? null);
      })
      .catch((caught) => logFailure('Loading reminder source failed:', caught));
    return () => {
      active = false;
    };
  }, [visible, reminder?.capture_id]);

  if (!current) return null;
  const r = current;

  // Every server change is followed by a matching notification op — the device
  // owns the schedule (§3.2). Confirmed+future → (re)schedule; done/deleted →
  // cancel.
  async function apply(
    patch: Parameters<typeof updateReminder>[1],
    notify: (updated: CreatedReminder) => Promise<unknown>
  ) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await updateReminder(r.id, patch);
      await notify(updated);
      setCurrent(updated);
      onChanged();
      return updated;
    } catch (caught) {
      logFailure('Reminder update failed:', caught);
      setError(
        userMessage(caught, 'Could not update that.')
      );
      return null;
    } finally {
      setBusy(false);
    }
  }

  const markDone = async () => {
    const done = await apply({ status: 'fired' }, () => cancelReminder(r.id));
    if (done) onClose();
  };

  const confirm = () =>
    apply({ status: 'confirmed' }, (u) => scheduleReminder(u));

  // A pending reminder Kandoo proposed but the user doesn't want: dismissed,
  // never scheduled. It leaves Needs review and the review sheet.
  const dontKeep = async () => {
    const done = await apply({ status: 'dismissed' }, () => cancelReminder(r.id));
    if (done) onClose();
  };

  const snooze = async (iso: string) => {
    setSnoozeOpen(false);
    await apply({ dueAt: iso, status: 'confirmed' }, (u) => rescheduleReminder(u));
  };

  const setTime = async (iso: string, days: number[] | null) => {
    setTimeOpen(false);
    // Send repeat only when it is set or being cleared, so editing the time of
    // a one-off reminder sends exactly what it always did.
    const repeatChanged = isRepeating(r.repeat_days) || !!days;
    await apply(
      repeatChanged ? { dueAt: iso, repeatDays: days } : { dueAt: iso },
      (u) => rescheduleReminder(u)
    );
  };

  const startEdit = () => {
    setTaskDraft(r.task);
    setPersonDraft(r.person ?? '');
    setEditing(true);
  };

  const saveEdit = async () => {
    const done = await apply(
      { task: taskDraft, person: personDraft.trim() || null },
      (u) => rescheduleReminder(u)
    );
    if (done) setEditing(false);
  };

  const when =
    r.due_at && isRepeating(r.repeat_days)
      ? repeatWhen(r.due_at, r.repeat_days)
      : (formatDueDate(r.due_at) ?? formatPlaceWhen(r) ?? 'No time set');
  const sourceLine = r.capture_id
    ? ['From ' + (sourceTitle ?? 'what you said'), timeAgo(r.created_at)].join(' · ')
    : ['Added by you', timeAgo(r.created_at)].join(' · ');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={[styles.bar, { marginTop: insets.top + spacing.space4 }]}>
          <Pressable
            style={styles.barBtn}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Image source={ICONS.back} style={styles.barIcon} />
          </Pressable>
          {!editing ? (
            <Pressable
              style={[styles.barBtn, styles.barBtnEnd]}
              onPress={startEdit}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Edit reminder"
            >
              <Image source={ICONS.edit} style={styles.barIcon} />
            </Pressable>
          ) : (
            <Pressable onPress={saveEdit} hitSlop={12} disabled={busy}>
              <Text style={styles.save}>{busy ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            {editing ? (
              <TextInput
                style={styles.taskInput}
                value={taskDraft}
                onChangeText={setTaskDraft}
                placeholder="What to do"
                placeholderTextColor={colors.inkFaint}
                underlineColorAndroid="transparent"
                multiline
              />
            ) : (
              <Text style={styles.task}>{r.task}</Text>
            )}

            {/* Tap the time to change it (Time entry). */}
            <Pressable
              onPress={() => setTimeOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityHint="Change the time"
            >
              <Text style={styles.when}>{when}</Text>
            </Pressable>

            {editing ? (
              <TextInput
                style={styles.personInput}
                value={personDraft}
                onChangeText={setPersonDraft}
                placeholder="Person (optional)"
                placeholderTextColor={colors.inkFaint}
                underlineColorAndroid="transparent"
              />
            ) : r.person ? (
              <View style={styles.chip}>
                <Image source={ICONS.person} style={styles.chipIcon} />
                <Text style={styles.chipText} numberOfLines={1}>
                  {r.person}
                </Text>
              </View>
            ) : null}

            {!editing ? (
              <>
                <View style={styles.divider} />
                <Pressable
                  style={styles.sourceRow}
                  onPress={() => r.capture_id && onOpenNote(r.capture_id)}
                  disabled={!r.capture_id}
                  hitSlop={6}
                  accessibilityRole={r.capture_id ? 'link' : undefined}
                >
                  <Text style={styles.sourceText} numberOfLines={1}>
                    {sourceLine}
                  </Text>
                  {r.capture_id ? <Image source={ICONS.open} style={styles.openIcon} /> : null}
                </Pressable>
              </>
            ) : null}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {!editing ? (
          <View style={styles.actions}>
            {r.status === 'pending' ? (
              <>
                <Pressable style={styles.btn} onPress={dontKeep} disabled={busy}>
                  <Text style={styles.btnText}>Don’t keep</Text>
                </Pressable>
                <Pressable
                  style={[styles.btnPrimary, busy && styles.dim]}
                  onPress={confirm}
                  disabled={busy}
                >
                  <Text style={styles.btnPrimaryText}>Confirm</Text>
                </Pressable>
              </>
            ) : (
              <>
                {/* Snooze moves due_at, which for a repeating reminder is the
                    time of every repeat — so it is offered for one-offs only. */}
                {isRepeating(r.repeat_days) ? null : (
                  <Pressable
                    style={styles.btn}
                    onPress={() => setSnoozeOpen(true)}
                    disabled={busy}
                  >
                    <Text style={styles.btnText}>Snooze</Text>
                  </Pressable>
                )}
                <Pressable
                  style={[styles.btnPrimary, busy && styles.dim]}
                  onPress={markDone}
                  disabled={busy}
                >
                  <Text style={styles.btnPrimaryText}>Done</Text>
                </Pressable>
              </>
            )}
          </View>
        ) : null}
      </View>

      <TimeEntry
        visible={timeOpen}
        initialISO={r.due_at}
        allowRepeat
        repeatDays={r.repeat_days ?? null}
        onClose={() => setTimeOpen(false)}
        onSave={setTime}
      />

      <Modal visible={snoozeOpen} animationType="slide" transparent onRequestClose={() => setSnoozeOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSnoozeOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.eyebrow}>Snooze until</Text>
            {SNOOZE.map((s) => (
              <Pressable
                key={s.label}
                style={styles.sheetRow}
                onPress={() => snooze(s.ms === null ? tomorrowMorning() : new Date(Date.now() + s.ms).toISOString())}
              >
                <Text style={styles.sheetRowText}>{s.label}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Reminder detail (Figma: kandoo-reminder-detail).
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  barBtn: { width: 40, height: 40, justifyContent: 'center' },
  barBtnEnd: { alignItems: 'flex-end' },
  barIcon: { width: 20, height: 20, tintColor: colors.ink },
  save: { ...text.bodyStrong, color: colors.markRing },
  body: { paddingTop: spacing.space5, paddingBottom: spacing.space6 },
  card: {
    gap: 20,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  task: { ...text.displayL, letterSpacing: 0, color: colors.ink },
  taskInput: {
    ...text.displayL,
    letterSpacing: 0,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space2,
  },
  when: { ...text.body, fontSize: 14, color: colors.inkMuted },
  personInput: {
    ...text.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space2,
  },
  chip: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentWash,
  },
  chipIcon: { width: 12, height: 12, tintColor: colors.markRing },
  chipText: { ...text.caption, flexShrink: 1, color: colors.markRing },
  divider: { height: 1, backgroundColor: colors.line },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.space2,
  },
  sourceText: { ...text.caption, color: colors.inkMuted, flex: 1 },
  openIcon: { width: 16, height: 16, tintColor: colors.inkMuted },
  error: { ...text.caption, color: colors.alarmText, marginTop: spacing.space4 },
  actions: {
    flexDirection: 'row',
    gap: spacing.space2,
    paddingVertical: spacing.space5,
  },
  btn: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { ...text.bodyStrong, color: colors.inkMuted },
  btnPrimary: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { ...text.bodyStrong, color: colors.ink },
  dim: { opacity: 0.6 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(26,10,14,0.35)',
  },
  sheet: {
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.space5,
    paddingHorizontal: spacing.space4,
    paddingBottom: spacing.space7,
  },
  eyebrow: { ...text.label, color: colors.inkMuted, marginBottom: spacing.space3 },
  sheetRow: { paddingVertical: spacing.space4 },
  sheetRowText: { ...text.body, color: colors.ink },
});
