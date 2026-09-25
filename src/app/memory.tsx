import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { LockedRow } from '@/components/LockedRow';
import { ManualEntry } from '@/components/ManualEntry';
import { MemoryDetail, type MemoryDetailTarget } from '@/components/MemoryDetail';
import { NoteDetail } from '@/components/NoteDetail';
import { Paywall } from '@/components/Paywall';
import { PersonDetail } from '@/components/PersonDetail';
import { ReminderDetail } from '@/components/ReminderDetail';
import { useEntitlement } from '@/hooks/useEntitlement';
import {
  deleteCaptureById,
  fetchCaptureNotes,
  fetchPeople,
  interpretText,
  type CaptureNote,
  type CaptureNoteMemory,
  type CaptureNoteReminder,
  type CreatedReminder,
  type PersonSummary,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';

import { useAuth } from '../features/Auth/useAuth';

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
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
 * list below carries notes and standalone memories. A note reads 📄, a memory
 * 👤, and a capture that made both opens a split view. Rows past the free window
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

  const [query, setQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [memoryTarget, setMemoryTarget] = useState<MemoryDetailTarget | null>(null);
  const [personId, setPersonId] = useState<string | null>(null);
  const [reminder, setReminder] = useState<CreatedReminder | null>(null);
  const [paywall, setPaywall] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [captures, peopleList] = await Promise.all([
        fetchCaptureNotes({ requireContent: true, limit: 50 }),
        fetchPeople().catch(() => [] as PersonSummary[]),
      ]);
      setNotes(captures);
      setPeople(peopleList);
    } catch (caught) {
      console.error('Loading memory failed:', caught);
      setError(caught instanceof Error ? caught.message : 'Could not load your memory.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
    else setLoading(false);
  }, [isAuthenticated, load]);

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
      const recall = result.results.find(
        (r) => r.kind === 'recall' && r.status === 'ok'
      );
      if (recall && recall.kind === 'recall' && recall.status === 'ok') {
        setAnswer(recall.answer);
        if (recall.proBoundaryHit) setPaywall(true);
      } else {
        // Not a question — the user told Kandoo something. It's saved; surface it.
        setAnswer(null);
        setQuery('');
        await load();
      }
    } catch (caught) {
      console.error('Ask failed:', caught);
      setAskError(caught instanceof Error ? caught.message : 'Could not answer that.');
    } finally {
      setAsking(false);
    }
  }, [query, asking, load]);

  const openRow = useCallback((note: CaptureNote) => {
    const hasNote = !!note.note;
    if (hasNote || note.memories.length !== 1) {
      // A note, or a memory-only capture with several facts, opens the split view.
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
                await deleteCaptureById(note.id);
              } catch (caught) {
                console.error('Delete failed:', caught);
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
    <View style={[styles.screen, { paddingTop: insets.top + spacing.space4 }]}>
      <Text style={styles.heading}>Memory</Text>

      <View style={styles.askRow}>
        <TextInput
          style={styles.ask}
          value={query}
          onChangeText={setQuery}
          placeholder="Ask what you know…"
          placeholderTextColor={colors.inkFaint}
          returnKeyType="search"
          onSubmitEditing={ask}
        />
      </View>

      {asking ? (
        <Text style={styles.askMeta}>Looking…</Text>
      ) : askError ? (
        <Text style={styles.askError}>{askError}</Text>
      ) : answer ? (
        <View style={styles.answerCard}>
          <Text style={styles.answer}>{answer}</Text>
          <Pressable onPress={() => setAnswer(null)} hitSlop={8}>
            <Text style={styles.answerDismiss}>Clear</Text>
          </Pressable>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.space8 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Pressable style={styles.add} onPress={() => setManualOpen(true)}>
          <Text style={styles.addText}>+ Add something new</Text>
        </Pressable>

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
          notes.map((note) => {
            const locked = !isPro && isOld(note.created_at);
            const rowTitle =
              note.note?.title ??
              note.memories[0]?.content ??
              note.text;
            if (locked) {
              return (
                <LockedRow
                  key={note.id}
                  title={rowTitle}
                  onPress={() => setPaywall(true)}
                  onLongPress={() => confirmDelete(note)}
                />
              );
            }
            return (
              <MemoryRow
                key={note.id}
                note={note}
                onPress={() => openRow(note)}
                onLongPress={() => confirmDelete(note)}
              />
            );
          })
        )}
      </ScrollView>

      <ManualEntry
        visible={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreated={load}
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
 * The type glyph, drawn with Views like every other mark in the app (the design
 * frames show 📄/👤 as shorthand, but the app never renders colour emoji — the
 * lock is LockGlyph, not 🔒). A note is a small page with ruled lines; a memory
 * is a person. A capture that is both shows the two side by side.
 */
function TypeIcon({ hasNote, hasMemory }: { hasNote: boolean; hasMemory: boolean }) {
  return (
    <View style={styles.iconRow} pointerEvents="none">
      {hasNote ? (
        <View style={styles.noteGlyph}>
          <View style={styles.noteLine} />
          <View style={styles.noteLine} />
          <View style={[styles.noteLine, styles.noteLineShort]} />
        </View>
      ) : null}
      {hasMemory ? (
        <View style={styles.personGlyph}>
          <View style={styles.personHead} />
          <View style={styles.personBody} />
        </View>
      ) : null}
    </View>
  );
}

function MemoryRow({ note, onPress, onLongPress }: MemoryRowProps) {
  const hasNote = !!note.note;
  const hasMemory = note.memories.length > 0;
  const title = note.note?.title ?? note.memories[0]?.content ?? note.text;
  const needsReview = note.reminders.some((r) => r.status === 'pending');
  const isManual = note.source === 'manual';

  const meta: string[] = [];
  if (note.memories.length) meta.push(`${note.memories.length} memor${note.memories.length === 1 ? 'y' : 'ies'}`);
  if (note.reminders.length) meta.push(`${note.reminders.length} reminder${note.reminders.length === 1 ? '' : 's'}`);
  if (isManual) meta.push('Written by you');

  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
    >
      <TypeIcon hasNote={hasNote} hasMemory={hasMemory} />
      <View style={styles.rowMain}>
        <Text style={styles.rowTitle} numberOfLines={2}>
          {title}
        </Text>
        {meta.length > 0 ? (
          <Text style={styles.rowMeta}>{meta.join(' · ')}</Text>
        ) : null}
        {needsReview ? (
          <View style={styles.reviewLine}>
            <View style={styles.reviewDot} />
            <Text style={styles.reviewText}>Needs review</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.base,
    paddingHorizontal: spacing.space4,
  },
  heading: {
    ...text.displayXl,
    color: colors.ink,
    marginBottom: spacing.space3,
  },
  askRow: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.space3,
  },
  ask: {
    ...text.body,
    color: colors.ink,
    paddingVertical: spacing.space3,
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
  },
  add: {
    paddingVertical: spacing.space3,
    marginBottom: spacing.space2,
  },
  addText: {
    ...text.bodyStrong,
    color: colors.accent,
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
  row: {
    flexDirection: 'row',
    gap: spacing.space3,
    paddingVertical: spacing.space4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  iconRow: {
    flexDirection: 'row',
    gap: spacing.space1,
    paddingTop: 3,
    width: 30,
  },
  noteGlyph: {
    width: 12,
    height: 14,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.inkMuted,
    paddingHorizontal: 2,
    paddingTop: 3,
    gap: 2,
  },
  noteLine: {
    height: 1,
    borderRadius: radius.full,
    backgroundColor: colors.inkMuted,
  },
  noteLineShort: {
    width: 4,
  },
  personGlyph: {
    width: 12,
    height: 14,
    alignItems: 'center',
  },
  personHead: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.inkMuted,
  },
  personBody: {
    width: 11,
    height: 6,
    borderTopLeftRadius: radius.full,
    borderTopRightRadius: radius.full,
    backgroundColor: colors.inkMuted,
    marginTop: 1,
  },
  rowMain: {
    flex: 1,
  },
  rowTitle: {
    ...text.body,
    color: colors.ink,
  },
  rowMeta: {
    ...text.caption,
    color: colors.inkMuted,
    marginTop: 2,
  },
  reviewLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space1,
    marginTop: spacing.space2,
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
});
