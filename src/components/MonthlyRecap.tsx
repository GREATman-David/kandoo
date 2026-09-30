import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { formatDuration, timeByPlace, type MonthWindow, type PlaceTime } from '@/features/places/monthRecap';
import { useEntitlement } from '@/hooks/useEntitlement';
import {
  fetchMonthInsights,
  logFailure,
  type MonthInsights,
} from '@/services/interpretationService';
import { readPlaceState } from '@/services/places/placeStore';
import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';

/**
 * "Your September with Kandoo" — arrives on the 1st by itself, or opened any
 * time for the month so far. Where the month went comes from the phone's own
 * visit log (it never left the phone); who was on the user's mind and what
 * they kept comes from the server as counts.
 *
 * Forms (see the dataviz method): the totals are stat tiles — one number
 * each, not a chart. Time per place is a single-series bar list in one hue,
 * with its value written beside each bar in ink, so there is no legend and
 * nothing depends on colour alone.
 */

const BACK = require('@/assets/images/icons/chevron-left.png');
const TOP = 5;

export type MonthlyRecapProps = {
  month: MonthWindow | null;
  onClose: () => void;
  onOpenPlace: (placeId: string) => void;
};

export function MonthlyRecap({ month, onClose, onOpenPlace }: MonthlyRecapProps) {
  const insets = useSafeAreaInsets();
  const { isPro } = useEntitlement();
  const [insights, setInsights] = useState<MonthInsights | null>(null);
  const [places, setPlaces] = useState<PlaceTime[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!month) return;
    let active = true;
    setInsights(null);
    setError(false);
    void readPlaceState()
      .then((state) => {
        if (active) setPlaces(timeByPlace(state.visits, state.names, month.from, month.to).slice(0, TOP));
      })
      .catch((caught) => logFailure('Reading visits for the recap failed:', caught));
    fetchMonthInsights(month.from, month.to)
      .then((i) => active && setInsights(i))
      .catch((caught) => {
        logFailure('Loading the month failed:', caught);
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [month]);

  const ongoing = month ? Date.now() < month.to.getTime() : false;
  const longest = places[0]?.ms ?? 0;

  return (
    <Modal visible={month !== null} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space4 }]}>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <Image source={BACK} style={styles.back} />
        </Pressable>

        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing.space8 }} showsVerticalScrollIndicator={false}>
          <Text style={styles.eyebrow}>{ongoing ? `${month?.label} so far` : `Your ${month?.label}`}</Text>
          <Text style={styles.title}>
            {insights
              ? insights.memories > 0
                ? `A month of ${insights.memories} ${insights.memories === 1 ? 'memory' : 'memories'}.`
                : 'A quiet month.'
              : error
                ? 'Your month.'
                : ' '}
          </Text>

          {insights ? (
            <View style={styles.tiles}>
              <Tile value={insights.memories} label={insights.memories === 1 ? 'memory kept' : 'memories kept'} />
              <Tile value={insights.remindersSet} label={insights.remindersSet === 1 ? 'reminder set' : 'reminders set'} />
              <Tile value={insights.remindersDone} label="done" />
            </View>
          ) : error ? (
            <Text style={styles.quiet}>Couldn’t reach Kandoo for the rest of your month. Try again in a moment.</Text>
          ) : null}

          <Text style={styles.section}>Where you spent your time</Text>
          {places.length > 0 ? (
            places.map((p) => (
              <Pressable key={p.id} style={styles.barRow} onPress={() => onOpenPlace(p.id)} accessibilityRole="button">
                <View style={styles.barHead}>
                  <Text style={styles.barName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.barValue}>
                    {formatDuration(p.ms)}
                    {p.visits ? ` · ${p.visits} ${p.visits === 1 ? 'visit' : 'visits'}` : ''}
                  </Text>
                </View>
                <View style={styles.track}>
                  <View style={[styles.bar, { width: `${Math.max(4, (p.ms / (longest || 1)) * 100)}%` }]} />
                </View>
              </Pressable>
            ))
          ) : (
            <Text style={styles.quiet}>
              {isPro
                ? 'Draw the places that matter to you, and next month Kandoo will show where your time went.'
                : 'With Places (Kandoo Pro), your month shows where your time went — kept only on this phone.'}
            </Text>
          )}

          {insights && insights.people.length > 0 ? (
            <>
              <Text style={styles.section}>Who was on your mind</Text>
              {insights.people.map((person, i) => (
                <View key={person.id} style={[styles.row, i > 0 && styles.rowDivider]}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{person.name.trim().charAt(0).toUpperCase() || '?'}</Text>
                  </View>
                  <Text style={styles.rowName}>{person.name}</Text>
                  <Text style={styles.rowCount}>
                    {person.count} {person.count === 1 ? 'mention' : 'mentions'}
                  </Text>
                </View>
              ))}
            </>
          ) : null}

          {insights && places.length === 0 && insights.placesMentioned.length > 0 ? (
            <>
              <Text style={styles.section}>Places you talked about</Text>
              {insights.placesMentioned.map((p, i) => (
                <Pressable key={p.id} style={[styles.row, i > 0 && styles.rowDivider]} onPress={() => onOpenPlace(p.id)}>
                  <Text style={styles.rowName}>{p.name}</Text>
                  <Text style={styles.rowCount}>
                    {p.count} {p.count === 1 ? 'mention' : 'mentions'}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}

          <Text style={styles.motto}>Yes You Kan</Text>
          <Text style={styles.privacy}>Where you went is worked out on this phone and never sent anywhere.</Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  back: { width: 20, height: 20, tintColor: colors.ink, marginBottom: spacing.space5 },
  eyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  title: { ...text.displayXl, color: colors.ink, marginTop: spacing.space2, marginBottom: spacing.space5 },
  quiet: { ...text.body, color: colors.inkMuted, marginBottom: spacing.space2 },

  tiles: { flexDirection: 'row', gap: spacing.space2 },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.space4,
    paddingHorizontal: spacing.space3,
  },
  // The headline numbers are display type; labels stay in muted ink.
  tileValue: { fontFamily: fontFamily.displaySemiBold, fontSize: 30, lineHeight: 34, color: colors.ink },
  tileLabel: { ...text.caption, color: colors.inkMuted, marginTop: spacing.space1 },

  section: {
    ...text.label,
    letterSpacing: 1.5,
    color: colors.markRing,
    marginTop: spacing.space7,
    marginBottom: spacing.space3,
  },

  barRow: { paddingVertical: spacing.space2 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.space3 },
  barName: { flex: 1, fontFamily: fontFamily.displaySemiBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  barValue: { ...text.caption, color: colors.inkMuted },
  track: { height: 8, marginTop: spacing.space2, borderRadius: 4, backgroundColor: colors.surfaceRaised },
  // One series, one hue; settled = "this happened".
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.settledFill },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.space3, paddingVertical: spacing.space3 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.accentWash,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { ...text.bodyStrong, color: colors.markRing },
  rowName: { flex: 1, fontFamily: fontFamily.displaySemiBold, fontSize: 17, lineHeight: 22, color: colors.ink },
  rowCount: { ...text.caption, color: colors.inkMuted },

  motto: { ...text.motto, color: colors.markRing, textAlign: 'center', marginTop: spacing.space8 },
  privacy: { ...text.caption, color: colors.inkMuted, textAlign: 'center', marginTop: spacing.space2 },
});
