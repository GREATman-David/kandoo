import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  updateReminder,
  type CreatedReminder,
} from '@/services/interpretationService';
import {
  cancelReminder,
  rescheduleReminder,
  scheduleReminder,
} from '@/services/localNotifications';
import { colors, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';

import { TimeEntry } from './TimeEntry';

export type ReminderDetailProps = {
  reminder: CreatedReminder | null;
  visible: boolean;
  onClose: () => void;
  /** Refetch the list after any change. */
  onChanged: () => void;
  onOpenNote: (captureId: string) => void;
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
  const [current, setCurrent] = useState<CreatedReminder | null>(reminder);
  const [editing, setEditing] = useState(false);
  const [taskDraft, setTaskDraft] = useState('');
  const [personDraft, setPersonDraft] = useState('');
  const [timeOpen, setTimeOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setCurrent(reminder);
      setEditing(false);
      setError(null);
    }
  }, [visible, reminder]);

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
      console.error('Reminder update failed:', caught);
      setError(
        caught instanceof Error ? caught.message : 'Could not update that.'
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

  const snooze = async (iso: string) => {
    setSnoozeOpen(false);
    await apply({ dueAt: iso, status: 'confirmed' }, (u) => rescheduleReminder(u));
  };

  const setTime = async (iso: string) => {
    setTimeOpen(false);
    await apply({ dueAt: iso }, (u) => rescheduleReminder(u));
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

  const when = formatDueDate(r.due_at) ?? r.place_hint ?? 'No time set';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          {!editing ? (
            <Pressable onPress={startEdit} hitSlop={12}>
              <Text style={styles.edit}>Edit</Text>
            </Pressable>
          ) : (
            <Pressable onPress={saveEdit} hitSlop={12} disabled={busy}>
              <Text style={styles.edit}>{busy ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {editing ? (
            <TextInput
              style={styles.taskInput}
              value={taskDraft}
              onChangeText={setTaskDraft}
              placeholder="What to do"
              placeholderTextColor={colors.inkFaint}
              multiline
            />
          ) : (
            <Text style={styles.task}>{r.task}</Text>
          )}

          <Pressable style={styles.timePill} onPress={() => setTimeOpen(true)}>
            <Text style={styles.timeText}>{when}</Text>
          </Pressable>

          {editing ? (
            <TextInput
              style={styles.personInput}
              value={personDraft}
              onChangeText={setPersonDraft}
              placeholder="Person (optional)"
              placeholderTextColor={colors.inkFaint}
            />
          ) : r.person ? (
            <View style={styles.chip}>
              <Text style={styles.chipText}>{r.person}</Text>
            </View>
          ) : null}

          {!editing && r.capture_id ? (
            <Pressable
              style={styles.source}
              onPress={() => onOpenNote(r.capture_id as string)}
            >
              <Text style={styles.sourceText}>Open the note it came from ›</Text>
            </Pressable>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>

        {!editing ? (
          <View style={styles.actions}>
            {r.status === 'pending' ? (
              <Pressable
                style={[styles.btnPrimary, busy && styles.dim]}
                onPress={confirm}
                disabled={busy}
              >
                <Text style={styles.btnPrimaryText}>Confirm</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  style={styles.btn}
                  onPress={() => setSnoozeOpen(true)}
                  disabled={busy}
                >
                  <Text style={styles.btnText}>Snooze</Text>
                </Pressable>
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
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space4 },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.space7,
    paddingBottom: spacing.space2,
  },
  back: { ...text.body, color: colors.inkMuted },
  edit: { ...text.bodyStrong, color: colors.accent },
  body: { paddingTop: spacing.space4, paddingBottom: spacing.space6 },
  task: { ...text.displayL, color: colors.ink, marginBottom: spacing.space4 },
  taskInput: {
    ...text.displayL,
    color: colors.ink,
    marginBottom: spacing.space4,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space2,
  },
  timePill: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: spacing.space2,
    paddingHorizontal: spacing.space3,
    marginBottom: spacing.space4,
  },
  timeText: { ...text.bodyStrong, color: colors.ink },
  personInput: {
    ...text.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space2,
    marginBottom: spacing.space4,
  },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginBottom: spacing.space4,
  },
  chipText: { ...text.caption, color: colors.inkMuted },
  source: {
    marginTop: spacing.space4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.space4,
  },
  sourceText: { ...text.body, color: colors.inkMuted },
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
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: { ...text.bodyStrong, color: colors.inkMuted },
  btnPrimary: {
    flex: 2,
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
