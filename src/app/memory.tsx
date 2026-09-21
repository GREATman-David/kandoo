import { useCallback, useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchCaptureNotes,
  type CaptureNote,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';

import { useAuth } from '../features/Auth/useAuth';

/**
 * Memory — one screen of notes. Each capture that produced a note reads as a
 * written note (title and body in the serif), then "Kandoo understood" lists
 * what it pulled out (memories and reminders, joined by capture_id), and the
 * original words sit behind a toggle. It never invents; the note is only the
 * organised form of what was said.
 */
export default function MemoryScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();

  const [notes, setNotes] = useState<CaptureNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      setNotes(await fetchCaptureNotes());
    } catch (caught) {
      console.error('Loading notes failed:', caught);
      setError(
        caught instanceof Error ? caught.message : 'Could not load your notes.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) load();
    else setLoading(false);
  }, [isAuthenticated, load]);

  const toggle = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.space4 }]}>
      <Text style={styles.heading}>Memory</Text>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.space8 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!isAuthenticated ? (
          <Text style={styles.empty}>Sign in to see your notes.</Text>
        ) : loading ? (
          <Text style={styles.empty}>Loading…</Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : notes.length === 0 ? (
          <Text style={styles.empty}>
            Notes from what you tell Kandoo will appear here.
          </Text>
        ) : (
          notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              expanded={expanded.has(note.id)}
              onToggle={() => toggle(note.id)}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

type NoteCardProps = {
  note: CaptureNote;
  expanded: boolean;
  onToggle: () => void;
};

function NoteCard({ note, expanded, onToggle }: NoteCardProps) {
  const understood = note.memories.length + note.reminders.length;

  return (
    <View style={styles.card}>
      {note.note ? (
        <>
          <Text style={styles.noteTitle}>{note.note.title}</Text>
          <Text style={styles.noteBody}>{note.note.body}</Text>
        </>
      ) : (
        <Text style={styles.noteBody}>{note.text}</Text>
      )}

      {understood > 0 ? (
        <View style={styles.understood}>
          <Text style={styles.eyebrow}>Kandoo understood</Text>
          {note.memories.map((memory) => (
            <View key={memory.id} style={styles.row}>
              <Text style={styles.rowKind}>Memory</Text>
              <Text style={styles.rowText}>{memory.content}</Text>
            </View>
          ))}
          {note.reminders.map((reminder) => {
            const when = formatDueDate(reminder.due_at) ?? reminder.place_hint;
            return (
              <View key={reminder.id} style={styles.row}>
                <Text style={styles.rowKind}>Reminder</Text>
                <Text style={styles.rowText}>
                  {reminder.task}
                  {when ? ` · ${when}` : ''}
                </Text>
              </View>
            );
          })}
        </View>
      ) : null}

      <Pressable onPress={onToggle} hitSlop={8} style={styles.toggle}>
        <Text style={styles.toggleText}>
          {expanded ? 'Hide what you said' : 'What you said'}
        </Text>
      </Pressable>
      {expanded ? <Text style={styles.raw}>{note.text}</Text> : null}
    </View>
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
    marginBottom: spacing.space4,
  },
  body: {
    paddingTop: spacing.space2,
  },
  empty: {
    ...text.body,
    color: colors.inkFaint,
    textAlign: 'center',
    marginTop: spacing.space8,
  },
  error: {
    ...text.body,
    color: colors.alarmText,
    textAlign: 'center',
    marginTop: spacing.space8,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.space4,
    marginBottom: spacing.space4,
  },
  noteTitle: {
    ...text.displayL,
    color: colors.ink,
    marginBottom: spacing.space2,
  },
  noteBody: {
    ...text.memory,
    color: colors.ink,
  },
  understood: {
    marginTop: spacing.space4,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.space3,
  },
  eyebrow: {
    ...text.label,
    color: colors.inkMuted,
    marginBottom: spacing.space2,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.space2,
    marginBottom: spacing.space2,
  },
  rowKind: {
    ...text.label,
    color: colors.settled,
    width: 64,
    paddingTop: 2,
  },
  rowText: {
    ...text.body,
    color: colors.ink,
    flex: 1,
  },
  toggle: {
    marginTop: spacing.space4,
  },
  toggleText: {
    ...text.caption,
    color: colors.inkMuted,
  },
  raw: {
    ...text.body,
    color: colors.inkMuted,
    marginTop: spacing.space2,
    fontStyle: 'italic',
  },
});
