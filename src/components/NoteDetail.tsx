import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  fetchCaptureNote,
  updateCaptureNote,
  type CaptureNote,
  type CaptureNoteMemory,
  type CaptureNoteReminder,
  userMessage,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';

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
    fetchCaptureNote(captureId)
      .then((c) => {
        if (active) setCapture(c);
      })
      .catch((caught) => {
        console.error('Loading note failed:', caught);
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

  const canSave =
    draftTitle.trim().length > 0 && draftBody.trim().length > 0 && !saving;

  async function save() {
    if (!capture || !canSave) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateCaptureNote(capture.id, {
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
      console.error('Editing note failed:', caught);
      setSaveError(
        userMessage(caught, 'Could not save that edit.')
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          {capture?.note ? (
            editing ? (
              <Pressable onPress={save} hitSlop={12} disabled={!canSave}>
                <Text style={[styles.action, !canSave && styles.dimAction]}>
                  {saving ? 'Saving…' : 'Save'}
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={startEdit} hitSlop={12}>
                <Text style={styles.action}>Edit</Text>
              </Pressable>
            )
          ) : null}
        </View>

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
          ) : editing ? (
            <>
              <TextInput
                style={styles.titleInput}
                value={draftTitle}
                onChangeText={setDraftTitle}
                placeholder="Title"
                placeholderTextColor={colors.inkFaint}
                autoFocus
              />
              <TextInput
                style={styles.bodyInput}
                value={draftBody}
                onChangeText={setDraftBody}
                placeholder="Write it in your own words…"
                placeholderTextColor={colors.inkFaint}
                multiline
              />
              {saveError ? <Text style={styles.error}>{saveError}</Text> : null}
            </>
          ) : (
            <>
              <Text style={styles.title}>
                {capture.note?.title ?? 'What you said'}
              </Text>
              <Text style={styles.captured}>
                Captured {capturedAgo(capture.created_at)}
                {isManual ? ' · Written by you' : ''}
              </Text>

              <Text style={styles.noteBody}>
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
              {!isManual &&
              (people.length > 0 || capture.reminders.length > 0) ? (
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
                  >
                    <Text style={styles.rawToggleText}>
                      {showRaw ? 'Hide what you said' : 'What you said'}
                    </Text>
                  </Pressable>
                  {showRaw ? <Text style={styles.raw}>{capture.text}</Text> : null}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.base,
  },
  bar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: spacing.space7,
    paddingHorizontal: spacing.space4,
    paddingBottom: spacing.space2,
  },
  back: {
    ...text.body,
    color: colors.inkMuted,
  },
  action: { ...text.bodyStrong, color: colors.accent },
  dimAction: { color: colors.inkFaint },
  body: {
    paddingHorizontal: spacing.space4,
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
    ...text.displayL,
    color: colors.ink,
    marginTop: spacing.space2,
  },
  titleInput: {
    ...text.displayL,
    color: colors.ink,
    marginTop: spacing.space2,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space2,
  },
  captured: {
    ...text.caption,
    color: colors.inkMuted,
    marginTop: spacing.space1,
    marginBottom: spacing.space4,
  },
  noteBody: {
    ...text.answer,
    color: colors.ink,
  },
  bodyInput: {
    ...text.answer,
    color: colors.ink,
    marginTop: spacing.space4,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.space3,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  section: {
    marginTop: spacing.space6,
  },
  eyebrow: {
    ...text.label,
    color: colors.inkMuted,
    marginBottom: spacing.space3,
  },
  memoryRow: {
    paddingVertical: spacing.space3,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  memoryText: { ...text.body, color: colors.ink },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.space2,
  },
  chip: {
    maxWidth: '100%',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  chipText: {
    ...text.caption,
    color: colors.inkMuted,
  },
  rawToggle: {
    marginTop: spacing.space6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.space4,
  },
  rawToggleText: {
    ...text.caption,
    color: colors.inkMuted,
  },
  raw: {
    ...text.body,
    color: colors.inkMuted,
    fontStyle: 'italic',
    marginTop: spacing.space3,
  },
});
