import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { logFailure, openInWord, userMessage, type LibraryNote } from '@/services/interpretationService';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';
import { timeAgo } from '@/utils/timeAgo';

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
};

/** Mirror the server's limits (backend libraryInput.ts). */
const MAX_TITLE = 200;
const MAX_BODY = 20000;

/** The web links in a note (a research write-up's references), in order, once each. */
function linksIn(body: string): string[] {
  const found = body.match(/https?:\/\/[^\s)\]]+/g) ?? [];
  return [...new Set(found.map((url) => url.replace(/[.,;:]+$/, '')))].slice(0, 20);
}

export type LibraryNoteEditorProps = {
  visible: boolean;
  /** The category it belongs to, shown above the note. */
  categoryName: string;
  /** Null to write a new note. */
  note: LibraryNote | null;
  onClose: () => void;
  /** Resolves when saved; throws a user-facing message to keep the page open. */
  onSave: (value: { title: string | null; body: string }) => Promise<void>;
  onDelete?: () => Promise<void>;
};

/** One Library note, written or edited on a page of its own. */
export function LibraryNoteEditor({
  visible,
  categoryName,
  note,
  onClose,
  onSave,
  onDelete,
}: LibraryNoteEditorProps) {
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTitle(note?.title ?? '');
      setBody(note?.body ?? '');
      setError(null);
    }
  }, [visible, note]);

  const changed = (note?.title ?? '') !== title || (note?.body ?? '') !== body;
  const canSave = body.trim().length > 0 && changed && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ title: title.trim() || null, body: body.trim() });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That note didn’t save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  // Leaving with unsaved words asks first; nothing typed is lost silently.
  const close = () => {
    if (!changed || saving) {
      onClose();
      return;
    }
    Alert.alert('Leave without saving?', 'What you wrote here won’t be kept.', [
      { text: 'Keep writing', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: onClose },
    ]);
  };

  const confirmDelete = () => {
    if (!onDelete) return;
    Alert.alert('Delete this note?', 'It will be removed from your library.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          onDelete()
            .then(onClose)
            .catch((caught: unknown) => {
              setError(caught instanceof Error ? caught.message : 'That note wasn’t deleted. Try again.');
            });
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior="padding" style={styles.screen}>
        <View style={[styles.bar, { marginTop: insets.top + spacing.space4 }]}>
          <Pressable
            style={styles.backBtn}
            onPress={close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Image source={ICONS.back} style={styles.backIcon} />
          </Pressable>
          {note && onDelete ? (
            <Pressable onPress={confirmDelete} hitSlop={8} accessibilityRole="button">
              <Text style={styles.delete}>Delete</Text>
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.body}
        >
          <Text style={styles.eyebrow} numberOfLines={1}>
            {categoryName}
          </Text>
          <TextInput
            style={styles.title}
            value={title}
            onChangeText={setTitle}
            placeholder="Title (optional)"
            placeholderTextColor={colors.inkFaint}
            maxLength={MAX_TITLE}
            underlineColorAndroid="transparent"
            returnKeyType="next"
          />
          <TextInput
            style={styles.text}
            value={body}
            onChangeText={setBody}
            placeholder="Write your note…"
            placeholderTextColor={colors.inkFaint}
            maxLength={MAX_BODY}
            multiline
            textAlignVertical="top"
            underlineColorAndroid="transparent"
            autoFocus={!note}
          />
          {linksIn(body).length > 0 ? (
            <View style={styles.links}>
              <Text style={styles.linksLabel}>Links</Text>
              {linksIn(body).map((url) => (
                <Pressable
                  key={url}
                  onPress={() => {
                    Linking.openURL(url).catch((caught: unknown) => {
                      console.warn('Opening a link failed:', caught);
                      setError('That link didn’t open.');
                    });
                  }}
                  hitSlop={4}
                  accessibilityRole="link"
                >
                  <Text style={styles.link} numberOfLines={1}>
                    {url.replace(/^https?:\/\//, '')}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {note && !changed ? (
            // A saved note opens in Microsoft Word as a real .docx.
            <Pressable
              style={styles.word}
              onPress={() => {
                openInWord({ kind: 'library', noteId: note.id }, note.title ?? 'Kandoo note').catch((caught: unknown) => {
                  logFailure('Opening a note in Word failed:', caught);
                  setError(userMessage(caught, 'It didn’t open. Is Microsoft Word installed?'));
                });
              }}
              accessibilityRole="button"
            >
              <Text style={styles.wordText}>Open in Word</Text>
            </Pressable>
          ) : null}
          {note ? (
            <Text style={styles.meta}>
              {note.source === 'document' ? 'Read from a page · ' : note.source === 'research' ? 'Researched by Mr. Kandoo · ' : ''}
              Edited {timeAgo(note.updated_at).toLowerCase()}
            </Text>
          ) : null}
        </ScrollView>

        <View style={[styles.dock, { paddingBottom: insets.bottom + spacing.space4 }]}>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable
            style={[styles.primary, !canSave && styles.disabled]}
            onPress={() => void save()}
            disabled={!canSave}
            accessibilityRole="button"
          >
            <Text style={styles.primaryText}>{saving ? 'Saving' : note ? 'Save changes' : 'Save note'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backIcon: { width: 20, height: 20, tintColor: colors.ink },
  delete: { ...text.bodyStrong, color: colors.alarmText },
  body: { paddingBottom: spacing.space6, flexGrow: 1 },
  eyebrow: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    marginTop: 20,
    marginBottom: spacing.space3,
  },
  // The user's own words are Fraunces (AGENTS §7), on the note's white page.
  title: {
    ...text.displayL,
    color: colors.ink,
    paddingVertical: spacing.space2,
  },
  text: {
    fontFamily: fontFamily.displayRegular,
    fontSize: 17,
    lineHeight: 26,
    color: colors.ink,
    minHeight: 260,
    marginTop: spacing.space3,
    padding: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  meta: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space3 },
  links: { marginTop: spacing.space4, gap: spacing.space2 },
  word: {
    alignSelf: 'flex-start',
    marginTop: spacing.space4,
    minHeight: 44,
    paddingHorizontal: spacing.space5,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    justifyContent: 'center',
  },
  wordText: { ...text.bodyStrong, color: colors.ink },
  linksLabel: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  link: { ...text.body, color: colors.focus, textDecorationLine: 'underline' },
  dock: { paddingTop: spacing.space3, gap: spacing.space2 },
  error: { ...text.caption, color: colors.alarmText, textAlign: 'center' },
  primary: {
    minHeight: 52,
    borderRadius: radius.full,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  primaryText: { ...text.bodyStrong, color: colors.ink },
});
