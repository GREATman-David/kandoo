import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useKeyboardLift } from '@/hooks/useKeyboardLift';

import { logFailure } from '@/services/interpretationService';
import { saveManual } from '@/services/outbox';
import { colors, radius, spacing, text } from '@/theme/theme';

type Mode = 'note' | 'memory' | 'both';

export type ManualEntryProps = {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
};

/**
 * "+ Add something new" — a note, a memory, or both, typed by hand. Extraction
 * is off (the user gives structure directly), but the memory is still embedded
 * server-side so recall can find it. Both writes one capture; the note carries a
 * "Written by you" mark downstream, and a manual note has no Connections because
 * nothing was inferred from it.
 */
export function ManualEntry({ visible, onClose, onCreated }: ManualEntryProps) {
  // While typing, the form ends at the top of the keyboard and the writing box
  // takes all the room there is (see styles.form / styles.fill).
  const keyboard = useKeyboardLift({ inModal: true });
  const typing = keyboard.keyboardOpen;
  const [mode, setMode] = useState<Mode>('note');
  const [title, setTitle] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [memory, setMemory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setMode('note');
      setTitle('');
      setBodyText('');
      setMemory('');
      setError(null);
    }
  }, [visible]);

  const wantsNote = mode === 'note' || mode === 'both';
  const wantsMemory = mode === 'memory' || mode === 'both';

  const noteReady = title.trim().length > 0 && bodyText.trim().length > 0;
  const memoryReady = memory.trim().length > 0;
  const canSave =
    !busy &&
    ((wantsNote && wantsMemory && noteReady && memoryReady) ||
      (mode === 'note' && noteReady) ||
      (mode === 'memory' && memoryReady));

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      // Saved on this phone first — no connection needed. The outbox sends it
      // to the server in the background (src/services/outbox.ts).
      await saveManual({
        note: wantsNote ? { title: title.trim(), body: bodyText.trim() } : undefined,
        memory: wantsMemory ? { content: memory.trim() } : undefined,
      });
      onCreated();
      onClose();
    } catch (caught) {
      // Only a failure to write to the phone's own storage lands here.
      logFailure('Saving on this phone failed:', caught);
      setError('Could not save that on this phone. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View ref={keyboard.ref} style={[styles.screen, { paddingBottom: keyboard.lift }]}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.heading}>Add something</Text>
          <Pressable onPress={save} hitSlop={12} disabled={!canSave}>
            <Text style={[styles.save, !canSave && styles.dim]}>{busy ? 'Saving…' : 'Save'}</Text>
          </Pressable>
        </View>

        {/* The Note / Memory / Both switch and the field labels step aside while
            the keyboard is up, so the words being typed get the room. */}
        {typing ? null : (
          <View style={styles.segment}>
            {(['note', 'memory', 'both'] as Mode[]).map((m) => (
              <Pressable
                key={m}
                style={[styles.segmentItem, mode === m && styles.segmentActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.segmentText, mode === m && styles.segmentTextActive]}>
                  {m === 'note' ? 'Note' : m === 'memory' ? 'Memory' : 'Both'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* The writing boxes fill the space down to the keyboard and scroll
            inside themselves, so Android keeps the line being typed in view. */}
        <View style={styles.form}>
          {wantsNote ? (
            <>
              {typing ? null : <Text style={styles.fieldLabel}>Note</Text>}
              <TextInput
                style={styles.titleInput}
                value={title}
                onChangeText={setTitle}
                placeholder="Title"
                placeholderTextColor={colors.inkFaint}
                underlineColorAndroid="transparent"
                autoFocus={mode === 'note' || mode === 'both'}
              />
              <TextInput
                style={[styles.bodyInput, styles.fill]}
                value={bodyText}
                onChangeText={setBodyText}
                placeholder="Write it in your own words…"
                placeholderTextColor={colors.inkFaint}
                underlineColorAndroid="transparent"
                multiline
                scrollEnabled
              />
            </>
          ) : null}

          {wantsMemory ? (
            <>
              {typing ? null : <Text style={styles.fieldLabel}>Memory</Text>}
              <TextInput
                // Alone it fills the screen; under a note it keeps a fixed
                // height and scrolls inside itself.
                style={[styles.bodyInput, wantsNote ? styles.memoryBelowNote : styles.fill]}
                value={memory}
                onChangeText={setMemory}
                placeholder="One thing to remember…"
                placeholderTextColor={colors.inkFaint}
                underlineColorAndroid="transparent"
                autoFocus={mode === 'memory'}
                multiline
                scrollEnabled
              />
            </>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
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
    paddingBottom: spacing.space5,
  },
  cancel: { ...text.body, color: colors.inkMuted },
  heading: { ...text.bodyStrong, color: colors.ink },
  save: { ...text.bodyStrong, color: colors.accent },
  dim: { color: colors.inkFaint },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: 3,
    marginBottom: spacing.space5,
  },
  segmentItem: {
    flex: 1,
    paddingVertical: spacing.space2,
    borderRadius: radius.sm,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { ...text.caption, color: colors.inkMuted },
  segmentTextActive: { color: colors.ink },
  form: { flex: 1, paddingBottom: spacing.space4 },
  fill: { flex: 1, minHeight: 0 },
  memoryBelowNote: { height: 110, minHeight: 0 },
  fieldLabel: {
    ...text.label,
    color: colors.inkMuted,
    marginBottom: spacing.space2,
    marginTop: spacing.space3,
  },
  titleInput: {
    ...text.displayL,
    color: colors.ink,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    paddingBottom: spacing.space2,
    marginBottom: spacing.space4,
  },
  bodyInput: {
    ...text.body,
    color: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: spacing.space3,
    minHeight: 96,
    textAlignVertical: 'top',
    marginBottom: spacing.space4,
  },
  error: { ...text.caption, color: colors.alarmText, marginTop: spacing.space2 },
});
