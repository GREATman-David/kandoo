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

import { EmptyState } from '@/components/EmptyState';
import { OfflineNote } from '@/components/OfflineNote';
import { ManualReminder } from '@/components/ManualReminder';
import { NoteDetail } from '@/components/NoteDetail';
import { ReminderDetail } from '@/components/ReminderDetail';
import {
  deleteReminderById,
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
};
import { formatDueDate } from '@/utils/formatDueDate';

import { useAuth } from '../features/Auth/useAuth';

const EMPTY: GroupedReminders = { needsReview: [], active: [], history: [] };

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
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Tap the time pill to complete: fired on the server, notification cancelled,
  // and an Undo offered for five seconds before it settles into History.
  const markDone = async (reminder: CreatedReminder) => {
    try {
      await updateReminder(reminder.id, { status: 'fired' });
      await cancelReminder(reminder.id);
      await load();
      setUndo(reminder);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), 5000);
    } catch (caught) {
      logFailure('Mark done failed:', caught);
      Alert.alert('Couldn’t complete that', 'Please try again.');
    }
  };

  const undoDone = async () => {
    if (!undo) return;
    const reminder = undo;
    setUndo(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    try {
      const restored = await updateReminder(reminder.id, { status: 'confirmed' });
      await scheduleReminder(restored);
      await load();
    } catch (caught) {
      logFailure('Undo failed:', caught);
    }
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
  const overdue = groups.active.filter(
    (r) => r.due_at && Date.parse(r.due_at) < todayStart
  );
  const today = groups.active.filter(
    (r) =>
      r.due_at &&
      Date.parse(r.due_at) >= todayStart &&
      Date.parse(r.due_at) <= cutoff
  );
  const upcoming = groups.active.filter(
    (r) => !r.due_at || Date.parse(r.due_at) > cutoff
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
                    onDelete={confirmDelete}
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
                    onDelete={confirmDelete}
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
                    onDelete={confirmDelete}
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
                    onDelete={confirmDelete}
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
          <Text style={styles.undoText}>Marked done</Text>
          <Pressable onPress={undoDone} hitSlop={10}>
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
  onDelete: (r: CreatedReminder) => void;
};

/**
 * One reminder as a Figma card: the task in serif, its time beneath, the person
 * as a chip on the right. Tap opens the reminder (Done and Snooze live there);
 * long-press offers Mark done or Delete. A reminder awaiting review keeps its amber highlight.
 */
function Row({ reminder, needsReview, onOpen, onDone, onDelete }: RowProps) {
  const when = formatDueDate(reminder.due_at) ?? reminder.place_hint ?? '';

  // Long-press keeps both quick actions the old time pill and long-press gave:
  // complete (with its Undo) for a scheduled reminder, and delete.
  const quickActions = () => {
    if (needsReview) {
      onDelete(reminder);
      return;
    }
    Alert.alert(reminder.task, undefined, [
      { text: 'Mark done', onPress: () => onDone(reminder) },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(reminder) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };
  return (
    <Pressable
      style={[styles.row, needsReview && styles.rowReview]}
      onPress={() => onOpen(reminder)}
      onLongPress={quickActions}
      accessibilityRole="button"
      accessibilityHint="Long-press to mark done or delete"
    >
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
  undoAction: { ...text.bodyStrong, color: colors.accent },
});
