import { useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchPerson,
  type CreatedReminder,
  type PersonDetail as PersonDetailData,
  type PersonReminder,
  logFailure,
} from '@/services/interpretationService';
import { useEntitlement } from '@/hooks/useEntitlement';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';
import { formatDueDate } from '@/utils/formatDueDate';
import { timeAgo } from '@/utils/timeAgo';

import { LockedRow } from './LockedRow';
import { NoteDetail } from './NoteDetail';
import { Paywall } from './Paywall';
import { ReminderDetail } from './ReminderDetail';

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

const ICONS = {
  back: require('@/assets/images/icons/chevron-left.png'),
  open: require('@/assets/images/icons/chevron-right.png'),
};

/** One tappable line in a section: serif text, optional meta, gold chevron. */
function Row({
  title,
  meta,
  onPress,
}: {
  title: string;
  meta?: string | null;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress} accessibilityRole="button">
      <View style={styles.rowMain}>
        <Text style={styles.rowText} numberOfLines={3}>
          {title}
        </Text>
        {meta ? <Text style={styles.rowMeta}>{meta}</Text> : null}
      </View>
      <Image source={ICONS.open} style={styles.rowIcon} />
    </Pressable>
  );
}
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
  const insets = useSafeAreaInsets();
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
        logFailure('Loading person failed:', caught);
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
        <View style={[styles.bar, { marginTop: insets.top + spacing.space4 }]}>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Image source={ICONS.back} style={styles.barIcon} />
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
                    <Row
                      key={m.id}
                      title={m.content}
                      onPress={() => m.capture_id && setNoteId(m.capture_id)}
                    />
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
                    <Row
                      key={r.id}
                      title={r.task}
                      meta={formatDueDate(r.due_at) ?? 'No time set'}
                      onPress={() => setReminder(toReminder(r, person.name))}
                    />
                  ))}
                </View>
              ) : null}

              {person.notes.length > 0 ? (
                <View style={styles.section}>
                  <Text style={styles.eyebrow}>Mentioned in</Text>
                  {person.notes.map((n) => (
                    <Row
                      key={n.id}
                      title={n.title ?? 'A note'}
                      meta={timeAgo(n.created_at)}
                      onPress={() => setNoteId(n.id)}
                    />
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

// Person profile (Figma: kandoo-jed-profile).
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center' },
  barIcon: { width: 20, height: 20, tintColor: colors.ink },
  body: { paddingTop: 20, paddingBottom: spacing.space8 },
  dim: { ...text.body, color: colors.inkFaint, marginTop: spacing.space6 },
  error: { ...text.body, color: colors.alarmText, marginTop: spacing.space6 },
  head: { alignItems: 'center', marginBottom: spacing.space6 },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    backgroundColor: colors.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.space3,
  },
  avatarText: {
    fontFamily: fontFamily.textSemiBold,
    fontSize: 24,
    lineHeight: 30,
    color: colors.markRing,
  },
  name: { ...text.displayL, letterSpacing: 0, color: colors.ink, textAlign: 'center' },
  counts: { ...text.caption, color: colors.inkMuted, marginTop: 6, textAlign: 'center' },
  section: { marginBottom: spacing.space6 },
  eyebrow: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    marginBottom: spacing.space1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.space3,
    paddingVertical: spacing.space3,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  rowMain: { flex: 1, gap: spacing.space1 },
  rowText: {
    fontFamily: fontFamily.displayRegular,
    fontSize: 16,
    lineHeight: 24,
    color: colors.ink,
  },
  rowMeta: { ...text.caption, color: colors.inkMuted },
  rowIcon: { width: 16, height: 16, tintColor: colors.markRing },
});
