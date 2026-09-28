import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  createManualReminder,
  userMessage,
  logFailure,
} from '@/services/interpretationService';
import { scheduleReminder } from '@/services/localNotifications';
import { colors, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';

import { TimeEntry } from './TimeEntry';

export type ManualReminderProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
};

/** A reminder the user types by hand. Created `confirmed` and scheduled at once. */
export function ManualReminder({ visible, onClose, onCreated }: ManualReminderProps) {
  const [task, setTask] = useState('');
  const [person, setPerson] = useState('');
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [timeOpen, setTimeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTask('');
      setPerson('');
      setDueAt(null);
      setError(null);
    }
  }, [visible]);

  const canCreate = task.trim().length > 0 && !!dueAt && !busy;

  async function create() {
    if (!canCreate || !dueAt) return;
    setBusy(true);
    setError(null);
    try {
      const reminder = await createManualReminder({
        task: task.trim(),
        dueAt,
        person: person.trim() || null,
      });
      await scheduleReminder(reminder);
      onCreated();
      onClose();
    } catch (caught) {
      logFailure('Manual reminder failed:', caught);
      setError(
        userMessage(caught, 'Could not create that.')
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>New reminder</Text>
          <Pressable onPress={create} hitSlop={12} disabled={!canCreate}>
            <Text style={[styles.create, !canCreate && styles.dim]}>
              {busy ? 'Saving…' : 'Create'}
            </Text>
          </Pressable>
        </View>

        <TextInput
          style={styles.taskInput}
          value={task}
          onChangeText={setTask}
          placeholder="Remind me to…"
          placeholderTextColor={colors.inkFaint}
          autoFocus
          multiline
        />

        <Pressable style={styles.timePill} onPress={() => setTimeOpen(true)}>
          <Text style={dueAt ? styles.timeSet : styles.timePlaceholder}>
            {dueAt ? formatDueDate(dueAt) : 'Set a time'}
          </Text>
        </Pressable>

        <TextInput
          style={styles.personInput}
          value={person}
          onChangeText={setPerson}
          placeholder="Person (optional)"
          placeholderTextColor={colors.inkFaint}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <TimeEntry
        visible={timeOpen}
        initialISO={dueAt}
        saveLabel="Set"
        onClose={() => setTimeOpen(false)}
        onSave={(iso) => {
          setDueAt(iso);
          setTimeOpen(false);
        }}
      />
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
    paddingBottom: spacing.space5,
  },
  cancel: { ...text.body, color: colors.inkMuted },
  title: { ...text.bodyStrong, color: colors.ink },
  create: { ...text.bodyStrong, color: colors.accent },
  dim: { color: colors.inkFaint },
  taskInput: {
    ...text.answer,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space3,
    marginBottom: spacing.space5,
  },
  timePill: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: spacing.space2,
    paddingHorizontal: spacing.space3,
    marginBottom: spacing.space5,
  },
  timeSet: { ...text.bodyStrong, color: colors.ink },
  timePlaceholder: { ...text.bodyStrong, color: colors.inkFaint },
  personInput: {
    ...text.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: spacing.space3,
    paddingVertical: spacing.space3,
  },
  error: { ...text.caption, color: colors.alarmText, marginTop: spacing.space4 },
});
