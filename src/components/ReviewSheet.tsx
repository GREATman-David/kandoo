import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MemoryCard, type MemoryCardChip } from '@/components/MemoryCard';
import {
  confirmReminder,
  type CreatedMemory,
  type CreatedReminder,
  type InterpretResult,
} from '@/services/interpretationService';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';

export type ReviewSheetProps = {
  visible: boolean;
  summary: string | null;
  confidence: 'high' | 'low';
  results: InterpretResult[];
  /** The verbatim capture, for the "nothing actionable" fallback. */
  rawText: string;
  onClose: () => void;
};

const CONFIRM_STAGGER_MS = 90;

type OkReminder = Extract<InterpretResult, { kind: 'reminder'; status: 'ok' }>;
type OkMemory = Extract<InterpretResult, { kind: 'memory'; status: 'ok' }>;
type OkRecall = Extract<InterpretResult, { kind: 'recall'; status: 'ok' }>;

function buildReminderChips(
  reminder: CreatedReminder,
  guessedTime: boolean
): MemoryCardChip[] {
  const chips: MemoryCardChip[] = [];
  const due = formatDueDate(reminder.due_at);
  if (due) chips.push({ label: due, guessed: guessedTime });
  if (reminder.person) chips.push({ label: reminder.person });
  if (reminder.place_hint) chips.push({ label: reminder.place_hint });
  return capChips(chips);
}

function buildMemoryChips(memory: CreatedMemory): MemoryCardChip[] {
  const chips: MemoryCardChip[] = [];
  if (memory.person) chips.push({ label: memory.person });
  if (memory.location) chips.push({ label: memory.location });
  for (const topic of memory.topics) chips.push({ label: topic });
  return capChips(chips);
}

/** "Maximum four; overflow collapses to '+2'." */
function capChips(chips: MemoryCardChip[]): MemoryCardChip[] {
  if (chips.length <= 4) return chips;
  const shown = chips.slice(0, 3);
  shown.push({ label: `+${chips.length - 3}` });
  return shown;
}

export function ReviewSheet({
  visible,
  summary,
  confidence,
  results,
  rawText,
  onClose,
}: ReviewSheetProps) {
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [failedConfirmIds, setFailedConfirmIds] = useState<Set<string>>(new Set());

  const okReminders = results.filter(
    (r): r is OkReminder => r.kind === 'reminder' && r.status === 'ok'
  );
  const okMemories = results.filter(
    (r): r is OkMemory => r.kind === 'memory' && r.status === 'ok'
  );
  const okRecalls = results.filter(
    (r): r is OkRecall => r.kind === 'recall' && r.status === 'ok'
  );
  const failedCount = results.filter((r) => r.status === 'failed').length;

  const totalConfirmable = okReminders.length + okMemories.length;
  const hasNothingActionable = totalConfirmable === 0 && okRecalls.length === 0;

  async function confirmOne(kind: 'reminder' | 'memory', id: string) {
    setConfirmedIds((prev) => new Set(prev).add(id));

    if (kind !== 'reminder') return;

    try {
      await confirmReminder(id);
    } catch (error) {
      // Swallowing this is what made the confirm failure impossible to
      // diagnose: the retry line below says something went wrong, and this
      // says what.
      console.error(`Confirm reminder ${id} failed:`, error);
      // The reminder stays pending server-side; reflect that back in the UI.
      setConfirmedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setFailedConfirmIds((prev) => new Set(prev).add(id));
    }
  }

  function confirmAll() {
    const items: Array<{ kind: 'reminder' | 'memory'; id: string }> = [
      ...okReminders.map((r) => ({ kind: 'reminder' as const, id: r.reminder.id })),
      ...okMemories.map((m) => ({ kind: 'memory' as const, id: m.memory.id })),
    ];

    items.forEach((item, index) => {
      setTimeout(() => {
        confirmOne(item.kind, item.id);
      }, index * CONFIRM_STAGGER_MS);
    });
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.grabber} />

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.eyebrow}>From what you said</Text>

            {hasNothingActionable ? (
              <>
                <Text style={styles.summary}>Saved what you said</Text>
                <Text style={styles.rawText}>{rawText}</Text>
              </>
            ) : (
              <>
                <Text style={styles.summary}>
                  {summary ?? "Here's what Kandoo caught."}
                </Text>

                {okReminders.length > 0 ? (
                  <>
                    <Text style={styles.groupHeading}>
                      {okReminders.length} reminder
                      {okReminders.length === 1 ? '' : 's'}
                    </Text>
                    {okReminders.map((item) => {
                      const id = item.reminder.id;
                      const isConfirmed = confirmedIds.has(id);
                      const guessedTime = confidence === 'low' && !!item.reminder.due_at;
                      return (
                        <MemoryCard
                          key={id}
                          state={isConfirmed ? 'confirmed' : 'pending'}
                          label={
                            isConfirmed
                              ? 'Scheduled'
                              : guessedTime
                                ? 'Check the time'
                                : 'Needs review'
                          }
                          content={item.reminder.task}
                          chips={buildReminderChips(item.reminder, guessedTime)}
                          onConfirm={
                            isConfirmed ? undefined : () => confirmOne('reminder', id)
                          }
                        />
                      );
                    })}
                  </>
                ) : null}

                {okMemories.length > 0 ? (
                  <>
                    <Text style={styles.groupHeading}>
                      {okMemories.length} memor
                      {okMemories.length === 1 ? 'y' : 'ies'}
                    </Text>
                    {okMemories.map((item) => {
                      const id = item.memory.id;
                      const isConfirmed = confirmedIds.has(id);
                      return (
                        <MemoryCard
                          key={id}
                          state={isConfirmed ? 'confirmed' : 'pending'}
                          label={isConfirmed ? 'Saved' : 'Needs review'}
                          content={item.memory.content}
                          chips={buildMemoryChips(item.memory)}
                          onConfirm={
                            isConfirmed ? undefined : () => confirmOne('memory', id)
                          }
                        />
                      );
                    })}
                  </>
                ) : null}

                {okRecalls.map((item, index) => (
                  <View key={index} style={styles.recall}>
                    <Text style={styles.groupHeading}>Answer</Text>
                    <Text style={styles.recallText}>{item.answer}</Text>
                  </View>
                ))}

                {failedConfirmIds.size > 0 ? (
                  <Text style={styles.note}>
                    Couldn't confirm {failedConfirmIds.size === 1 ? 'one item' : `${failedConfirmIds.size} items`}. Try again in a moment.
                  </Text>
                ) : null}

                {failedCount > 0 ? (
                  <Text style={styles.note}>
                    {failedCount === 1
                      ? "One more thing didn't save."
                      : `${failedCount} more things didn't save.`}
                  </Text>
                ) : null}
              </>
            )}
          </ScrollView>

          <View style={styles.actionBar}>
            <Pressable style={styles.btn} onPress={onClose}>
              <Text style={styles.btnText}>Not now</Text>
            </Pressable>
            {totalConfirmable > 0 ? (
              <Pressable style={styles.btnPrimary} onPress={confirmAll}>
                <Text style={styles.btnPrimaryText}>Keep all</Text>
              </Pressable>
            ) : (
              <Pressable style={styles.btnPrimary} onPress={onClose}>
                <Text style={styles.btnPrimaryText}>Done</Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withOpacity(colors.base, 0.6),
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.space3,
    paddingHorizontal: spacing.space4,
    paddingBottom: spacing.space6,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: radius.full,
    backgroundColor: colors.line,
    marginBottom: spacing.space5,
  },
  scrollContent: {
    paddingBottom: spacing.space4,
  },
  eyebrow: {
    ...text.label,
    color: colors.inkMuted,
    marginBottom: spacing.space2,
  },
  summary: {
    ...text.displayL,
    color: colors.ink,
    marginBottom: spacing.space5,
  },
  rawText: {
    ...text.memory,
    color: colors.ink,
  },
  groupHeading: {
    ...text.label,
    color: colors.inkMuted,
    marginTop: spacing.space5,
    marginBottom: spacing.space3,
  },
  recall: {
    marginTop: spacing.space2,
  },
  recallText: {
    ...text.bodyL,
    color: colors.ink,
  },
  note: {
    ...text.caption,
    color: colors.inkMuted,
    marginTop: spacing.space4,
  },
  actionBar: {
    flexDirection: 'row',
    gap: spacing.space2,
    marginTop: spacing.space6,
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
  btnText: {
    ...text.bodyStrong,
    color: colors.inkMuted,
  },
  btnPrimary: {
    flex: 2,
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: {
    ...text.bodyStrong,
    color: colors.ink,
  },
});
