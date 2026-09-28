import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { OfflineNote } from '@/components/OfflineNote';
import { PersonDetail } from '@/components/PersonDetail';
import {
  deletePerson,
  fetchPeople,
  mergePeople,
  type PersonSummary,
  userMessage,
  logFailure,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';

import { useAuth } from '../features/Auth/useAuth';

export default function PeopleScreen() {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();

  const [people, setPeople] = useState<PersonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  // Merge mode: the long-pressed person is the survivor; the user multi-selects
  // the others to fold into them.
  const [survivor, setSurvivor] = useState<PersonSummary | null>(null);
  const [picks, setPicks] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(null);
    try {
      setPeople(await fetchPeople());
    } catch (caught) {
      logFailure('Loading people failed:', caught);
      setError(userMessage(caught, 'Could not load people.'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh on focus, not just on mount, so a person newly learned from a capture
  // made on another tab appears without relaunching. Silent reload (no spinner).
  useFocusEffect(
    useCallback(() => {
      if (isAuthenticated) load();
      else setLoading(false);
    }, [isAuthenticated, load])
  );

  const longPress = (person: PersonSummary) => {
    Alert.alert(person.name, undefined, [
      { text: 'Merge with…', onPress: () => startMerge(person) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => confirmDelete(person),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const startMerge = (person: PersonSummary) => {
    setSurvivor(person);
    setPicks(new Set());
  };

  const cancelMerge = () => {
    setSurvivor(null);
    setPicks(new Set());
  };

  const togglePick = (id: string) => {
    setPicks((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const confirmMerge = () => {
    if (!survivor || picks.size === 0) return;
    const others = people.filter((p) => picks.has(p.id));
    const names = others.map((p) => p.name).join(' and ');
    Alert.alert(
      'Merge people?',
      `${names} will be merged into ${survivor.name}. All memories, reminders and notes move across.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Merge',
          onPress: async () => {
            try {
              await mergePeople(survivor.id, [...picks]);
              cancelMerge();
              await load();
            } catch (caught) {
              logFailure('Merge failed:', caught);
              Alert.alert('Couldn’t merge', 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const confirmDelete = (person: PersonSummary) => {
    Alert.alert(
      'Delete this person?',
      `${person.name} will be removed. Their memories and reminders are kept, just no longer attributed to anyone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deletePerson(person.id);
              await load();
            } catch (caught) {
              logFailure('Delete person failed:', caught);
              Alert.alert('Couldn’t delete', 'Please try again.');
            }
          },
        },
      ]
    );
  };

  const merging = survivor !== null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.space4 }]}>
      <Text style={styles.heading}>People</Text>
      <OfflineNote />
      <Text style={styles.sub}>People Kandoo knows from what you’ve said.</Text>

      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingBottom: insets.bottom + spacing.space8 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {!isAuthenticated ? (
          <Text style={styles.dim}>Sign in to see your people.</Text>
        ) : loading ? (
          <Text style={styles.dim}>Loading…</Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : people.length === 0 ? (
          <EmptyState
            line="No one yet."
            help="Kandoo learns people from what you say."
          />
        ) : (
          people.map((person) => {
            const isSurvivor = survivor?.id === person.id;
            const picked = picks.has(person.id);
            return (
              <Pressable
                key={person.id}
                style={[styles.row, picked && styles.rowPicked]}
                onPress={() =>
                  merging
                    ? isSurvivor
                      ? undefined
                      : togglePick(person.id)
                    : setSelected(person.id)
                }
                onLongPress={() => (merging ? undefined : longPress(person))}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {person.name.trim().charAt(0).toUpperCase() || '?'}
                  </Text>
                </View>
                <View style={styles.rowMain}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{person.name}</Text>
                    {person.hasActiveReminder ? <ClockGlyph /> : null}
                    {merging && isSurvivor ? (
                      <Text style={styles.survivorTag}>keeps everything</Text>
                    ) : null}
                    {merging && picked ? <Text style={styles.pickTag}>✓</Text> : null}
                  </View>
                  {person.summary ? (
                    <Text style={styles.summary} numberOfLines={1}>
                      {person.summary}
                    </Text>
                  ) : null}
                  <Text style={styles.counts}>{countLine(person)}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {merging ? (
        <View style={[styles.mergeBar, { bottom: insets.bottom + spacing.space5 }]}>
          <Text style={styles.mergeText}>
            Merge into {survivor?.name} · {picks.size} selected
          </Text>
          <View style={styles.mergeActions}>
            <Pressable onPress={cancelMerge} hitSlop={8}>
              <Text style={styles.mergeCancel}>Cancel</Text>
            </Pressable>
            <Pressable onPress={confirmMerge} hitSlop={8} disabled={picks.size === 0}>
              <Text style={[styles.mergeConfirm, picks.size === 0 && styles.dimText]}>
                Merge
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <PersonDetail
        personId={selected}
        visible={selected !== null}
        onClose={() => setSelected(null)}
        onChanged={load}
      />
    </View>
  );
}

function countLine(p: PersonSummary): string {
  const parts: string[] = [];
  if (p.memoryCount) parts.push(`${p.memoryCount} memor${p.memoryCount === 1 ? 'y' : 'ies'}`);
  if (p.reminderCount) parts.push(`${p.reminderCount} reminder${p.reminderCount === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Mentioned';
}

/** A small clock, drawn from Views — shown when the person has an active reminder. */
function ClockGlyph() {
  return (
    <View style={styles.clock}>
      <View style={styles.clockHandV} />
      <View style={styles.clockHandH} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space4 },
  heading: { ...text.displayXl, color: colors.ink },
  sub: { ...text.body, color: colors.inkMuted, marginTop: spacing.space1, marginBottom: spacing.space4 },
  body: { paddingTop: spacing.space2 },
  dim: { ...text.body, color: colors.inkFaint, marginTop: spacing.space8, textAlign: 'center' },
  error: { ...text.body, color: colors.alarmText, marginTop: spacing.space8, textAlign: 'center' },

  row: {
    flexDirection: 'row',
    gap: spacing.space3,
    paddingVertical: spacing.space3,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  rowPicked: { backgroundColor: colors.accentWash, borderRadius: radius.md, borderTopWidth: 0, paddingHorizontal: spacing.space3 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...text.bodyStrong, color: colors.settled },
  rowMain: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.space2 },
  name: { ...text.bodyStrong, color: colors.ink },
  survivorTag: { ...text.caption, color: colors.settled },
  pickTag: { ...text.bodyStrong, color: colors.accent },
  summary: { ...text.body, color: colors.inkMuted, marginTop: 2 },
  counts: { ...text.caption, color: colors.inkFaint, marginTop: 2 },

  clock: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.accent,
  },
  clockHandV: { position: 'absolute', width: 1.4, height: 4, backgroundColor: colors.accent, left: 4.6, top: 2 },
  clockHandH: { position: 'absolute', width: 3.4, height: 1.4, backgroundColor: colors.accent, left: 5.3, top: 5.3 },

  mergeBar: {
    position: 'absolute',
    left: spacing.space4,
    right: spacing.space4,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
    gap: spacing.space2,
  },
  mergeText: { ...text.caption, color: colors.ink },
  mergeActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.space5 },
  mergeCancel: { ...text.bodyStrong, color: colors.inkMuted },
  mergeConfirm: { ...text.bodyStrong, color: colors.accent },
  dimText: { color: colors.inkFaint },
});
