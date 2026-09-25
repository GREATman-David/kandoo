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
  getDefaultOffering,
  isUserCancelled,
  purchasePackage,
  restorePurchases,
} from '@/services/purchases';
import { colors, radius, spacing, text, withOpacity } from '@/theme/theme';

export type PaywallProps = {
  visible: boolean;
  onClose: () => void;
  /** Fired once `kandoo_pro` is active — the caller re-asks so the now-Pro
   *  answer includes the older memories that were just unlocked. */
  onPurchased: () => void;
};

type Plan = 'annual' | 'monthly';

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

export function Paywall({ visible, onClose, onPurchased }: PaywallProps) {
  const [annual, setAnnual] = useState<PurchasesPackage | null>(null);
  const [monthly, setMonthly] = useState<PurchasesPackage | null>(null);
  const [selected, setSelected] = useState<Plan>('annual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the `default` offering each time the sheet opens. RevenueCat maps the
  // reserved `$rc_annual` / `$rc_monthly` identifiers to these accessors.
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setError(null);
    getDefaultOffering().then((offering) => {
      if (!active) return;
      const a = offering?.annual ?? null;
      const m = offering?.monthly ?? null;
      setAnnual(a);
      setMonthly(m);
      // Pre-select whichever plan is genuinely the better per-month deal. Never
      // assume annual wins — with the store's prices inverted it would default
      // the user to the more expensive plan and call it "Best value".
      setSelected(isAnnualBetter(a, m) ? 'annual' : m ? 'monthly' : 'annual');
    });
    return () => {
      active = false;
    };
  }, [visible]);

  const selectedPackage = selected === 'annual' ? annual : monthly;
  // The badge is a claim about value; only show it when it's actually true.
  const annualIsBetter = isAnnualBetter(annual, monthly);

  async function complete(run: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const entitled = await run();
      if (entitled) {
        onPurchased();
        onClose();
      } else {
        setError('That didn’t unlock Pro. Please try again.');
      }
    } catch (caught) {
      // A cancel is a quiet no-op, never an error message.
      if (!isUserCancelled(caught)) {
        console.error('Purchase failed:', caught);
        setError('Couldn’t complete that purchase. Please try again.');
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
            <Text style={styles.eyebrow}>Kandoo Pro</Text>
            <Text style={styles.title}>Remember across all of time.</Text>
            <Text style={styles.blurb}>
              Free Kandoo remembers the last ten days. Pro holds your whole
              history — every memory you’ve ever given it, whenever it matters.
            </Text>

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

            {!annual && !monthly ? (
              <Text style={styles.loading}>Loading plans…</Text>
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
                complete(() => purchasePackage(selectedPackage))
              }
            >
              <Text style={styles.ctaText}>
                {busy ? 'Working…' : 'Unlock Pro'}
              </Text>
            </Pressable>

            <View style={styles.footer}>
              <Pressable
                onPress={() => complete(restorePurchases)}
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
  blurb: {
    ...text.body,
    color: colors.inkMuted,
    marginBottom: spacing.space5,
  },
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
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.space2,
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    ...text.bodyStrong,
    color: colors.base,
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
