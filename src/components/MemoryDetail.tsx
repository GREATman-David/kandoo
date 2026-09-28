import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  deleteMemoryById,
  updateMemory,
  userMessage,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';

export type MemoryDetailTarget = {
  id: string;
  content: string;
  /** The capture this memory came from, so the source line can open the note. */
  captureId: string | null;
  /** The parent note's title, shown on the source line. Null for a bare memory. */
  sourceTitle: string | null;
  /** A memory the user typed themselves reads "Written by you", not a source. */
  isManual: boolean;
};

export type MemoryDetailProps = {
  memory: MemoryDetailTarget | null;
  visible: boolean;
  onClose: () => void;
  /** Reload the list after an edit or delete. */
  onChanged: () => void;
  /** Open the parent note (the source line). Absent → the line is display-only. */
  onOpenNote?: (captureId: string) => void;
};

/**
 * One memory, frame 10. The pencil turns the fact into an editable field; saving
 * re-embeds it on the server so recall matches the new wording rather than the
 * old (the whole reason a memory is worth editing at all). The source line walks
 * back to the note it was pulled from; a manually-typed memory has no source, so
 * it reads "Written by you" instead.
 */
export function MemoryDetail({
  memory,
  visible,
  onClose,
  onChanged,
  onOpenNote,
}: MemoryDetailProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setEditing(false);
      setError(null);
      setDraft(memory?.content ?? '');
    }
  }, [visible, memory]);

  if (!memory) {
    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} />
    );
  }

  const canSave = draft.trim().length > 0 && draft.trim() !== memory.content && !busy;

  async function save() {
    if (!memory || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      await updateMemory(memory.id, draft.trim());
      setEditing(false);
      onChanged();
    } catch (caught) {
      console.error('Editing memory failed:', caught);
      setError(userMessage(caught, 'Could not save that edit.'));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    if (!memory) return;
    Alert.alert('Delete this memory?', 'It will no longer surface in recall.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteMemoryById(memory.id);
            onChanged();
            onClose();
          } catch (caught) {
            console.error('Deleting memory failed:', caught);
            setError('Could not delete that memory.');
          }
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          {editing ? (
            <Pressable onPress={save} hitSlop={12} disabled={!canSave}>
              <Text style={[styles.action, !canSave && styles.dimAction]}>
                {busy ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setEditing(true)} hitSlop={12}>
              <Text style={styles.action}>Edit</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>Memory</Text>

          {editing ? (
            <TextInput
              style={styles.input}
              value={draft}
              onChangeText={setDraft}
              placeholder="What should Kandoo remember?"
              placeholderTextColor={colors.inkFaint}
              autoFocus
              multiline
            />
          ) : (
            <Text style={styles.content}>{memory.content}</Text>
          )}

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {memory.isManual ? (
            <Text style={styles.source}>Written by you</Text>
          ) : memory.captureId && onOpenNote ? (
            <Pressable
              style={styles.sourceRow}
              onPress={() => onOpenNote(memory.captureId as string)}
              hitSlop={6}
            >
              <Text style={styles.sourceLabel}>From</Text>
              <Text style={styles.sourceLink} numberOfLines={1}>
                {memory.sourceTitle ?? 'the note you captured'} ›
              </Text>
            </Pressable>
          ) : null}

          {editing ? (
            <Pressable style={styles.delete} onPress={confirmDelete} hitSlop={8}>
              <Text style={styles.deleteText}>Delete this memory</Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </View>
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
    paddingBottom: spacing.space2,
  },
  back: { ...text.body, color: colors.inkMuted },
  action: { ...text.bodyStrong, color: colors.accent },
  dimAction: { color: colors.inkFaint },
  body: { paddingBottom: spacing.space8, paddingTop: spacing.space2 },
  eyebrow: { ...text.label, color: colors.inkMuted, marginBottom: spacing.space3 },
  content: { ...text.memory, color: colors.ink },
  input: {
    ...text.memory,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space3,
  },
  error: { ...text.caption, color: colors.alarmText, marginTop: spacing.space4 },
  source: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space6 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.space2,
    marginTop: spacing.space6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.space4,
  },
  sourceLabel: { ...text.label, color: colors.inkMuted },
  sourceLink: { ...text.body, color: colors.settled, flexShrink: 1 },
  delete: { marginTop: spacing.space8 },
  deleteText: { ...text.body, color: colors.alarmText },
});
