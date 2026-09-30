import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Draft, DraftField } from '@/services/agent/agentDrafts';
import { colors, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';

import { TimeEntry } from './TimeEntry';

/**
 * One thing Kandoo Agent proposes to do, shown BEFORE it happens (AGENTS §3.3).
 * Colour carries state, as everywhere in Kandoo: an amber edge while it waits
 * for the user's eye, olive once saved; a delete waits on the alarm edge. The
 * user can correct any editable line in place, then say yes or tap Save.
 */

export type AgentDraftCardProps = {
  draft: Draft;
  onEdit: (field: DraftField, value: string) => void;
  onSave: () => void;
  onDiscard: () => void;
  onOpen: () => void;
  /** The map preview for a place (rendered by the caller, so this stays light). */
  mapPreview?: React.ReactNode;
};

/** What a finished card says, by what it did — a deletion is not "Saved". */
function doneLabel(tool: string): string {
  if (tool.startsWith('delete_')) return '✓ Deleted';
  if (tool.startsWith('merge_')) return '✓ Merged';
  if (tool === 'complete_reminder') return '✓ Done';
  if (tool === 'stop_watching_place') return '✓ Stopped';
  return '✓ Saved';
}

/** Fields that are labels or times read as UI; everything else is the user's words. */
const PLAIN_FIELDS = new Set(['person', 'for', 'keep', 'fold']);

function display(field: DraftField): string {
  if (field.kind === 'time') return formatDueDate(field.value) ?? 'Pick a time';
  return field.value ?? '—';
}

function FieldRow({ field, editable, onEdit }: { field: DraftField; editable: boolean; onEdit: (value: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(field.value ?? '');
  const canEdit = editable && field.editable;
  // What the user said is shown in Fraunces — their own words (AGENTS §7);
  // times and simple labels stay in the UI face.
  const valueStyle = field.kind === 'time' || PLAIN_FIELDS.has(field.key) ? styles.value : styles.words;

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{field.label}</Text>
      {editing && field.kind !== 'time' ? (
        <TextInput
          style={[valueStyle, styles.input]}
          value={draftText}
          onChangeText={setDraftText}
          autoFocus
          multiline={field.kind === 'long'}
          onBlur={() => {
            setEditing(false);
            const next = draftText.trim();
            if (next && next !== field.value) onEdit(next);
            else setDraftText(field.value ?? '');
          }}
        />
      ) : (
        <Pressable
          disabled={!canEdit}
          onPress={() => {
            setDraftText(field.value ?? '');
            setEditing(true);
          }}
          accessibilityRole={canEdit ? 'button' : undefined}
          accessibilityHint={canEdit ? 'Edit' : undefined}
        >
          <Text style={[valueStyle, canEdit && styles.editable]}>{display(field)}</Text>
        </Pressable>
      )}
      {field.kind === 'time' && canEdit ? (
        <TimeEntry
          visible={editing}
          initialISO={field.value}
          onClose={() => setEditing(false)}
          onSave={(iso) => {
            setEditing(false);
            onEdit(iso);
          }}
        />
      ) : null}
    </View>
  );
}

export function AgentDraftCard({ draft, onEdit, onSave, onDiscard, onOpen, mapPreview }: AgentDraftCardProps) {
  if (draft.status === 'discarded') {
    return <Text style={styles.discarded}>Not saved · {draft.title}</Text>;
  }
  const waiting = draft.status === 'draft';
  const saving = draft.status === 'saving';
  const saved = draft.status === 'saved';

  return (
    <View
      style={[
        styles.card,
        waiting && (draft.destructive ? styles.cardDestructive : styles.cardWaiting),
        saving && styles.cardWaiting,
        saved && styles.cardSaved,
      ]}
    >
      <View style={styles.head}>
        <Text style={[styles.title, draft.destructive && waiting && styles.titleDestructive, saved && styles.titleSaved]}>
          {draft.title}
        </Text>
        <Text style={[styles.status, saved && styles.titleSaved]}>
          {saved ? doneLabel(draft.tool) : saving ? 'Saving' : 'Check this'}
        </Text>
      </View>

      {mapPreview}

      {draft.fields.map((f) => (
        <FieldRow key={f.key} field={f} editable={waiting} onEdit={(value) => onEdit(f, value)} />
      ))}

      {draft.error ? <Text style={styles.error}>{draft.error}</Text> : null}

      {waiting ? (
        <View style={styles.actions}>
          <Pressable style={styles.secondary} onPress={onDiscard} accessibilityRole="button">
            <Text style={styles.secondaryText}>Not this</Text>
          </Pressable>
          <Pressable
            style={[styles.primary, draft.destructive && styles.primaryDestructive]}
            onPress={onSave}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryText, draft.destructive && styles.primaryTextDestructive]}>
              {draft.destructive ? 'Yes, do it' : 'Save'}
            </Text>
          </Pressable>
        </View>
      ) : saved && draft.open ? (
        <Pressable onPress={onOpen} accessibilityRole="link" hitSlop={8}>
          <Text style={styles.open}>Open</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
    padding: spacing.space4,
    gap: spacing.space3,
  },
  cardWaiting: { borderColor: colors.accent },
  cardDestructive: { borderColor: colors.alarm },
  cardSaved: { borderColor: colors.settledFill, backgroundColor: colors.settledWash },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...text.label, color: colors.markRing },
  titleDestructive: { color: colors.alarmText },
  titleSaved: { color: colors.settled },
  status: { ...text.caption, color: colors.inkMuted },
  field: { gap: 2 },
  fieldLabel: { ...text.caption, color: colors.inkMuted },
  value: { ...text.bodyStrong, color: colors.ink },
  words: { ...text.memory, color: colors.ink },
  editable: { textDecorationLine: 'underline', textDecorationColor: colors.lineStrong },
  input: {
    borderBottomWidth: 1,
    borderBottomColor: colors.accent,
    paddingVertical: 2,
  },
  error: { ...text.caption, color: colors.alarmText },
  actions: { flexDirection: 'row', gap: spacing.space2, marginTop: spacing.space1 },
  secondary: {
    minHeight: 44,
    paddingHorizontal: spacing.space4,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { ...text.bodyStrong, color: colors.inkMuted },
  primary: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.full,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryDestructive: { backgroundColor: colors.alarm },
  primaryText: { ...text.bodyStrong, color: colors.ink },
  primaryTextDestructive: { color: colors.surface },
  open: { ...text.bodyStrong, color: colors.settled },
  discarded: { ...text.caption, color: colors.inkFaint, textDecorationLine: 'line-through' },
});
