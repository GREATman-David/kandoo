import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MemoryCard, type MemoryCardChip } from '@/components/MemoryCard';
import { MemoryDetail, type MemoryDetailTarget } from '@/components/MemoryDetail';
import { ReminderDetail } from '@/components/ReminderDetail';
import { router } from 'expo-router';

import {
  confirmReminder,
  fetchCaptureNote,
  fetchPlaces,
  logFailure,
  type CaptureNote,
  type CreatedMemory,
  type CreatedReminder,
  type InterpretResult,
} from '@/services/interpretationService';
import { scheduleReminder } from '@/services/localNotifications';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';
import { formatDueDate, formatPlaceWhen } from '@/utils/formatDueDate';

export type ReviewSheetProps = {
  visible: boolean;
  summary: string | null;
  confidence: 'high' | 'low';
  results: InterpretResult[];
  /** The verbatim capture, for the "nothing actionable" fallback. */
  rawText: string;
  /** The capture these results came from — reloaded after an edit or removal. */
  captureId: string;
  onClose: () => void;
  /** The results after an edit, removal or confirm, so Home stays in step. */
  onResultsChanged: (results: InterpretResult[]) => void;
  /** Everything was kept: Home moves on to its Complete screen. */
  onKeptAll: () => void;
};

const CONFIRM_STAGGER_MS = 90;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The capture's CURRENT reminders and memories, as results. A reminder the
 * user chose not to keep (dismissed/cancelled) or a deleted memory drops out;
 * recall answers and failed items from the original response are kept as-is.
 */
function resultsFromCapture(
  capture: CaptureNote,
  previous: InterpretResult[]
): InterpretResult[] {
  const reminders: InterpretResult[] = capture.reminders
    .filter((r) => r.status === 'pending' || r.status === 'confirmed')
    .map((r) => ({
      kind: 'reminder' as const,
      status: 'ok' as const,
      reminder: {
        id: r.id,
        task: r.task,
        person: r.person,
        due_at: r.due_at,
        place_hint: r.place_hint,
        place_id: null,
        insistent: false,
        status: r.status,
        created_at: r.created_at,
        capture_id: capture.id,
      },
    }));
  const memories: InterpretResult[] = capture.memories.map((m) => ({
    kind: 'memory' as const,
    status: 'ok' as const,
    memory: {
      id: m.id,
      content: m.content,
      person: m.person,
      location: m.location,
      topics: m.topics,
      created_at: m.created_at,
    },
  }));
  const kept = previous.filter((r) => r.kind === 'recall' || r.status === 'failed');
  return [...reminders, ...memories, ...kept];
}

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
  const place = formatPlaceWhen(reminder);
  if (place) chips.push({ label: place });
  else if (reminder.place_hint) chips.push({ label: reminder.place_hint });
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
  captureId,
  onClose,
  onResultsChanged,
  onKeptAll,
}: ReviewSheetProps) {
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [failedConfirmIds, setFailedConfirmIds] = useState<Set<string>>(new Set());
  const [keeping, setKeeping] = useState(false);
  // The sheet works on its own copy so an edit or removal shows at once; each
  // change is reloaded from the server and handed back to Home.
  const [items, setItems] = useState<InterpretResult[]>(results);
  const [editingReminder, setEditingReminder] = useState<CreatedReminder | null>(null);
  const [editingMemory, setEditingMemory] = useState<MemoryDetailTarget | null>(null);

  useEffect(() => {
    if (visible) setItems(results);
  }, [visible, results]);

  // Place reminders whose place has never been drawn can't fire yet: offer to
  // draw it right from the card ("Where is school?").
  const [drawnPlaceIds, setDrawnPlaceIds] = useState<Set<string> | null>(null);
  const hasPlaceReminder = results.some(
    (r) => r.kind === 'reminder' && r.status === 'ok' && !r.reminder.due_at && !!r.reminder.place_id
  );
  useEffect(() => {
    if (!visible || !hasPlaceReminder) return;
    let active = true;
    fetchPlaces()
      .then((places) => {
        if (active) setDrawnPlaceIds(new Set(places.filter((p) => p.center).map((p) => p.id)));
      })
      .catch((error) => logFailure('Loading places for review failed:', error));
    return () => {
      active = false;
    };
  }, [visible, hasPlaceReminder]);

  const drawPlace = (name: string) => {
    onClose();
    // Cast: typed routes regenerate only when Metro runs.
    router.navigate({ pathname: '/places' as never, params: { draw: name } });
  };

  async function reload() {
    try {
      const capture = await fetchCaptureNote(captureId);
      if (!capture) return;
      const next = resultsFromCapture(capture, items);
      setItems(next);
      onResultsChanged(next);
    } catch (error) {
      console.error('Reloading the reviewed capture failed:', error);
    }
  }

  const okReminders = items.filter(
    (r): r is OkReminder => r.kind === 'reminder' && r.status === 'ok'
  );
  const okMemories = items.filter(
    (r): r is OkMemory => r.kind === 'memory' && r.status === 'ok'
  );
  const okRecalls = items.filter(
    (r): r is OkRecall => r.kind === 'recall' && r.status === 'ok'
  );
  const failedCount = items.filter((r) => r.status === 'failed').length;

  const totalConfirmable = okReminders.length + okMemories.length;
  const hasNothingActionable = totalConfirmable === 0 && okRecalls.length === 0;

  /** Returns false when a reminder could not be confirmed. */
  async function confirmOne(kind: 'reminder' | 'memory', id: string): Promise<boolean> {
    setConfirmedIds((prev) => new Set(prev).add(id));

    if (kind !== 'reminder') return true;

    try {
      const confirmed = await confirmReminder(id);
      // The device owns the trigger (§3.2): a reminder kept here must be
      // scheduled here, exactly as Remember does. Best-effort — the confirm is
      // committed, and launch reconcile retries a failed schedule.
      try {
        await scheduleReminder(confirmed);
      } catch (error) {
        console.error(`Scheduling reminder ${id} failed:`, error);
      }
      const next = items.map((r) =>
        r.kind === 'reminder' && r.status === 'ok' && r.reminder.id === id
          ? { ...r, reminder: { ...r.reminder, status: confirmed.status } }
          : r
      );
      setItems(next);
      onResultsChanged(next);
      return true;
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
      return false;
    }
  }

  /** Confirm every card in a quick cascade; when all hold, move Home on. */
  async function confirmAll() {
    if (keeping) return;
    setKeeping(true);
    const queue: Array<{ kind: 'reminder' | 'memory'; id: string }> = [
      ...okReminders
        .filter((r) => r.reminder.status !== 'confirmed')
        .map((r) => ({ kind: 'reminder' as const, id: r.reminder.id })),
      ...okMemories.map((m) => ({ kind: 'memory' as const, id: m.memory.id })),
    ];

    let allKept = true;
    for (const [index, item] of queue.entries()) {
      if (index > 0) await wait(CONFIRM_STAGGER_MS);
      if (!(await confirmOne(item.kind, item.id))) allKept = false;
    }
    setKeeping(false);

    if (allKept) {
      // Let the last card's settle animation land before the sheet leaves.
      await wait(450);
      onKeptAll();
    }
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
                      const isConfirmed =
                        confirmedIds.has(id) || item.reminder.status === 'confirmed';
                      const guessedTime = confidence === 'low' && !!item.reminder.due_at;
                      const placeName =
                        !item.reminder.due_at && item.reminder.place_id ? item.reminder.place_hint : null;
                      const undrawn =
                        !!placeName && drawnPlaceIds !== null && !drawnPlaceIds.has(item.reminder.place_id!);
                      return (
                        <View key={id}>
                        <MemoryCard
                          state={isConfirmed ? 'confirmed' : 'pending'}
                          label={
                            isConfirmed
                              ? placeName
                                ? `Waiting at ${placeName}`
                                : 'Scheduled'
                              : guessedTime
                                ? 'Check the time'
                                : 'Needs review'
                          }
                          content={item.reminder.task}
                          chips={buildReminderChips(item.reminder, guessedTime)}
                          onConfirm={
                            isConfirmed ? undefined : () => void confirmOne('reminder', id)
                          }
                          onEdit={
                            isConfirmed
                              ? undefined
                              : () =>
                                  // No "open the note" link: we are in its review.
                                  setEditingReminder({ ...item.reminder, capture_id: null })
                          }
                        />
                        {undrawn && placeName ? (
                          <Pressable
                            style={styles.placeLink}
                            onPress={() => drawPlace(placeName)}
                            accessibilityRole="button"
                          >
                            <Text style={styles.placeLinkText}>
                              Where is {placeName}? <Text style={styles.placeLinkAction}>Draw it</Text>
                            </Text>
                          </Pressable>
                        ) : null}
                        </View>
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
                            isConfirmed ? undefined : () => void confirmOne('memory', id)
                          }
                          onEdit={
                            isConfirmed
                              ? undefined
                              : () =>
                                  setEditingMemory({
                                    id,
                                    content: item.memory.content,
                                    captureId: null,
                                    sourceTitle: null,
                                    isManual: false,
                                  })
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
              <Pressable
                style={[styles.btnPrimary, keeping && styles.btnDisabled]}
                onPress={() => void confirmAll()}
                disabled={keeping}
              >
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

      <ReminderDetail
        reminder={editingReminder}
        visible={editingReminder !== null}
        onClose={() => setEditingReminder(null)}
        onChanged={() => void reload()}
        onOpenNote={() => {}}
      />

      <MemoryDetail
        memory={editingMemory}
        visible={editingMemory !== null}
        onClose={() => setEditingMemory(null)}
        onChanged={() => void reload()}
      />
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
  placeLink: {
    marginTop: -spacing.space1,
    marginBottom: spacing.space3,
    paddingHorizontal: spacing.space2,
  },
  placeLinkText: { ...text.caption, color: colors.inkMuted },
  placeLinkAction: { ...text.caption, fontFamily: text.bodyStrong.fontFamily, color: colors.accent },
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
  btnDisabled: {
    opacity: 0.6,
  },
});
