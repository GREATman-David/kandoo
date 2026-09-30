import { useRef, useState } from 'react';
import {
  Dimensions,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontFamily, radius, spacing, text } from '@/theme/theme';

import { KandooSymbol } from './Symbol';

type Card = { headline: string; body: string; plans?: true };

/** The three plans, as the last card says them. Prices live on the paywall. */
const PLANS = [
  { name: 'Free', line: 'Capture, reminders and answers from your last ten days, spoken in your phone’s voice.' },
  { name: 'Kandoo Pro', line: 'Your whole history, places that remind you the moment you arrive, and Kandoo’s own voice.' },
  { name: 'Kandoo Elite', line: 'Everything in Pro, plus Kandoo Agent — 45 minutes a month of conversation that acts across the app.' },
] as const;

/** Four cards: what Kandoo does · how you talk to it · how it remembers · the plans. */
const CARDS: Card[] = [
  {
    headline: 'Tell Kandoo once.',
    body: "Kandoo keeps what matters and brings it back at the moment it's useful — not a notes app you dig through.",
  },
  {
    headline: 'Just say it.',
    body: 'Speak or type the way you would to a friend. Kandoo works out the reminders, the people and the facts for you.',
  },
  {
    headline: 'It finds the moment.',
    body: 'A time, a place, a person — Kandoo surfaces the right memory when it counts, and shows you before it commits anything.',
  },
  {
    headline: 'Start free. Grow into it.',
    body: '',
    plans: true,
  },
];

export type OnboardingProps = {
  /** Called on "Get started" or Skip — the caller stores the seen flag. */
  onDone: () => void;
};

/**
 * First-launch onboarding, shown once before sign-up. Horizontal paging, dots, a
 * Skip link, and a button that reads "Next" until the last card, where it becomes
 * "Get started". The mark rides above each card — the app introducing itself in
 * its own voice. No spinner, no auto-advance.
 */
export function Onboarding({ onDone }: OnboardingProps) {
  const insets = useSafeAreaInsets();
  const width = Dimensions.get('window').width;
  const scroller = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const isLast = page === CARDS.length - 1;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== page) setPage(next);
  }

  function advance() {
    if (isLast) {
      onDone();
      return;
    }
    scroller.current?.scrollTo({ x: (page + 1) * width, animated: true });
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.skipRow}>
        {!isLast ? (
          <Pressable onPress={onDone} hitSlop={12}>
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        style={styles.pager}
      >
        {CARDS.map((card) => (
          <View key={card.headline} style={[styles.card, { width }]}>
            <KandooSymbol state="idle" size={card.plans ? 64 : 96} />
            <Text style={styles.headline}>{card.headline}</Text>
            {card.plans ? (
              <View style={styles.plans}>
                {PLANS.map((plan) => (
                  <View key={plan.name} style={[styles.plan, plan.name === 'Kandoo Elite' && styles.planElite]}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <Text style={styles.planLine}>{plan.line}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.body}>{card.body}</Text>
            )}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.space5 }]}>
        <View style={styles.dots}>
          {CARDS.map((card, i) => (
            <View
              key={card.headline}
              style={[styles.dot, i === page && styles.dotActive]}
            />
          ))}
        </View>

        <Pressable style={styles.button} onPress={advance}>
          <Text style={styles.buttonText}>{isLast ? 'Get started' : 'Next'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.base,
  },
  skipRow: {
    height: 44,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingHorizontal: spacing.space4,
  },
  skip: {
    ...text.body,
    color: colors.inkMuted,
  },
  pager: {
    flex: 1,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.space6,
    gap: spacing.space5,
  },
  headline: {
    ...text.displayXl,
    color: colors.ink,
    textAlign: 'center',
    marginTop: spacing.space4,
  },
  body: {
    ...text.answer,
    color: colors.inkMuted,
    textAlign: 'center',
    maxWidth: 320,
  },
  plans: { alignSelf: 'stretch', gap: spacing.space3 },
  plan: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
    gap: 2,
  },
  // Elite wears the same thicker gold border as its badge on Home.
  planElite: { borderWidth: 2, borderColor: colors.markCore },
  planName: { ...text.memory, fontFamily: fontFamily.displayItalic, color: colors.ink },
  planLine: { ...text.body, color: colors.inkMuted },
  footer: {
    paddingHorizontal: spacing.space4,
    gap: spacing.space5,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.space2,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: radius.full,
    backgroundColor: colors.line,
  },
  dotActive: {
    backgroundColor: colors.accent,
    width: 20,
  },
  button: {
    backgroundColor: colors.markCore,
    borderRadius: radius.md,
    paddingVertical: spacing.space4,
    alignItems: 'center',
  },
  buttonText: {
    ...text.bodyStrong,
    color: colors.ink,
  },
});
