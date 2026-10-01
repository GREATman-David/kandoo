import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  fetchLibrary,
  fetchLibraryCategory,
  logFailure,
  userMessage,
  type LibraryCategory,
  type LibraryNote,
} from '@/services/interpretationService';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

export type SharedNote = { kind: 'note' | 'research'; title: string | null; body: string; message: string | null };

/**
 * Share a note with the team: pick one from the Library (category → note), or
 * write one here. An optional message travels with it ("For Friday's call").
 */
export function ShareNoteSheet({
  mode,
  teamName,
  onClose,
  onShare,
}: {
  mode: 'library' | 'write' | null;
  teamName: string;
  onClose: () => void;
  onShare: (note: SharedNote) => Promise<void>;
}) {
  const [categories, setCategories] = useState<LibraryCategory[]>([]);
  const [shelf, setShelf] = useState<LibraryCategory | null>(null);
  const [notes, setNotes] = useState<LibraryNote[]>([]);
  const [picked, setPicked] = useState<LibraryNote | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mode) return;
    setShelf(null);
    setNotes([]);
    setPicked(null);
    setTitle('');
    setBody('');
    setMessage('');
    setError(null);
    if (mode === 'library') {
      fetchLibrary()
        .then(setCategories)
        .catch((caught: unknown) => {
          logFailure('Loading the Library to share failed:', caught);
          setError(userMessage(caught, 'Your Library couldn’t load.'));
        });
    }
  }, [mode]);

  const openShelf = (category: LibraryCategory) => {
    setShelf(category);
    fetchLibraryCategory(category.id)
      .then((data) => setNotes(data.notes))
      .catch((caught: unknown) => {
        logFailure('Loading notes to share failed:', caught);
        setError(userMessage(caught, 'Those notes couldn’t load.'));
      });
  };

  const ready = mode === 'write' ? body.trim().length > 0 : picked !== null;

  const share = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onShare(
        mode === 'write'
          ? { kind: 'note', title: title.trim() || null, body: body.trim(), message: message.trim() || null }
          : {
              kind: picked?.source === 'research' ? 'research' : 'note',
              title: picked?.title ?? null,
              body: picked?.body ?? '',
              message: message.trim() || null,
            }
      );
    } catch (caught) {
      logFailure('Sharing a note failed:', caught);
      setError(userMessage(caught, 'That wasn’t shared. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={mode !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior="padding" style={styles.flex}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.eyebrow}>Share with {teamName}</Text>
            <Text style={styles.title}>
              {mode === 'write' ? 'Write a note' : picked ? 'Share this note?' : shelf ? shelf.name : 'Choose from your Library'}
            </Text>

            {mode === 'write' ? (
              <>
                <TextInput
                  style={styles.inputTitle}
                  value={title}
                  onChangeText={setTitle}
                  placeholder="Title (optional)"
                  placeholderTextColor={colors.inkFaint}
                  maxLength={200}
                  underlineColorAndroid="transparent"
                />
                <TextInput
                  style={styles.inputBody}
                  value={body}
                  onChangeText={setBody}
                  placeholder="What the team should know…"
                  placeholderTextColor={colors.inkFaint}
                  multiline
                  textAlignVertical="top"
                  maxLength={20000}
                  autoFocus
                  underlineColorAndroid="transparent"
                />
              </>
            ) : picked ? (
              <View style={styles.preview}>
                <Text style={styles.previewTitle}>{picked.title ?? picked.body.slice(0, 60)}</Text>
                <Text style={styles.previewBody} numberOfLines={4}>
                  {picked.body}
                </Text>
              </View>
            ) : (
              <ScrollView style={styles.list}>
                {shelf
                  ? notes.map((note) => (
                      <Pressable key={note.id} style={styles.row} onPress={() => setPicked(note)} accessibilityRole="button">
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {note.title ?? note.body.slice(0, 60)}
                        </Text>
                        <Text style={styles.rowMeta}>{note.source === 'research' ? 'Research' : note.source === 'document' ? 'From a page' : 'Note'}</Text>
                      </Pressable>
                    ))
                  : categories.map((category) => (
                      <Pressable key={category.id} style={styles.row} onPress={() => openShelf(category)} accessibilityRole="button">
                        <Text style={styles.rowTitle}>{category.name}</Text>
                        <Text style={styles.rowMeta}>
                          {category.noteCount} {category.noteCount === 1 ? 'note' : 'notes'}
                        </Text>
                      </Pressable>
                    ))}
                {shelf && notes.length === 0 ? <Text style={styles.rowMeta}>No notes in this category.</Text> : null}
                {!shelf && categories.length === 0 ? <Text style={styles.rowMeta}>Your Library is empty.</Text> : null}
              </ScrollView>
            )}

            {mode === 'write' || picked ? (
              <TextInput
                style={styles.inputMessage}
                value={message}
                onChangeText={setMessage}
                placeholder="Add a message (optional)"
                placeholderTextColor={colors.inkFaint}
                maxLength={500}
                underlineColorAndroid="transparent"
              />
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                style={styles.secondary}
                onPress={() => (picked ? setPicked(null) : shelf ? setShelf(null) : onClose())}
                accessibilityRole="button"
              >
                <Text style={styles.secondaryText}>{picked || shelf ? 'Back' : 'Cancel'}</Text>
              </Pressable>
              {mode === 'write' || picked ? (
                <Pressable
                  style={[styles.primary, (!ready || busy) && styles.disabled]}
                  onPress={() => void share()}
                  disabled={!ready || busy}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryText}>{busy ? 'Sharing' : 'Share'}</Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withOpacity(colors.ink, 0.35) },
  sheet: {
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.space5,
    paddingBottom: spacing.space6,
    gap: spacing.space2,
    maxHeight: '85%',
  },
  eyebrow: { ...text.label, color: colors.markRing },
  title: { ...text.displayL, color: colors.ink },
  list: { maxHeight: 360 },
  row: { paddingVertical: spacing.space3, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 2 },
  rowTitle: { ...text.memory, color: colors.ink },
  rowMeta: { ...text.caption, color: colors.inkMuted },
  preview: { padding: spacing.space4, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, gap: 4 },
  previewTitle: { ...text.bodyStrong, color: colors.ink },
  previewBody: { ...text.body, color: colors.inkMuted },
  inputTitle: { ...text.memory, color: colors.ink, paddingVertical: spacing.space2 },
  inputBody: {
    ...text.body,
    color: colors.ink,
    minHeight: 140,
    maxHeight: 260,
    padding: spacing.space3,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  inputMessage: { ...text.body, color: colors.ink, borderBottomWidth: 1, borderBottomColor: colors.lineStrong, paddingVertical: spacing.space2 },
  error: { ...text.caption, color: colors.alarmText },
  actions: { flexDirection: 'row', gap: spacing.space2, marginTop: spacing.space3 },
  secondary: {
    minHeight: 48,
    paddingHorizontal: spacing.space5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...text.bodyStrong, color: colors.inkMuted },
  primary: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.full,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { ...text.bodyStrong, color: colors.ink },
  disabled: { opacity: 0.5 },
});
