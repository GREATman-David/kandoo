import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet, type SheetAction } from '@/components/ActionSheet';
import { EmptyState } from '@/components/EmptyState';
import { LibraryView } from '@/components/library/LibraryView';
import { LockedRow } from '@/components/LockedRow';
import { ManualEntry, type ManualEntryProps } from '@/components/ManualEntry';
import { ManualReminder } from '@/components/ManualReminder';
import { MemoryDetail, type MemoryDetailTarget } from '@/components/MemoryDetail';
import { NoteDetail } from '@/components/NoteDetail';
import { NoteMemoryFork } from '@/components/NoteMemoryFork';
import { Paywall } from '@/components/Paywall';
import { PersonDetail } from '@/components/PersonDetail';
import { ReminderDetail } from '@/components/ReminderDetail';
import { OfflineNote } from '@/components/OfflineNote';
import { useEntitlement } from '@/hooks/useEntitlement';
import { answerOffline } from '@/services/offlineRecall';
import {
  discardLocal,
  flushOutbox,
  isLocalId,
  onOutboxChange,
  pendingCaptures,
  withPendingEdits,
} from '@/services/outbox';
import {
  deleteCaptureById,
  fetchCaptureNotes,
  fetchPeople,
  interpretText,
  degradedReason,
  isNetworkError,
  type CaptureNote,
  type CaptureNoteMemory,
  type CaptureNoteReminder,
  type CreatedReminder,
  type PersonSummary,
  userMessage,
  logFailure,
} from '@/services/interpretationService';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';
import { searchNotes } from '@/utils/searchNotes';
import { timeAgo } from '@/utils/timeAgo';

import { useAuth } from '../features/Auth/useAuth';

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
/** Captures per page; "Show older" fetches the next page before the last one. */
const PAGE = 50;

const ICONS = {
  search: require('@/assets/images/icons/search.png'),
  note: require('@/assets/images/icons/note.png'),
  // A head with a recall arrow: "something Kandoo remembers", not a person.
  memory: require('@/assets/images/icons/memory-recall.png'),
  plus: require('@/assets/images/icons/plus.png'),
};
const isOld = (iso: string) => Date.now() - Date.parse(iso) > TEN_DAYS_MS;

/** A CaptureNoteReminder carries enough to open the shared ReminderDetail. */
function toReminder(r: CaptureNoteReminder): CreatedReminder {
  return {
    id: r.id,
    task: r.task,
    person: r.person,
    due_at: r.due_at,
    place_hint: r.place_hint,
    place_id: null,
    insistent: false,
    status: r.status,
    created_at: r.created_at,
    capture_id: null,
  };
}

/**
 * Memory — everything you've told Kandoo, newest first. The ask field is a
 * second recall entry point (the same 10-day boundary and paywall as Home); the
 * list below carries notes and standalone memories as cards (Figma:
 * kandoo-memory). A note wears the page icon, a memory the recall icon, and a
 * capture that made both opens a split view. Rows past the free window
 * lock; a row still waiting on review wears an amber dot. Long-press deletes.
 */
export default function MemoryScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const { isPro, refresh } = useEntitlement();

  const [notes, setNotes] = useState<CaptureNote[]>([]);
  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Memories (what you told Kandoo) or the Library (your own notes, by category).
  const [view, setView] = useState<'memories' | 'library'>('memories');
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [query, setQuery] = useState('');
  // Typing filters the cards instantly on the device; pressing search also
  // asks Kandoo for a written answer. Both can show at once.
  const searching = query.trim().length >= 2;
  const listRef = useRef<ScrollView>(null);
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  // Long-press menu, and what an "Add a …" from it attaches to.
  const [menuFor, setMenuFor] = useState<CaptureNote | null>(null);
  const [attach, setAttach] = useState<ManualEntryProps['attach']>(null);
  const [reminderFor, setReminderFor] = useState<string | null>(null);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [memoryTarget, setMemoryTarget] = useState<MemoryDetailTarget | null>(null);
  const [fork, setFork] = useState<CaptureNote | null>(null);

  // An edit or delete made from a note/memory opened over the chooser reloads
  // the list; keep the chooser showing the fresh copy (or close it if gone).
  useEffect(() => {
    setFork((current) => (current ? (notes.find((n) => n.id === current.id) ?? null) : null));
  }, [notes]);
  const [personId, setPersonId] = useState<string | null>(null);
  const [reminder, setReminder] = useState<CreatedReminder | null>(null);
  const [paywall, setPaywall] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const shown = useMemo(
    () => (searching ? searchNotes(notes, query) : notes),
    [notes, query, searching]
  );

  // New search words → start the results at the top, where the best match is.
  useEffect(() => {
    listRef.current?.scrollTo({ y: 0, animated: false });
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    // Anything saved on this phone and not yet synced: try to send it now, and
    // list it either way — at the top, marked, until the server has it.
    void flushOutbox();
    const pending = await pendingCaptures();
    try {
      const [captures, peopleList] = await Promise.all([
        fetchCaptureNotes({ requireContent: true, limit: PAGE }),
        fetchPeople().catch(() => [] as PersonSummary[]),
      ]);
      setNotes([...pending, ...(await withPendingEdits(captures))]);
      setHasMore(captures.length === PAGE);
      setPeople(peopleList);
    } catch (caught) {
      logFailure('Loading memory failed:', caught);
      if (pending.length > 0) setNotes(pending);
      else setError(userMessage(caught, 'Could not load your memory.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // A save or a finished sync changes what should be listed.
  useEffect(() => onOutboxChange(() => void load()), [load]);

  // Refresh on focus, not just on mount — otherwise a capture added on Home (or
  // an edit/delete on a detail screen) leaves this list showing stale data until
  // the app is relaunched. The reload is silent: loading is already false, so
  // there is no spinner flash on a tab switch.
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) load();
      else setLoading(false);
      // Notes Mr. Kandoo filed while away show up on return to the Library.
      setLibraryRefresh((n) => n + 1);
    }, [isAuthenticated, load])
  );

  /** The next page, older than the last card shown. Pro's "whole history". */
  const loadMore = useCallback(async () => {
    const last = notes[notes.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const older = await fetchCaptureNotes({
        requireContent: true,
        limit: PAGE,
        before: last.created_at,
      });
      setNotes((current) => {
        const seen = new Set(current.map((n) => n.id));
        return [...current, ...older.filter((n) => !seen.has(n.id))];
      });
      setHasMore(older.length === PAGE);
    } catch (caught) {
      logFailure('Loading older memory failed:', caught);
      Alert.alert('Couldn’t load more', userMessage(caught, 'Please try again.'));
    } finally {
      setLoadingMore(false);
    }
  }, [notes, loadingMore]);

  /** The ask field. Recall runs through the same /interpret path Home uses, so
   *  the model decides recall-vs-capture and the paywall fires at the boundary. */
  const ask = useCallback(async () => {
    const q = query.trim();
    if (!q || asking) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      const result = await interpretText(q);
      const ok = result.results.filter((r) => r.status === 'ok');
      const recall = ok.find((r) => r.kind === 'recall');
      if (recall && recall.kind === 'recall' && recall.status === 'ok') {
        setAnswer(recall.answer);
        if (recall.proBoundaryHit) setPaywall(true);
      } else if (ok.length === 0) {
        // Nothing actionable — never clear silently. Kandoo says so in its own
        // voice (in the answer card) and the question stays in the field.
        setAnswer("I wasn't sure what to do with that. Try asking it another way?");
      } else {
        // Not a question — the user told Kandoo something. It's saved; surface it.
        setAnswer(null);
        setQuery('');
        await load();
      }
    } catch (caught) {
      logFailure('Ask failed:', caught);
      // Offline: answer from what is saved on this phone when anything matches.
      const offlineAnswer = isNetworkError(caught)
        ? await answerOffline(q, degradedReason(caught))
        : null;
      if (offlineAnswer) {
        setAnswer(offlineAnswer);
        return;
      }
      setAskError(userMessage(caught, 'Could not answer that.'));
    } finally {
      setAsking(false);
    }
  }, [query, asking, load]);

  /**
   * Long-press: add what this capture doesn't have yet — a note, a memory or a
   * reminder, typed by hand and attached to it — or delete it.
   */
  const menuActions = (note: CaptureNote): SheetAction[] => {
    const label = captureLabel(note);
    const actions: SheetAction[] = [];
    if (!note.note) {
      actions.push({
        label: 'Add a note',
        onPress: () => {
          setAttach({ captureId: note.id, kind: 'note', label });
          setManualOpen(true);
        },
      });
    }
    if (note.memories.length === 0) {
      actions.push({
        label: 'Add a memory',
        onPress: () => {
          setAttach({ captureId: note.id, kind: 'memory', label });
          setManualOpen(true);
        },
      });
    }
    // A reminder is created on the server and scheduled at once, so it can
    // only link to an entry that has already synced.
    if (note.reminders.length === 0 && !isLocalId(note.id)) {
      actions.push({ label: 'Add a reminder', onPress: () => setReminderFor(note.id) });
    }
    actions.push({ label: 'Delete', destructive: true, onPress: () => confirmDelete(note) });
    return actions;
  };

  const openMemoryOf = useCallback((note: CaptureNote) => {
    if (note.memories.length !== 1) {
      // Several facts read best together, in the note's split view.
      setNoteId(note.id);
      return;
    }
    const m = note.memories[0];
    setMemoryTarget({
      id: m.id,
      content: m.content,
      captureId: note.id,
      sourceTitle: note.note?.title ?? null,
      isManual: note.source === 'manual',
    });
  }, []);

  const openRow = useCallback(
    (note: CaptureNote) => {
      // A note AND facts: "Two ways to see this" lets the user pick.
      if (note.note && note.memories.length > 0) {
        setFork(note);
        return;
      }
      if (note.note) {
        setNoteId(note.id);
        return;
      }
      openMemoryOf(note);
    },
    [openMemoryOf]
  );

  const confirmDelete = useCallback(
    (note: CaptureNote) => {
      Alert.alert(
        'Delete this?',
        'The note and anything Kandoo pulled from it will be removed.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              // Optimistic: drop it now, restore on failure.
              const previous = notes;
              setNotes((cur) => cur.filter((n) => n.id !== note.id));
              try {
                // Never reached the server: just forget it on the phone.
                if (isLocalId(note.id)) await discardLocal(note.id);
                else await deleteCaptureById(note.id);
              } catch (caught) {
                logFailure('Delete failed:', caught);
                setNotes(previous);
                Alert.alert('Could not delete that. Please try again.');
              }
            },
          },
        ]
      );
    },
    [notes]
  );

  const openPerson = useCallback(
    (name: string) => {
      const match = people.find(
        (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
      );
      if (match) {
        setNoteId(null);
        setPersonId(match.id);
      }
    },
    [people]
  );

  const openReminderFromNote = useCallback((r: CaptureNoteReminder) => {
    setNoteId(null);
    setReminder(toReminder(r));
  }, []);

  const openMemoryFromNote = useCallback(
    (m: CaptureNoteMemory) => {
      const parent = notes.find((n) => n.id === noteId);
      setNoteId(null);
      setMemoryTarget({
        id: m.id,
        content: m.content,
        captureId: parent?.id ?? null,
        sourceTitle: parent?.note?.title ?? null,
        isManual: parent?.source === 'manual',
      });
    },
    [notes, noteId]
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.space2 }]}>
      <Text style={styles.heading}>Memory</Text>
      <OfflineNote />

      <View style={styles.switch} accessibilityRole="tablist">
        {(['memories', 'library'] as const).map((option) => (
          <Pressable
            key={option}
            style={[styles.switchOption, view === option && styles.switchOptionOn]}
            onPress={() => setView(option)}
            accessibilityRole="tab"
            accessibilityState={{ selected: view === option }}
          >
            <Text style={[styles.switchText, view === option && styles.switchTextOn]}>
              {option === 'memories' ? 'Memories' : 'Library'}
            </Text>
          </Pressable>
        ))}
      </View>

      {view === 'library' ? (
        isAuthenticated ? (
          <LibraryView refreshKey={libraryRefresh} />
        ) : (
          <Text style={styles.empty}>Sign in to see your library.</Text>
        )
      ) : (
      <>
      <View style={styles.askRow}>
        <TextInput
          style={styles.ask}
          value={query}
          onChangeText={setQuery}
          placeholder="Search or ask anything"
          placeholderTextColor={colors.inkFaint}
          // Some Android skins (Samsung) draw their own underline and spacing
          // under a text field; the bordered bar is the only frame it needs.
          underlineColorAndroid="transparent"
          numberOfLines={1}
          returnKeyType="search"
          onSubmitEditing={ask}
        />
        <Pressable
          onPress={ask}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Ask"
        >
          <Image source={ICONS.search} style={styles.searchIcon} />
        </Pressable>
      </View>

      {asking ? (
        <Text style={styles.askMeta}>Looking…</Text>
      ) : askError ? (
        <Text style={styles.askError}>{askError}</Text>
      ) : answer ? (
        <View style={styles.answerCard}>
          <Text style={styles.answer} selectable>
            {answer}
          </Text>
          <Pressable onPress={() => setAnswer(null)} hitSlop={8}>
            <Text style={styles.answerDismiss}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        ref={listRef}
        contentContainerStyle={[
          styles.body,
          { paddingBottom: spacing.space4 },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {searching && !loading && !error && notes.length > 0 ? (
          <View style={styles.searchHead}>
            <Text style={styles.searchCount}>
              {shown.length === 0
                ? 'No matching memories — press search to ask Kandoo'
                : `${shown.length} ${shown.length === 1 ? 'match' : 'matches'}`}
            </Text>
            <Pressable
              onPress={() => {
                setQuery('');
                setAnswer(null);
              }}
              hitSlop={8}
              accessibilityRole="button"
            >
              <Text style={styles.searchClear}>Clear</Text>
            </Pressable>
          </View>
        ) : null}

        {!isAuthenticated ? (
          <Text style={styles.empty}>Sign in to see your memory.</Text>
        ) : loading ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : notes.length === 0 ? (
          <EmptyState
            line="Nothing saved yet."
            help="What you tell Kandoo shows up here."
          />
        ) : (
          shown.map((note) => {
            const locked = !isPro && isOld(note.created_at);
            const rowTitle =
              note.note?.title ??
              note.memories[0]?.content ??
              note.text;
            if (locked) {
              return (
                <LockedRow
                  key={note.id}
                  variant="card"
                  title={rowTitle}
                  onPress={() => setPaywall(true)}
                  onLongPress={() => setMenuFor(note)}
                />
              );
            }
            return (
              <MemoryRow
                key={note.id}
                note={note}
                onPress={() => openRow(note)}
                onLongPress={() => setMenuFor(note)}
              />
            );
          })
        )}

        {hasMore && !loading && !error && !searching ? (
          <Pressable
            style={[styles.more, loadingMore && styles.moreBusy]}
            onPress={() => void loadMore()}
            disabled={loadingMore}
            accessibilityRole="button"
          >
            <Text style={styles.moreText}>
              {loadingMore ? 'Loading…' : 'Show older'}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      {/* Docked above the tab bar, so it never scrolls away under a long list. */}
      {isAuthenticated ? (
        <View style={styles.addDock}>
          <Pressable
            style={styles.add}
            onPress={() => {
              setAttach(null);
              setManualOpen(true);
            }}
            accessibilityRole="button"
          >
            <View style={styles.addIconWrap}>
              <Image source={ICONS.plus} style={styles.addIcon} />
            </View>
            <Text style={styles.addText}>Add something new</Text>
          </Pressable>
        </View>
      ) : null}
      </>
      )}

      <ManualEntry
        visible={manualOpen}
        attach={attach}
        onClose={() => {
          setManualOpen(false);
          setAttach(null);
        }}
        onCreated={load}
      />

      <ManualReminder
        visible={reminderFor !== null}
        captureId={reminderFor}
        onClose={() => setReminderFor(null)}
        onCreated={load}
      />

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor ? captureLabel(menuFor) : undefined}
        actions={menuFor ? menuActions(menuFor) : []}
        onClose={() => setMenuFor(null)}
      />

      <NoteMemoryFork
        capture={fork}
        visible={fork !== null}
        onClose={() => setFork(null)}
        // The chooser stays open underneath: the note or memory opens on top of
        // it, so going back from either returns here, not to the Memory list.
        onOpenNote={(capture) => setNoteId(capture.id)}
        onOpenMemory={(capture, m) => {
          setMemoryTarget({
            id: m.id,
            content: m.content,
            captureId: capture.id,
            sourceTitle: capture.note?.title ?? null,
            isManual: capture.source === 'manual',
          });
        }}
      />

      <NoteDetail
        captureId={noteId}
        visible={noteId !== null}
        onClose={() => setNoteId(null)}
        onChanged={load}
        onOpenPerson={openPerson}
        onOpenReminder={openReminderFromNote}
        onOpenMemory={openMemoryFromNote}
      />

      <MemoryDetail
        memory={memoryTarget}
        visible={memoryTarget !== null}
        onClose={() => setMemoryTarget(null)}
        onChanged={load}
        onOpenNote={(id) => {
          setMemoryTarget(null);
          setNoteId(id);
        }}
      />

      <PersonDetail
        personId={personId}
        visible={personId !== null}
        onClose={() => setPersonId(null)}
        onChanged={load}
      />

      <ReminderDetail
        reminder={reminder}
        visible={reminder !== null}
        onClose={() => setReminder(null)}
        onChanged={load}
        onOpenNote={(id) => {
          setReminder(null);
          setNoteId(id);
        }}
      />

      <Paywall
        visible={paywall}
        onClose={() => setPaywall(false)}
        onPurchased={() => {
          refresh();
          setPaywall(false);
        }}
      />
    </View>
  );
}

type MemoryRowProps = {
  note: CaptureNote;
  onPress: () => void;
  onLongPress: () => void;
};

/**
 * One card in the feed (Figma: kandoo-memory). A note shows its title, the
 * first fact it holds, and when; a standalone memory shows the fact itself.
 * The type icons sit in the bottom-right corner: page for a note, recall head
 * for a memory, both when a capture made both.
 */
/** How a capture is named in the long-press menu and the "Adding to" line. */
function captureLabel(note: CaptureNote): string {
  const raw = note.note?.title ?? note.memories[0]?.content ?? note.text;
  return raw.length > 60 ? `${raw.slice(0, 57).trimEnd()}…` : raw;
}

function MemoryRow({ note, onPress, onLongPress }: MemoryRowProps) {
  const hasNote = !!note.note;
  const hasMemory = note.memories.length > 0;
  const title = note.note?.title ?? note.memories[0]?.content ?? note.text;
  const excerpt = hasNote ? (note.memories[0]?.content ?? note.note?.body ?? null) : null;
  const needsReview = note.reminders.some((r) => r.status === 'pending');
  const isManual = note.source === 'manual';
  const items = note.memories.length + note.reminders.length;

  const meta: string[] = [];
  if (isManual) meta.push('Written by you');
  // (An entry still syncing from this phone looks like any other: the outbox
  // sends it in the background and the user never has to think about it.)
  meta.push(timeAgo(note.created_at));
  if (hasNote ? items > 0 : items > 1) meta.push(`${items} item${items === 1 ? '' : 's'}`);

  return (
    <Pressable
      style={styles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      <Text style={styles.cardTitle} numberOfLines={2}>
        {title}
      </Text>
      {excerpt ? (
        <Text style={styles.cardExcerpt} numberOfLines={1}>
          {excerpt}
        </Text>
      ) : null}
      {needsReview ? (
        <View style={styles.reviewLine}>
          <View style={styles.reviewDot} />
          <Text style={styles.reviewText}>Needs review</Text>
        </View>
      ) : null}
      <Text style={styles.cardMeta}>{meta.join(' · ')}</Text>

      <View style={styles.cardIcons} pointerEvents="none">
        {hasNote ? <Image source={ICONS.note} style={styles.cardIcon} /> : null}
        {hasMemory ? <Image source={ICONS.memory} style={styles.cardIcon} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.base,
    paddingHorizontal: spacing.space5,
  },
  heading: {
    ...text.displayL,
    letterSpacing: 0,
    color: colors.ink,
    marginBottom: spacing.space4,
  },
  // Memories | Library: two quiet segments, the chosen one raised.
  switch: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginBottom: spacing.space4,
  },
  switchOption: {
    minHeight: 36,
    paddingHorizontal: spacing.space5,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchOptionOn: { backgroundColor: colors.surfaceRaised },
  switchText: { ...text.bodyStrong, color: colors.inkMuted },
  switchTextOn: { color: colors.ink },
  askRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.space4,
    gap: spacing.space2,
  },
  ask: {
    ...text.body,
    flex: 1,
    color: colors.ink,
    paddingVertical: spacing.space3,
  },
  searchIcon: {
    width: 16,
    height: 16,
    tintColor: colors.markRing,
  },
  askMeta: {
    ...text.caption,
    color: colors.inkMuted,
    marginTop: spacing.space2,
  },
  askError: {
    ...text.caption,
    color: colors.alarmText,
    marginTop: spacing.space2,
  },
  answerCard: {
    marginTop: spacing.space3,
    padding: spacing.space4,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
  },
  answer: {
    ...text.answer,
    color: colors.ink,
  },
  answerDismiss: {
    ...text.caption,
    color: colors.inkMuted,
    marginTop: spacing.space3,
  },
  body: {
    paddingTop: spacing.space4,
    gap: spacing.space3,
  },
  empty: {
    ...text.body,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: spacing.space8,
  },
  errorText: {
    ...text.body,
    color: colors.alarmText,
    textAlign: 'center',
    marginTop: spacing.space8,
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.space4,
    gap: spacing.space2,
  },
  cardTitle: {
    fontFamily: fontFamily.displaySemiBold,
    fontSize: 17,
    lineHeight: 22,
    color: colors.ink,
  },
  cardExcerpt: {
    ...text.caption,
    color: colors.inkMuted,
  },
  // Clear of the corner icons.
  cardMeta: {
    fontFamily: fontFamily.textRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkMuted,
    paddingRight: 44,
  },
  cardIcons: {
    position: 'absolute',
    right: 11,
    bottom: 11,
    flexDirection: 'row',
    gap: 6,
  },
  cardIcon: {
    width: 16,
    height: 16,
    tintColor: colors.markRing,
  },
  reviewLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space1,
  },
  reviewDot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  reviewText: {
    ...text.caption,
    color: colors.accent,
  },

  searchHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  searchCount: { ...text.caption, color: colors.inkMuted, flexShrink: 1 },
  searchClear: { ...text.bodyStrong, color: colors.markRing },
  more: {
    alignSelf: 'center',
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space5,
  },
  moreBusy: {
    opacity: 0.6,
  },
  moreText: {
    ...text.bodyStrong,
    color: colors.markRing,
  },
  addDock: {
    paddingTop: spacing.space3,
    paddingBottom: spacing.space3,
  },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentWash,
  },
  addIconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIcon: {
    width: 14,
    height: 14,
    tintColor: colors.markRing,
  },
  addText: {
    ...text.bodyStrong,
    flex: 1,
    color: colors.ink,
  },
});
