import { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardLift } from '@/hooks/useKeyboardLift';
import {
  deleteMemoryById,
  fetchCaptureNote,
  logFailure,
  type CaptureNote,
} from '@/services/interpretationService';
import { discardLocal, isLocalId, pendingCapture, saveMemoryEdit } from '@/services/outbox';
import { colors, spacing, text } from '@/theme/theme';
import { timeAgo } from '@/utils/timeAgo';

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  edit: require('@/assets/images/icons/pencil.png'),
  open: require('@/assets/images/icons/chevron-right.png'),
  expand: require('@/assets/images/icons/chevron-down.png'),
};

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
  const insets = useSafeAreaInsets();
  // While typing, the editor ends at the top of the keyboard (see styles.editor).
  const keyboard = useKeyboardLift({ inModal: true });
  const [editing, setEditing] = useState(false);
  // What the screen shows: the saved wording, updated at once by an edit.
  const [content, setContent] = useState(memory?.content ?? '');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The capture this memory came from: its time for the source line and its
  // verbatim words for "What you said". Best-effort — the screen works without.
  const [source, setSource] = useState<CaptureNote | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (visible) {
      setEditing(false);
      setError(null);
      setShowRaw(false);
      setDraft(memory?.content ?? '');
      setContent(memory?.content ?? '');
    }
  }, [visible, memory]);

  useEffect(() => {
    setSource(null);
    const captureId = memory?.captureId;
    if (!visible || !captureId) return;
    let active = true;
    (isLocalId(captureId) ? pendingCapture(captureId) : fetchCaptureNote(captureId))
      .then((capture) => {
        if (active) setSource(capture);
      })
      .catch((caught) => logFailure('Loading memory source failed:', caught));
    return () => {
      active = false;
    };
  }, [visible, memory?.captureId]);

  if (!memory) {
    return <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} />;
  }

  const canSave = draft.trim().length > 0 && draft.trim() !== content && !busy;

  async function save() {
    if (!memory || !canSave) return;
    setBusy(true);
    setError(null);
    try {
      // Saved on this phone at once; the outbox syncs it (no connection needed).
      await saveMemoryEdit(memory.id, draft.trim());
      setContent(draft.trim());
      setEditing(false);
      onChanged();
    } catch (caught) {
      // Only a failure to write to the phone's own storage lands here.
      logFailure('Saving the memory edit on this phone failed:', caught);
      setError('Could not save that edit on this phone. Please try again.');
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
            // Never reached the server: forget it on the phone.
            if (isLocalId(memory.id) && memory.captureId) await discardLocal(memory.captureId);
            else await deleteMemoryById(memory.id);
            onChanged();
            onClose();
          } catch (caught) {
            logFailure('Deleting memory failed:', caught);
            setError('Could not delete that memory.');
          }
        },
      },
    ]);
  }

  const when = source ? timeAgo(source.created_at) : null;
  const sourceLine = memory.isManual
    ? ['Written by you', when].filter(Boolean).join(' · ')
    : ['From ' + (memory.sourceTitle ?? source?.note?.title ?? 'what you said'), when]
        .filter(Boolean)
        .join(' · ');
  const canOpenSource = !memory.isManual && !!memory.captureId && !!onOpenNote;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View ref={keyboard.ref} style={[styles.screen, { paddingBottom: keyboard.lift }]}>
        <View style={[styles.bar, { marginTop: insets.top + spacing.space4 }]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Image source={ICONS.back} style={styles.barIcon} />
          </Pressable>
          {editing ? (
            <Pressable onPress={save} hitSlop={12} disabled={!canSave}>
              <Text style={[styles.action, !canSave && styles.dimAction]}>
                {busy ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => setEditing(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Edit memory"
            >
              <Image source={ICONS.edit} style={styles.barIcon} />
            </Pressable>
          )}
        </View>

        {editing ? (
          // Editing: the box fills the space down to the keyboard and scrolls
          // inside itself, so the line being typed always stays in view.
          <View style={styles.editor}>
            <TextInput
              style={[styles.input, styles.inputFill]}
              value={draft}
              onChangeText={setDraft}
              placeholder="What should Kandoo remember?"
              placeholderTextColor={colors.inkFaint}
              underlineColorAndroid="transparent"
              autoFocus
              multiline
              scrollEnabled
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {/* Out of the way while typing; back when the keyboard closes. */}
            {keyboard.keyboardOpen ? null : (
              <Pressable style={styles.delete} onPress={confirmDelete} hitSlop={8}>
                <Text style={styles.deleteText}>Delete this memory</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.content}>{content}</Text>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={styles.sourceRow}
              onPress={() => canOpenSource && onOpenNote?.(memory.captureId as string)}
              disabled={!canOpenSource}
              hitSlop={6}
              accessibilityRole={canOpenSource ? 'link' : undefined}
            >
              <Text style={styles.sourceText} numberOfLines={1}>
                {sourceLine}
              </Text>
              {canOpenSource ? <Image source={ICONS.open} style={styles.openIcon} /> : null}
            </Pressable>

            {!memory.isManual && source ? (
              <>
                <Pressable
                  style={styles.rawToggle}
                  onPress={() => setShowRaw((v) => !v)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showRaw }}
                >
                  <Text style={styles.rawToggleText}>What you said</Text>
                  <Image
                    source={ICONS.expand}
                    style={[styles.expandIcon, showRaw && styles.expandIconOpen]}
                  />
                </Pressable>
                {showRaw ? <Text style={styles.raw}>{source.text}</Text> : null}
              </>
            ) : null}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

// Memory detail (Figma: kandoo-memory-detail).
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  barIcon: { width: 20, height: 20, tintColor: colors.ink },
  action: { ...text.bodyStrong, color: colors.markRing },
  dimAction: { color: colors.inkFaint },
  body: { paddingTop: 56, paddingBottom: spacing.space8 },
  editor: { flex: 1, paddingTop: 56, paddingBottom: spacing.space4 },
  inputFill: { flex: 1, textAlignVertical: 'top' },
  content: { ...text.displayL, letterSpacing: 0, color: colors.ink },
  input: {
    ...text.displayL,
    letterSpacing: 0,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space3,
  },
  error: { ...text.caption, color: colors.alarmText, marginTop: spacing.space4 },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space1,
    marginTop: spacing.space4,
  },
  sourceText: { ...text.caption, color: colors.inkMuted, flexShrink: 1 },
  openIcon: { width: 14, height: 14, tintColor: colors.markRing },
  rawToggle: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.space4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rawToggleText: { ...text.body, color: colors.inkMuted },
  expandIcon: { width: 16, height: 16, tintColor: colors.inkMuted },
  expandIconOpen: { transform: [{ rotate: '180deg' }] },
  raw: {
    ...text.body,
    color: colors.inkMuted,
    fontStyle: 'italic',
    marginTop: spacing.space3,
  },
  delete: { marginTop: spacing.space8 },
  deleteText: { ...text.body, color: colors.alarmText },
});
