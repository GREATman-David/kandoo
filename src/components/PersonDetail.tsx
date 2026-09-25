import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  fetchPerson,
  type CreatedReminder,
  type PersonDetail as PersonDetailData,
  type PersonReminder,
} from '@/services/interpretationService';
import { useEntitlement } from '@/hooks/useEntitlement';
import { colors, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';

import { LockedRow } from './LockedRow';
import { NoteDetail } from './NoteDetail';
import { Paywall } from './Paywall';
import { ReminderDetail } from './ReminderDetail';

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;
const isOld = (iso: string) => Date.now() - Date.parse(iso) > TEN_DAYS_MS;

export type PersonDetailProps = {
  personId: string | null;
  visible: boolean;
  onClose: () => void;
  /** Refetch the People list after a change (e.g. a reminder edited here). */
  onChanged: () => void;
};

function initial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

/** PersonReminder carries only what People needs; fill the rest so it opens in
 *  the shared ReminderDetail. */
function toReminder(p: PersonReminder, personName: string): CreatedReminder {
  return {
    id: p.id,
    task: p.task,
    person: personName,
    due_at: p.due_at,
    place_hint: null,
    place_id: null,
    insistent: false,
    status: p.status,
    created_at: p.created_at,
    capture_id: p.capture_id,
  };
}

export function PersonDetail({
  personId,
  visible,
  onClose,
  onChanged,
}: PersonDetailProps) {
  const { isPro, refresh } = useEntitlement();
  const [person, setPerson] = useState<PersonDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteId, setNoteId] = useState<string | null>(null);
  const [reminder, setReminder] = useState<CreatedReminder | null>(null);
  const [paywall, setPaywall] = useState(false);

  const load = () => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    fetchPerson(personId)
      .then(setPerson)
      .catch((caught) => {
        console.error('Loading person failed:', caught);
        setError('Could not load that person.');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (visible && personId) {
      setPerson(null);
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, personId]);

  const recentMemories = person
    ? person.memories.filter((m) => isPro || !isOld(m.created_at))
    : [];
  const lockedMemories = person
    ? person.memories.filter((m) => !isPro && isOld(m.created_at))
    : [];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.bar}>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
          {loading ? (
            <Text style={styles.dim}>Loading…</Text>
          ) : error ? (
            <Text style={styles.error}>{error}</Text>
          ) : !person ? (
            <Text style={styles.dim}>This person is no longer here.</Text>
          ) : (
            <>
              <View style={styles.head}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initial(person.name)}</Text>
                </View>
                <Text style={styles.name}>{person.name}</Text>
                <Text style={styles.counts}>
                  {countLine(
                    person.memories.length,
                    person.reminders.length,
                    person.notes.length
                  )}
                </Text>
              </View>

              {person.memories.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.eyebrow}>What you know</Text>
                  {recentMemories.map((m) => (
                    <Pressable
                      key={m.id}
                      style={styles.row}
                      onPress={() => m.capture_id && setNoteId(m.capture_id)}
                    >
                      <Text style={styles.rowText} numberOfLines={2}>
                        {m.content}
                      </Text>
                    </Pressable>
                  ))}
                  {lockedMemories.map((m) => (
                    <LockedRow key={m.id} title={m.content} onPress={() => setPaywall(true)} />
                  ))}
                </View>
              ) : null}

              {person.reminders.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.eyebrow}>What you promised</Text>
                  {person.reminders.map((r) => (
                    <Pressable
                      key={r.id}
                      style={styles.row}
                      onPress={() => setReminder(toReminder(r, person.name))}
                    >
                      <Text style={styles.rowText} numberOfLines={1}>
                        {r.task}
                      </Text>
                      <Text style={styles.rowMeta}>
                        {formatDueDate(r.due_at) ?? 'No time set'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}

              {person.notes.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.eyebrow}>Mentioned in</Text>
                  {person.notes.map((n) => (
                    <Pressable key={n.id} style={styles.row} onPress={() => setNoteId(n.id)}>
                      <Text style={styles.rowText} numberOfLines={1}>
                        {n.title ?? 'A note'}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </View>

      <NoteDetail captureId={noteId} visible={noteId !== null} onClose={() => setNoteId(null)} />

      <ReminderDetail
        reminder={reminder}
        visible={reminder !== null}
        onClose={() => setReminder(null)}
        onChanged={() => {
          onChanged();
          load();
        }}
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
    </Modal>
  );
}

function countLine(m: number, r: number, n: number): string {
  const parts: string[] = [];
  if (m) parts.push(`${m} memor${m === 1 ? 'y' : 'ies'}`);
  if (r) parts.push(`${r} reminder${r === 1 ? '' : 's'}`);
  if (n) parts.push(`${n} note${n === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Nothing yet';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space4 },
  bar: { paddingTop: spacing.space7, paddingBottom: spacing.space2 },
  back: { ...text.body, color: colors.inkMuted },
  body: { paddingBottom: spacing.space8 },
  dim: { ...text.body, color: colors.inkFaint, marginTop: spacing.space6 },
  error: { ...text.body, color: colors.alarmText, marginTop: spacing.space6 },
  head: { alignItems: 'center', marginTop: spacing.space4, marginBottom: spacing.space6 },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    backgroundColor: colors.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.space3,
  },
  avatarText: { ...text.displayL, color: colors.settled },
  name: { ...text.displayL, color: colors.ink },
  counts: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space1 },
  section: { marginBottom: spacing.space6 },
  eyebrow: { ...text.label, color: colors.inkMuted, marginBottom: spacing.space2 },
  row: { paddingVertical: spacing.space3, borderTopWidth: 1, borderTopColor: colors.line },
  rowText: { ...text.body, color: colors.ink },
  rowMeta: { ...text.caption, color: colors.inkMuted, marginTop: 2 },
});
