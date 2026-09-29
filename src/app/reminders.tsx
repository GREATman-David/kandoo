import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { EmptyState } from '@/components/EmptyState';
import { ManualEntry, type ManualEntryProps } from '@/components/ManualEntry';
import { OfflineNote } from '@/components/OfflineNote';
import { ManualReminder } from '@/components/ManualReminder';
import { NoteDetail } from '@/components/NoteDetail';
import { ReminderDetail } from '@/components/ReminderDetail';
import {
  type CaptureNote,
  deleteReminderById,
  fetchCaptureNote,
  fetchGroupedReminders,
  updateReminder,
  type CreatedReminder,
  type GroupedReminders,
  userMessage,
  logFailure,
} from '@/services/interpretationService';
import { cancelReminder, scheduleReminder } from '@/services/localNotifications';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';

const ICONS = {
  // Figma puts a clock where "new reminder" lives.
  add: require('@/assets/images/icons/chip-time.png'),
  expand: require('@/assets/images/icons/chevron-down.png'),
  check: require('@/assets/images/icons/check.png'),
};
import { formatDueDate } from '@/utils/formatDueDate';
import { isRepeating, nextOccurrence, repeatWhen } from '@/utils/repeat';

import { useAuth } from '../features/Auth/useAuth';

const EMPTY: GroupedReminders = { needsReview: [], active: [], history: [] };

/**
 * When a reminder next happens, for sorting it into Overdue / Today / Upcoming.
 * A repeating reminder is never overdue: it is due at its next chosen day.
 */
function nextDue(r: CreatedReminder): number {
  if (!r.due_at) return NaN;
  return isRepeating(r.repeat_days)
    ? nextOccurrence(r.due_at, r.repeat_days).getTime()
    : Date.parse(r.due_at);
}

/** The time line under a reminder: "Every Mon, Wed · 7:00 AM" when it repeats. */
function whenLine(r: CreatedReminder): string | null {
  if (r.due_at && isRepeating(r.repeat_days)) return repeatWhen(r.due_at, r.repeat_days);
  return formatDueDate(r.due_at);
}

function endOfToday(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function RemindersScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();

  const [groups, setGroups] = useState<GroupedReminders>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [selected, setSelected] = useState<CreatedReminder | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);

  // ?open=<id> — set when a reminder notification is tapped (NotificationRouter).
  const { open } = useLocalSearchParams<{ open?: string }>();
  const router = useRouter();

  const [undo, setUndo] = useState<CreatedReminder | null>(null);
  // Long-press menu. `capture` is what the reminder came from, fetched when
  // the menu opens, so it can offer to add a note or memory it lacks.
  const [menu, setMenu] = useState<{
    reminder: CreatedReminder;
    needsReview: boolean;
    capture: CaptureNote | null;
  } | null>(null);
  const [attach, setAttach] = useState<ManualEntryProps['attach']>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The in-flight "done" write, so an Undo can never land before it.
  const doneRequest = useRef<Promise<unknown> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setGroups(await fetchGroupedReminders());
    } catch (caught) {
      logFailure('Loading reminders failed:', caught);
      setError(userMessage(caught, 'Could not load reminders.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on focus, not just on mount, so a reminder captured or confirmed on
  // another tab shows here (and status changes reflect) without a relaunch.
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) load();
      else setLoading(false);
    }, [isAuthenticated, load])
  );

  useEffect(
    () => () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    },
    []
  );

  // Open the tapped notification's reminder once the list has it, then drop the
  // param so returning to this tab later doesn't reopen it.
  useEffect(() => {
    if (!open || loading) return;
    const all = [...groups.needsReview, ...groups.active, ...groups.history];
    const target = all.find((r) => r.id === open);
    if (target) setSelected(target);
    router.setParams({ open: undefined });
  }, [open, loading, groups, router]);

  // Tap the circle to complete. The reminder leaves the list at once and moves
  // to History; the server and the notification catch up behind, and a
  // Completed · Undo bar stays for five seconds in case it was a mistake.
  const markDone = async (reminder: CreatedReminder) => {
    setGroups((g) => ({
      ...g,
      active: g.active.filter((r) => r.id !== reminder.id),
      history: [{ ...reminder, status: 'fired' }, ...g.history],
    }));
    setUndo(reminder);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 5000);

    const request = (async () => {
      await updateReminder(reminder.id, { status: 'fired' });
      await cancelReminder(reminder.id);
    })();
    doneRequest.current = request;
    try {
      await request;
    } catch (caught) {
      logFailure('Mark done failed:', caught);
      setUndo((current) => (current?.id === reminder.id ? null : current));
      await load();
      Alert.alert('Couldn’t complete that', 'Please try again.');
    }
  };

  const undoDone = async () => {
    if (!undo) return;
    const reminder = undo;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    // Back into the list straight away, where it was.
    setGroups((g) => ({
      ...g,
      active: [...g.active, reminder],
      history: g.history.filter((r) => r.id !== reminder.id),
    }));
    try {
      await doneRequest.current?.catch(() => {});
      const restored = await updateReminder(reminder.id, { status: 'confirmed' });
      await scheduleReminder(restored);
    } catch (caught) {
      logFailure('Undo failed:', caught);
      Alert.alert('Couldn’t undo that', 'Please try again.');
    }
    await load();
  };

  const openMenu = (reminder: CreatedReminder, needsReview: boolean) => {
    setMenu({ reminder, needsReview, capture: null });
    if (!reminder.capture_id) return;
    fetchCaptureNote(reminder.capture_id)
      .then((capture) =>
        setMenu((m) => (m && m.reminder.id === reminder.id ? { ...m, capture } : m))
      )
      .catch((caught) => logFailure('Loading the reminder source failed:', caught));
  };

  const menuActions = (): SheetAction[] => {
    if (!menu) return [];
    const { reminder, needsReview, capture } = menu;
    const actions: SheetAction[] = [];
    if (!needsReview) actions.push({ label: 'Mark done', onPress: () => markDone(reminder) });
    // Add what the capture behind this reminder doesn't have yet, by hand.
    if (capture && !capture.note) {
      actions.push({
        label: 'Add a note',
        onPress: () => setAttach({ captureId: capture.id, kind: 'note', label: reminder.task }),
      });
    }
    if (capture && capture.memories.length === 0) {
      actions.push({
        label: 'Add a memory',
        onPress: () => setAttach({ captureId: capture.id, kind: 'memory', label: reminder.task }),
      });
    }
    actions.push({ label: 'Delete', destructive: true, onPress: () => confirmDelete(reminder) });
    return actions;
  };

  const confirmDelete = (reminder: CreatedReminder) => {
    Alert.alert('Delete this reminder?', reminder.task, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteReminderById(reminder.id);
            await cancelReminder(reminder.id);
            await load();
          } catch (caught) {
            logFailure('Delete reminder failed:', caught);
            Alert.alert('Couldn’t delete that', 'Please try again.');
          }
        },
      },
    ]);
  };

  // Overdue stays in front of the user until they complete it, but under its
  // own heading — a reminder from last week is not "Today".
  const cutoff = endOfToday();
  const todayStart = startOfToday();
  const overdue = groups.active.filter((r) => r.due_at && nextDue(r) < todayStart);
  const today = groups.active.filter(
    (r) => r.due_at && nextDue(r) >= todayStart && nextDue(r) <= cutoff
  );
  const upcoming = groups.active.filter(
    (r) => !r.due_at || nextDue(r) > cutoff
  );
  const nothing =
    groups.needsReview.length === 0 &&
    groups.active.length === 0 &&
    groups.history.length === 0;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.space2 }]}>
      <View style={styles.header}>
        <Text style={styles.heading}>Reminders</Text>
        <Pressable
          style={styles.add}
          onPress={() => setCreateOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="New reminder"
        >
          <Image source={ICONS.add} style={styles.addIcon} />
        </Pressable>
      </View>
      <OfflineNote />

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.space8 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!isAuthenticated ? (
          <Text style={styles.dim}>Sign in to see your reminders.</Text>
        ) : loading ? (
          <Text style={styles.dim}>Loading…</Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : nothing ? (
          <EmptyState
            line="Nothing due."
            help="Ask Kandoo to remind you about something."
          />
        ) : (
          <>
            {groups.needsReview.length > 0 ? (
              <Section title="Needs review">
                {groups.needsReview.map((r) => (
                  <Row
                    key={r.id}
                    reminder={r}
                    needsReview
                    onOpen={setSelected}
                    onDone={markDone}
                    onMenu={openMenu}
                  />
                ))}
              </Section>
            ) : null}

            {overdue.length > 0 ? (
              <Section title="Overdue">
                {overdue.map((r) => (
                  <Row
                    key={r.id}
                    reminder={r}
                    onOpen={setSelected}
                    onDone={markDone}
                    onMenu={openMenu}
                  />
                ))}
              </Section>
            ) : null}

            {today.length > 0 ? (
              <Section title="Today">
                {today.map((r) => (
                  <Row
                    key={r.id}
                    reminder={r}
                    onOpen={setSelected}
                    onDone={markDone}
                    onMenu={openMenu}
                  />
                ))}
              </Section>
            ) : null}

            {upcoming.length > 0 ? (
              <Section title="Upcoming">
                {upcoming.map((r) => (
                  <Row
                    key={r.id}
                    reminder={r}
                    onOpen={setSelected}
                    onDone={markDone}
                    onMenu={openMenu}
                  />
                ))}
              </Section>
            ) : null}

            {groups.history.length > 0 ? (
              <View style={styles.section}>
                <Pressable
                  style={styles.historyToggle}
                  onPress={() => setHistoryOpen((v) => !v)}
                >
                  <View style={styles.historyLabel}>
                    <Text style={styles.historyEyebrow}>History</Text>
                    <Text style={styles.historyCount}>{groups.history.length}</Text>
                  </View>
                  <Image
                    source={ICONS.expand}
                    style={[styles.expandIcon, historyOpen && styles.expandIconOpen]}
                  />
                </Pressable>
                {historyOpen
                  ? groups.history.map((r) => (
                      <Pressable
                        key={r.id}
                        style={styles.historyRow}
                        onPress={() => setSelected(r)}
                        onLongPress={() => confirmDelete(r)}
                      >
                        <Text style={styles.historyTask} numberOfLines={1}>
                          {r.task}
                        </Text>
                        <Text style={styles.historyWhen}>
                          {formatDueDate(r.due_at) ?? 'Done'}
                        </Text>
                      </Pressable>
                    ))
                  : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>

      {undo ? (
        <View style={[styles.undoBar, { bottom: insets.bottom + spacing.space5 }]}>
          <Text style={styles.undoText}>Completed</Text>
          <Pressable onPress={undoDone} hitSlop={10} accessibilityRole="button">
            <Text style={styles.undoAction}>Undo</Text>
          </Pressable>
        </View>
      ) : null}

      <ReminderDetail
        reminder={selected}
        visible={selected !== null}
        onClose={() => setSelected(null)}
        onChanged={load}
        onOpenNote={(id) => {
          setSelected(null);
          setNoteId(id);
        }}
      />

      <ManualReminder
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={load}
      />

      <NoteDetail
        captureId={noteId}
        visible={noteId !== null}
        onClose={() => setNoteId(null)}
      />

      <ActionSheet
        visible={menu !== null}
        title={menu?.reminder.task}
        actions={menuActions()}
        onClose={() => setMenu(null)}
      />

      <ManualEntry
        visible={attach !== null}
        attach={attach}
        onClose={() => setAttach(null)}
        onCreated={load}
      />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.eyebrow}>{title}</Text>
      {children}
    </View>
  );
}

type RowProps = {
  reminder: CreatedReminder;
  needsReview?: boolean;
  onOpen: (r: CreatedReminder) => void;
  onDone: (r: CreatedReminder) => void;
  onMenu: (r: CreatedReminder, needsReview: boolean) => void;
};

/**
 * One reminder as a Figma card: the task in serif, its time beneath, the person
 * as a chip on the right. The circle on the left completes it in one tap; tap
 * the card to open it; long-press opens the menu (Mark done, Add a note or
 * memory where missing, Delete). A reminder
 * awaiting review keeps its amber highlight and no circle — it isn't set yet.
 */
function Row({ reminder, needsReview, onOpen, onDone, onMenu }: RowProps) {
  const when = whenLine(reminder) ?? reminder.place_hint ?? '';
  // The circle fills for a beat before the row leaves, so the tap registers.
  const [ticked, setTicked] = useState(false);
  const complete = () => {
    if (ticked) return;
    setTicked(true);
    setTimeout(() => onDone(reminder), 250);
  };

  return (
    <Pressable
      style={[styles.row, needsReview && styles.rowReview]}
      onPress={() => onOpen(reminder)}
      onLongPress={() => onMenu(reminder, !!needsReview)}
      accessibilityRole="button"
      accessibilityHint="Long-press for more options"
    >
      {needsReview ? null : (
        <Pressable
          style={[styles.doneCircle, ticked && styles.doneCircleTicked]}
          onPress={complete}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: ticked }}
          accessibilityLabel={`Mark ${reminder.task} done`}
        >
          {ticked ? <Image source={ICONS.check} style={styles.doneCheck} /> : null}
        </Pressable>
      )}
      <View style={styles.rowMain}>
        <View style={styles.rowTop}>
          {needsReview ? <View style={styles.dot} /> : null}
          <Text style={styles.rowTask} numberOfLines={2}>
            {reminder.task}
          </Text>
        </View>
        <Text style={styles.rowWhen}>
          {needsReview ? `Needs review${when ? ` · ${when}` : ''}` : when}
        </Text>
      </View>
      {reminder.person ? (
        <View style={styles.personChip}>
          <Text style={styles.personChipText} numberOfLines={1}>
            {reminder.person}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

// Reminders (Figma: kandoo-reminders).
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.space5,
  },
  heading: { ...text.displayL, letterSpacing: 0, color: colors.ink },
  add: {
    width: 40,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  addIcon: { width: 20, height: 20, tintColor: colors.markRing },
  body: { paddingTop: spacing.space1 },
  dim: { ...text.body, color: colors.inkFaint, marginTop: spacing.space8, textAlign: 'center' },
  error: { ...text.body, color: colors.alarmText, marginTop: spacing.space8, textAlign: 'center' },

  section: { marginBottom: spacing.space5, gap: spacing.space2 },
  eyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    paddingVertical: 14,
    paddingHorizontal: spacing.space4,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowReview: {
    backgroundColor: colors.accentWash,
    borderBottomColor: colors.lineStrong,
  },
  rowMain: { flex: 1, gap: spacing.space1 },
  doneCircle: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneCircleTicked: {
    backgroundColor: colors.settledFill,
    borderColor: colors.settledFill,
  },
  doneCheck: { width: 12, height: 12, tintColor: colors.surface },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  dot: { width: 7, height: 7, borderRadius: radius.full, backgroundColor: colors.accent },
  rowTask: {
    fontFamily: fontFamily.displayRegular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.ink,
    flexShrink: 1,
  },
  rowWhen: { ...text.caption, color: colors.inkMuted },
  personChip: {
    maxWidth: 120,
    paddingVertical: spacing.space1,
    paddingHorizontal: spacing.space2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentWash,
  },
  personChipText: {
    fontFamily: fontFamily.textRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.markRing,
  },

  historyToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.space1,
  },
  historyLabel: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  historyEyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  historyCount: { ...text.caption, color: colors.inkMuted },
  expandIcon: { width: 16, height: 16, tintColor: colors.inkMuted },
  expandIconOpen: { transform: [{ rotate: '180deg' }] },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.space3,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  historyTask: { ...text.body, color: colors.inkMuted, flex: 1 },
  historyWhen: { ...text.caption, color: colors.inkFaint, marginLeft: spacing.space2 },

  undoBar: {
    position: 'absolute',
    left: spacing.space4,
    right: spacing.space4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
  },
  undoText: { ...text.body, color: colors.ink },
  undoAction: { ...text.bodyStrong, color: colors.markRing },
});
