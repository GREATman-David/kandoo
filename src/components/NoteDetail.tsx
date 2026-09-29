import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useKeyboardLift } from '@/hooks/useKeyboardLift';
import {
  fetchCaptureNote,
  type CaptureNote,
  type CaptureNoteMemory,
  type CaptureNoteReminder,
  logFailure,
} from '@/services/interpretationService';
import { isLocalId, pendingCapture, saveNoteEdit, withPendingEdits } from '@/services/outbox';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';
import { shareNote } from '@/utils/share';

export type NoteDetailProps = {
  captureId: string | null;
  visible: boolean;
  onClose: () => void;
  /** Reload the caller's list after the note is edited. */
  onChanged?: () => void;
  /** Tap a person chip → their page. Absent → chips are display-only. */
  onOpenPerson?: (name: string) => void;
  /** Tap a reminder chip → its detail. Absent → chips are display-only. */
  onOpenReminder?: (reminder: CaptureNoteReminder) => void;
  /** Tap a remembered fact → its memory detail. Absent → read-only. */
  onOpenMemory?: (memory: CaptureNoteMemory) => void;
};

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  edit: require('@/assets/images/icons/pencil.png'),
  share: require('@/assets/images/icons/share.png'),
  expand: require('@/assets/images/icons/chevron-down.png'),
  person: require('@/assets/images/icons/chip-person.png'),
  time: require('@/assets/images/icons/chip-time.png'),
};

/** "Captured 2 hours ago" — a coarse relative time, device-local. */
function capturedAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'Just now';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${days < 14 ? '' : 's'} ago`;
  return `${Math.floor(days / 30)} month${days < 60 ? '' : 's'} ago`;
}

export function NoteDetail({
  captureId,
  visible,
  onClose,
  onChanged,
  onOpenPerson,
  onOpenReminder,
  onOpenMemory,
}: NoteDetailProps) {
  const insets = useSafeAreaInsets();
  // While typing, the editor ends at the top of the keyboard (see styles.editor).
  const keyboard = useKeyboardLift({ inModal: true });
  const [capture, setCapture] = useState<CaptureNote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !captureId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setShowRaw(false);
    setEditing(false);
    setSaveError(null);
    setCapture(null);
    // Saved on this phone and not synced yet: it lives in the outbox. Otherwise
    // the server's copy, with any edit still waiting to sync laid over it.
    const load: Promise<CaptureNote | null> = isLocalId(captureId)
      ? pendingCapture(captureId)
      : fetchCaptureNote(captureId).then(async (c) =>
          c ? ((await withPendingEdits([c]))[0] ?? c) : null
        );
    load
      .then((c) => {
        if (active) setCapture(c);
      })
      .catch((caught) => {
        logFailure('Loading note failed:', caught);
        if (active) setError('Could not load that note.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible, captureId]);

  const isManual = capture?.source === 'manual';

  const people = capture
    ? [
        ...new Set(
          [
            ...capture.memories.map((m) => m.person),
            ...capture.reminders.map((r) => r.person),
          ].filter((p): p is string => !!p)
        ),
      ]
    : [];

  function startEdit() {
    if (!capture?.note) return;
    setDraftTitle(capture.note.title);
    setDraftBody(capture.note.body);
    setSaveError(null);
    setEditing(true);
  }

  const canSave = draftTitle.trim().length > 0 && draftBody.trim().length > 0 && !saving;

  async function save() {
    if (!capture || !canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Saved on this phone at once; the outbox syncs it (no connection needed).
      await saveNoteEdit(capture.id, {
        title: draftTitle.trim(),
        body: draftBody.trim(),
      });
      // Reflect the edit locally without a round-trip; the memories are untouched.
      setCapture({
        ...capture,
        note: { title: draftTitle.trim(), body: draftBody.trim() },
      });
      setEditing(false);
      onChanged?.();
    } catch (caught) {
      // Only a failure to write to the phone's own storage lands here.
      logFailure('Saving the note edit on this phone failed:', caught);
      setSaveError('Could not save that edit on this phone. Please try again.');
    } finally {
      setSaving(false);
    }
  }

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
          {capture && editing ? (
            <Pressable onPress={save} hitSlop={12} disabled={!canSave}>
              <Text style={[styles.action, !canSave && styles.dimAction]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </Pressable>
          ) : capture ? (
            <View style={styles.barActions}>
              <Pressable
                onPress={() =>
                  void shareNote({
                    title: capture.note?.title ?? 'What I said',
                    body: capture.note?.body ?? capture.text,
                  })
                }
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Share note"
              >
                <Image source={ICONS.share} style={styles.barIcon} />
              </Pressable>
              {capture.note ? (
                <Pressable
                  onPress={startEdit}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Edit note"
                >
                  <Image source={ICONS.edit} style={styles.barIcon} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </View>

        {editing && capture ? (
          // Editing: the body box fills exactly the space between the title
          // and the keyboard, and scrolls inside itself, so Android keeps the
          // line being typed in view however long the note gets.
          <View style={styles.editor}>
            <TextInput
              style={styles.titleInput}
              value={draftTitle}
              onChangeText={setDraftTitle}
              placeholder="Title"
              placeholderTextColor={colors.inkFaint}
              underlineColorAndroid="transparent"
              returnKeyType="next"
            />
            <TextInput
              style={[styles.bodyInput, styles.bodyInputFill]}
              value={draftBody}
              onChangeText={setDraftBody}
              placeholder="Write it in your own words…"
              placeholderTextColor={colors.inkFaint}
              underlineColorAndroid="transparent"
              autoFocus
              multiline
              scrollEnabled
            />
            {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {loading ? (
              <Text style={styles.dim}>Loading…</Text>
            ) : error ? (
              <Text style={styles.error}>{error}</Text>
            ) : !capture ? (
              <Text style={styles.dim}>This note is no longer here.</Text>
            ) : (
              <>
                <Text style={styles.title} selectable>
                  {capture.note?.title ?? 'What you said'}
                </Text>
                <Text style={styles.captured}>
                  Captured {capturedAgo(capture.created_at).toLowerCase()}
                  {isManual ? ' · Written by you' : ''}
                </Text>

                <Text style={styles.noteBody} selectable>
                  {capture.note?.body ?? capture.text}
                </Text>

                {capture.memories.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={styles.eyebrow}>What Kandoo remembered</Text>
                    {capture.memories.map((m) => (
                      <Pressable
                        key={m.id}
                        style={styles.memoryRow}
                        onPress={() => onOpenMemory?.(m)}
                        disabled={!onOpenMemory}
                      >
                        <Text style={styles.memoryText} numberOfLines={2}>
                          {m.content}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                {/* A manual note infers nothing, so it has no Connections and no
                  separate "what you said" — the body IS what you wrote. */}
                {!isManual && (people.length > 0 || capture.reminders.length > 0) ? (
                  <View style={styles.section}>
                    <Text style={styles.eyebrow}>Connections</Text>
                    <View style={styles.chips}>
                      {people.map((p) => (
                        <Pressable
                          key={`p-${p}`}
                          style={styles.chip}
                          onPress={() => onOpenPerson?.(p)}
                          disabled={!onOpenPerson}
                        >
                          <Image source={ICONS.person} style={styles.chipIcon} />
                          <Text style={styles.chipText}>{p}</Text>
                        </Pressable>
                      ))}
                      {capture.reminders.map((r) => {
                        const when = formatDueDate(r.due_at) ?? r.place_hint;
                        return (
                          <Pressable
                            key={r.id}
                            style={styles.chip}
                            onPress={() => onOpenReminder?.(r)}
                            disabled={!onOpenReminder}
                          >
                            <Image source={ICONS.time} style={styles.chipIcon} />
                            <Text style={styles.chipText}>
                              {r.task}
                              {when ? ` · ${when}` : ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                ) : null}

                {!isManual && capture.note ? (
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
                    {showRaw ? (
                      <Text style={styles.raw} selectable>
                        {capture.text}
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // Note detail (Figma: kandoo-note-detail).
  screen: {
    flex: 1,
    backgroundColor: colors.base,
  },
  barActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.space5 },
  bar: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.space5,
  },
  barIcon: {
    width: 20,
    height: 20,
    tintColor: colors.ink,
  },
  action: { ...text.bodyStrong, color: colors.markRing },
  dimAction: { color: colors.inkFaint },
  body: {
    paddingHorizontal: spacing.space5,
    paddingTop: 20,
    paddingBottom: spacing.space8,
  },
  dim: {
    ...text.body,
    color: colors.inkFaint,
    marginTop: spacing.space6,
  },
  error: {
    ...text.body,
    color: colors.alarmText,
    marginTop: spacing.space4,
  },
  title: {
    ...text.answer,
    color: colors.ink,
  },
  titleInput: {
    ...text.answer,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space2,
  },
  captured: {
    fontFamily: fontFamily.textRegular,
    fontSize: 12,
    lineHeight: 16,
    color: colors.inkMuted,
    marginTop: spacing.space2,
    marginBottom: spacing.space5,
  },
  noteBody: {
    ...text.memory,
    color: colors.ink,
  },
  editor: {
    flex: 1,
    paddingHorizontal: spacing.space5,
    paddingTop: 20,
    paddingBottom: spacing.space4,
  },
  bodyInputFill: { flex: 1, minHeight: 0 },
  bodyInput: {
    ...text.memory,
    color: colors.ink,
    marginTop: spacing.space4,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.space3,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  section: {
    marginTop: spacing.space6,
  },
  eyebrow: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    marginBottom: spacing.space3,
  },
  memoryRow: {
    paddingVertical: spacing.space3,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  memoryText: { ...text.memory, color: colors.ink },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.space2,
  },
  chip: {
    maxWidth: '100%',
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.accentWash,
  },
  chipIcon: {
    width: 12,
    height: 12,
    tintColor: colors.markRing,
  },
  chipText: {
    ...text.caption,
    flexShrink: 1,
    color: colors.ink,
  },
  rawToggle: {
    marginTop: spacing.space6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.space4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rawToggleText: {
    ...text.body,
    color: colors.inkMuted,
  },
  expandIcon: {
    width: 16,
    height: 16,
    tintColor: colors.inkMuted,
  },
  expandIconOpen: {
    transform: [{ rotate: '180deg' }],
  },
  raw: {
    ...text.body,
    color: colors.inkMuted,
    fontStyle: 'italic',
    marginTop: spacing.space3,
  },
});
