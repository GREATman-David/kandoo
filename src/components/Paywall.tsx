import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';

import {
  ELITE_PACKAGES,
  getDefaultOffering,
  isUserCancelled,
  purchasePackage,
  restorePurchases,
  type Tier,
} from '@/services/purchases';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

export type PaywallProps = {
  visible: boolean;
  onClose: () => void;
  /** Fired once the chosen tier is active — the caller re-asks so the now-Pro
   *  answer includes the older memories that were just unlocked. */
  onPurchased: () => void;
  /** Which tier to open on: Elite when the user reached for Kandoo Agent. */
  focus?: PaidTier;
  /** Why the paywall opened, when it isn't obvious ("You've used…"). */
  note?: string | null;
};

type Plan = 'annual' | 'monthly';
type PaidTier = 'pro' | 'elite';

/** What each tier gives — the words on the paywall. */
const TIERS: Record<PaidTier, { eyebrow: string; title: string; points: string[]; cta: string }> = {
  pro: {
    eyebrow: 'Kandoo Pro',
    title: 'Remember across all of time.',
    points: [
      'Your whole history, not just the last ten days',
      'Places — reminders the moment you arrive',
      'Kandoo’s own voice for spoken answers',
      'A five-minute taste of Mr. Kandoo each month',
    ],
    cta: 'Unlock Pro',
  },
  elite: {
    eyebrow: 'Kandoo Elite',
    title: 'Talk it over with Mr. Kandoo.',
    points: [
      'Everything in Pro',
      'Mr. Kandoo — 45 minutes a month of conversation that acts across your app',
      'Every change shown to you, saved only on your yes',
    ],
    cta: 'Unlock Elite',
  },
};
type LoadState = 'loading' | 'ready' | 'failed';

/** Per-month price for the annual plan, derived from its total. The currency
 *  symbol is lifted off the localized string so it matches the store's format
 *  without needing Intl currency support (patchy under Hermes). */
function perMonthLabel(pkg: PurchasesPackage): string | null {
  const price = pkg.product.price;
  if (!price || Number.isNaN(price)) return null;
  const symbol = pkg.product.priceString.replace(/[0-9.,\s]/g, '');
  return `${symbol}${(price / 12).toFixed(2)}/mo`;
}

/**
 * Is the annual plan actually cheaper per month than the monthly plan? Drives
 * the "Best value" badge and the default selection, so neither can lie when the
 * store's prices are configured the wrong way round.
 */
function isAnnualBetter(
  annual: PurchasesPackage | null,
  monthly: PurchasesPackage | null
): boolean {
  const annualPerMonth = annual?.product.price ? annual.product.price / 12 : null;
  const monthlyPrice = monthly?.product.price ?? null;
  return (
    annualPerMonth != null &&
    monthlyPrice != null &&
    annualPerMonth < monthlyPrice
  );
}

export function Paywall({ visible, onClose, onPurchased, focus = 'pro', note = null }: PaywallProps) {
  const [packs, setPacks] = useState<
    Record<PaidTier, { annual: PurchasesPackage | null; monthly: PurchasesPackage | null }>
  >({ pro: { annual: null, monthly: null }, elite: { annual: null, monthly: null } });
  const [tierShown, setTierShown] = useState<PaidTier>(focus);
  const [selected, setSelected] = useState<Plan>('annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Loading plans…" used to be permanent when the offering never arrived
  // (offline, store unavailable); now it fails into a line with a Retry.
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [attempt, setAttempt] = useState(0);

  // Load the current offering each time the sheet opens. Pro uses RevenueCat's
  // reserved `$rc_annual` / `$rc_monthly`; Elite uses the custom package ids.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setError(null);
    setLoadState('loading');
    getDefaultOffering().then((offering) => {
      if (!active) return;
      const byId = (id: string) => offering?.availablePackages.find((p) => p.identifier === id) ?? null;
      const next = {
        pro: { annual: offering?.annual ?? null, monthly: offering?.monthly ?? null },
        elite: { annual: byId(ELITE_PACKAGES.annual), monthly: byId(ELITE_PACKAGES.monthly) },
      };
      setPacks(next);
      const eliteReady = !!(next.elite.annual || next.elite.monthly);
      const shown: PaidTier = focus === 'elite' && eliteReady ? 'elite' : 'pro';
      setTierShown(shown);
      const { annual: a, monthly: m } = next[shown];
      setLoadState(next.pro.annual || next.pro.monthly || eliteReady ? 'ready' : 'failed');
      // Pre-select whichever plan is genuinely the better per-month deal. Never
      // assume annual wins — with the store's prices inverted it would default
      // the user to the more expensive plan and call it "Best value".
      setSelected(isAnnualBetter(a, m) ? 'annual' : m ? 'monthly' : 'annual');
    });
    return () => {
      active = false;
    };
  }, [visible, attempt, focus]);

  const eliteAvailable = !!(packs.elite.annual || packs.elite.monthly);
  const { annual, monthly } = packs[tierShown];
  const copy = TIERS[tierShown];
  const selectedPackage = selected === 'annual' ? annual : monthly;
  // The badge is a claim about value; only show it when it's actually true.
  const annualIsBetter = isAnnualBetter(annual, monthly);

  const showTier = (next: PaidTier) => {
    setTierShown(next);
    setError(null);
    const { annual: a, monthly: m } = packs[next];
    setSelected(isAnnualBetter(a, m) ? 'annual' : m ? 'monthly' : 'annual');
  };

  async function complete(run: () => Promise<boolean>, kind: 'purchase' | 'restore') {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const entitled = await run();
      if (entitled) {
        onPurchased();
        onClose();
      } else {
        setError(
          kind === 'restore'
            ? 'No earlier Kandoo purchase was found for this account.'
            : `That didn’t unlock ${tierShown === 'elite' ? 'Elite' : 'Pro'}. Please try again.`
        );
      }
    } catch (caught) {
      // A cancel is a quiet no-op, never an error message.
      if (!isUserCancelled(caught)) {
        console.error('Purchase failed:', caught);
        setError(
          kind === 'restore'
            ? 'Couldn’t restore purchases just now. Please try again.'
            : 'Couldn’t complete that purchase. Please try again.'
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {eliteAvailable ? (
              <View style={styles.switch} accessibilityRole="tablist">
                {(['pro', 'elite'] as const).map((t) => (
                  <Pressable
                    key={t}
                    style={[styles.switchItem, tierShown === t && styles.switchOn]}
                    onPress={() => showTier(t)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: tierShown === t }}
                  >
                    <Text style={[styles.switchText, tierShown === t && styles.switchTextOn]}>
                      {t === 'pro' ? 'Pro' : 'Elite'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
            <Text style={styles.title}>{copy.title}</Text>
            {note ? <Text style={styles.note}>{note}</Text> : null}
            <View style={styles.points}>
              {copy.points.map((point) => (
                <Text key={point} style={styles.point}>
                  ✓  {point}
                </Text>
              ))}
            </View>

            {annual ? (
              <PlanRow
                label="Annual"
                priceLine={annual.product.priceString}
                sublabel={perMonthLabel(annual)}
                badge={annualIsBetter ? 'Best value' : null}
                highlighted={selected === 'annual'}
                onPress={() => setSelected('annual')}
              />
            ) : null}

            {monthly ? (
              <PlanRow
                label="Monthly"
                priceLine={`${monthly.product.priceString}/mo`}
                sublabel={null}
                badge={null}
                highlighted={selected === 'monthly'}
                onPress={() => setSelected('monthly')}
              />
            ) : null}

            {loadState === 'loading' ? (
              <Text style={styles.loading}>Loading plans…</Text>
            ) : null}

            {loadState === 'failed' ? (
              <View style={styles.failed}>
                <Text style={styles.loading}>
                  Plans couldn’t load. Check your connection and try again.
                </Text>
                <Pressable
                  onPress={() => setAttempt((n) => n + 1)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.retry}>Try again</Text>
                </Pressable>
              </View>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={[
                styles.cta,
                (busy || !selectedPackage) && styles.ctaDisabled,
              ]}
              disabled={busy || !selectedPackage}
              onPress={() =>
                selectedPackage &&
                complete(async () => {
                  const tier: Tier = await purchasePackage(selectedPackage);
                  // Elite must actually grant Elite; Pro is any paid tier.
                  return tierShown === 'elite' ? tier === 'elite' : tier !== 'free';
                }, 'purchase')
              }
            >
              <Text style={styles.ctaText}>
                {busy ? 'Working…' : copy.cta}
              </Text>
            </Pressable>

            {loadState === 'ready' ? (
              <Text style={styles.terms}>
                Subscriptions renew automatically until cancelled. Cancel anytime
                in your store account settings.
              </Text>
            ) : null}

            <View style={styles.footer}>
              <Pressable
                onPress={() => complete(restorePurchases, 'restore')}
                disabled={busy}
                hitSlop={8}
              >
                <Text style={styles.footerLink}>Restore</Text>
              </Pressable>
              <Pressable onPress={onClose} disabled={busy} hitSlop={8}>
                <Text style={styles.footerLink}>Not now</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type PlanRowProps = {
  label: string;
  priceLine: string;
  sublabel: string | null;
  badge: string | null;
  highlighted: boolean;
  onPress: () => void;
};

function PlanRow({
  label,
  priceLine,
  sublabel,
  badge,
  highlighted,
  onPress,
}: PlanRowProps) {
  return (
    <Pressable
      style={[styles.plan, highlighted && styles.planOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: highlighted }}
    >
      <View style={styles.planLeft}>
        <Text style={styles.planLabel}>{label}</Text>
        {sublabel ? <Text style={styles.planSub}>{sublabel}</Text> : null}
      </View>
      <View style={styles.planRight}>
        {badge ? <Text style={styles.badge}>{badge}</Text> : null}
        <Text style={styles.planPrice}>{priceLine}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withOpacity(colors.base, 0.6),
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: colors.base,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: spacing.space5,
    paddingHorizontal: spacing.space4,
    paddingBottom: spacing.space6,
  },
  eyebrow: {
    ...text.label,
    color: colors.accent,
    marginBottom: spacing.space2,
  },
  title: {
    ...text.displayL,
    color: colors.ink,
    marginBottom: spacing.space3,
  },
  note: {
    ...text.body,
    color: colors.alarmText,
    marginBottom: spacing.space3,
  },
  points: { gap: spacing.space2, marginBottom: spacing.space5 },
  point: { ...text.body, color: colors.inkMuted },
  switch: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    padding: 3,
    marginBottom: spacing.space4,
  },
  switchItem: { paddingVertical: spacing.space2, paddingHorizontal: spacing.space5, borderRadius: radius.full },
  switchOn: { backgroundColor: colors.accentWash },
  switchText: { ...text.bodyStrong, color: colors.inkMuted },
  switchTextOn: { color: colors.ink },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingVertical: spacing.space3,
    paddingHorizontal: spacing.space4,
    marginBottom: spacing.space3,
  },
  planOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentWash,
  },
  planLeft: {
    flexShrink: 1,
  },
  planLabel: {
    ...text.bodyStrong,
    color: colors.ink,
  },
  planSub: {
    ...text.caption,
    color: colors.inkMuted,
    marginTop: 2,
  },
  planRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  badge: {
    ...text.label,
    color: colors.accent,
  },
  planPrice: {
    ...text.bodyStrong,
    color: colors.ink,
  },
  loading: {
    ...text.body,
    color: colors.inkFaint,
    textAlign: 'center',
    paddingVertical: spacing.space4,
  },
  error: {
    ...text.caption,
    color: colors.alarmText,
    textAlign: 'center',
    marginBottom: spacing.space3,
  },
  cta: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.markCore,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.space2,
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    ...text.bodyStrong,
    color: colors.ink,
  },
  failed: {
    alignItems: 'center',
    paddingBottom: spacing.space3,
  },
  retry: {
    ...text.bodyStrong,
    color: colors.markRing,
  },
  terms: {
    ...text.caption,
    color: colors.inkMuted,
    textAlign: 'center',
    marginTop: spacing.space3,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.space4,
  },
  footerLink: {
    ...text.caption,
    color: colors.inkMuted,
  },
});
