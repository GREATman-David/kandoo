import { useCallback, useEffect, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  fetchUsage,
  isProRequired,
  logFailure,
  userMessage,
  type Usage,
  type UsageRange,
} from '@/services/interpretationService';
import { colors, radius, spacing, text } from '@/theme/theme';

import { BarChart, DonutChart, RankBars, SplitBar } from './Charts';

const ICONS = { back: require('@/assets/images/icons/chevron-left.png') };

export type InsightsScreenProps = {
  visible: boolean;
  /** Which window to open on (Mr. Kandoo can ask for a month). */
  initialRange?: UsageRange;
  onClose: () => void;
  /** Free users reach the paywall instead (Insights are Pro and Elite). */
  onNeedPro: () => void;
};

function dayName(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

/**
 * Insights (Pro and Elite): how you've been using Kandoo this week or month —
 * what you captured each day, how you capture, what happened to your
 * reminders, what your Library grew with, and who and where came up most.
 */
export function InsightsScreen({ visible, initialRange = 'week', onClose, onNeedPro }: InsightsScreenProps) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [range, setRange] = useState<UsageRange>(initialRange);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (visible) setRange(initialRange);
  }, [visible, initialRange]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsage(await fetchUsage(range));
    } catch (caught) {
      if (isProRequired(caught)) {
        onClose();
        onNeedPro();
        return;
      }
      logFailure('Loading insights failed:', caught);
      setError(userMessage(caught, 'Your insights couldn’t load. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [range, onClose, onNeedPro]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  const chartWidth = width - spacing.space5 * 2 - spacing.space4 * 2;
  const u = usage;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.screen, { paddingTop: insets.top + spacing.space4 }]}>
        <View style={styles.bar}>
          <Pressable style={styles.backBtn} onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
            <Image source={ICONS.back} style={styles.backIcon} />
          </Pressable>
        </View>
        <Text style={styles.eyebrow}>Insights</Text>
        <Text style={styles.heading}>How you’ve used Kandoo</Text>

        <View style={styles.switch} accessibilityRole="tablist">
          {(['week', 'month'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.switchOption, range === option && styles.switchOptionOn]}
              onPress={() => setRange(option)}
              accessibilityRole="tab"
              accessibilityState={{ selected: range === option }}
            >
              <Text style={[styles.switchText, range === option && styles.switchTextOn]}>
                {option === 'week' ? 'This week' : 'This month'}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + spacing.space7 }]}
        >
          {error ? (
            <Pressable onPress={() => void load()} style={styles.card} accessibilityRole="button">
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.retry}>Try again</Text>
            </Pressable>
          ) : !u ? (
            <Text style={styles.dim}>{loading ? 'Putting it together…' : ''}</Text>
          ) : (
            <View style={[styles.stack, loading && styles.refreshing]}>
              <View style={styles.tiles}>
                <Tile value={u.totals.captures} label="Captures" />
                <Tile value={u.totals.memories} label="Memories" />
                <Tile value={u.reminders.done} label="Reminders done" />
                <Tile value={u.totals.notes} label="Library notes" />
              </View>

              <Card title="Every day" hint={u.busiestDay ? `Busiest: ${dayName(u.busiestDay)}` : 'Nothing captured yet'}>
                <BarChart
                  width={chartWidth}
                  data={u.days.map((d) => ({ label: d.label, value: d.captures, highlight: d.date === u.busiestDay }))}
                />
              </Card>

              <Card title="How you capture">
                <DonutChart slices={u.sources} centreLabel="captures" />
              </Card>

              <Card title="Reminders" hint={`${u.totals.reminders} made in this ${range}`}>
                <SplitBar
                  parts={[
                    { name: 'Done', value: u.reminders.done, color: colors.settledFill },
                    { name: 'Overdue', value: u.reminders.missed, color: colors.alarm },
                    { name: 'Coming up', value: u.reminders.upcoming, color: colors.markCore },
                    { name: 'To review', value: u.reminders.awaitingReview, color: colors.inkFaint },
                  ]}
                />
              </Card>

              <Card
                title="Your Library"
                hint={u.noteKinds.length ? u.noteKinds.map((k) => `${k.value} ${k.name.toLowerCase()}`).join(' · ') : undefined}
              >
                <DonutChart slices={u.library} centreLabel="notes" />
              </Card>

              <Card title="Who came up">
                <RankBars items={u.people} />
              </Card>

              <Card title="Where">
                <RankBars items={u.places} />
              </Card>

              {u.totals.photos > 0 ? (
                <Text style={styles.dim}>
                  {u.totals.photos} {u.totals.photos === 1 ? 'photo' : 'photos'} kept this {range}.
                </Text>
              ) : null}
            </View>
          )}
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

function Card({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{title}</Text>
        {hint ? <Text style={styles.cardHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base, paddingHorizontal: spacing.space5 },
  bar: { height: 44, flexDirection: 'row', alignItems: 'center' },
  backBtn: { width: 40, height: 40, justifyContent: 'center' },
  backIcon: { width: 20, height: 20, tintColor: colors.ink },
  eyebrow: { ...text.label, letterSpacing: 1.5, color: colors.markRing, marginTop: spacing.space2 },
  heading: { ...text.displayL, color: colors.ink, marginTop: spacing.space1, marginBottom: spacing.space4 },
  switch: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    padding: 3,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  switchOption: { minHeight: 36, paddingHorizontal: spacing.space5, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  switchOptionOn: { backgroundColor: colors.surfaceRaised },
  switchText: { ...text.bodyStrong, color: colors.inkMuted },
  switchTextOn: { color: colors.ink },
  body: { paddingTop: spacing.space4 },
  stack: { gap: spacing.space4 },
  refreshing: { opacity: 0.6 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.space3 },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  tileValue: { ...text.displayL, color: colors.ink },
  tileLabel: { ...text.caption, color: colors.inkMuted },
  card: {
    padding: spacing.space4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    gap: spacing.space3,
  },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.space2 },
  cardTitle: { ...text.label, letterSpacing: 1.5, color: colors.markRing },
  cardHint: { ...text.caption, color: colors.inkMuted, flexShrink: 1, textAlign: 'right' },
  dim: { ...text.body, color: colors.inkMuted, textAlign: 'center', marginTop: spacing.space4 },
  errorText: { ...text.body, color: colors.alarmText },
  retry: { ...text.bodyStrong, color: colors.markRing },
});
