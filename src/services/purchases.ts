import Purchases, {
  LOG_LEVEL,
  type PurchasesOffering,
  type PurchasesPackage,
} from 'react-native-purchases';

/**
 * The one module that talks to RevenueCat on the device. The entitlement
 * identifier lives here and nowhere else; enforcement of what Pro unlocks
 * (memory depth) is the SERVER's job (backend entitlementService) — this side
 * only presents the paywall and completes the purchase.
 *
 * `Purchases.logIn(supabaseUserId)` ties the RevenueCat customer to the
 * Supabase account, so the backend can look the same id up over the V2 REST
 * API and the entitlement follows the user across devices.
 */
/** Kandoo Personal: everyday life — whole history, Places, photos, voice, Insights. */
export const PERSONAL_ENTITLEMENT_ID = 'kandoo_personal';
/** Kandoo Pro: Personal plus work tools (pages into notes, Teams as a member). */
export const ENTITLEMENT_ID = 'kandoo_pro';
/** Kandoo Elite: everything in Pro, plus Mr. Kandoo, research and leading a team. */
export const ELITE_ENTITLEMENT_ID = 'kandoo_elite';

export type Tier = 'free' | 'personal' | 'pro' | 'elite';

/** Pro uses the reserved `$rc_monthly` / `$rc_annual`; the others these ids. */
export const PERSONAL_PACKAGES = { monthly: 'personal_monthly', annual: 'personal_annual' } as const;
export const ELITE_PACKAGES = { monthly: 'elite_monthly', annual: 'elite_annual' } as const;

let configured = false;

export function configurePurchases(): void {
  if (configured) return;
  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_KEY;
  if (!apiKey) {
    console.warn('EXPO_PUBLIC_REVENUECAT_KEY is not set; purchases disabled.');
    return;
  }
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey });
  configured = true;
  // Every entitlement change (purchase, restore, logIn/logOut, renewal,
  // expiry) is pushed to whoever is listening — see useEntitlement.
  Purchases.addCustomerInfoUpdateListener((info) => {
    const tier = tierOf(info.entitlements);
    entitlementListeners.forEach((listener) => listener(tier));
  });
  entitlementListeners.forEach((listener) => listener(null));
}

/** Receives the tier on every change; `null` means "configured, re-check". */
type EntitlementListener = (tier: Tier | null) => void;
const entitlementListeners = new Set<EntitlementListener>();

export function onEntitlementChange(listener: EntitlementListener): () => void {
  entitlementListeners.add(listener);
  return () => {
    entitlementListeners.delete(listener);
  };
}

/**
 * The tier, or null when it can't be read right now (not configured yet,
 * offline). Callers keep their last known value on null instead of treating
 * an unanswered question as "free".
 */
export async function readTier(
  /** Skip RevenueCat's ~5 min cache — e.g. on returning to the app. */
  fresh = false
): Promise<Tier | null> {
  if (!configured) return null;
  try {
    if (fresh) await Purchases.invalidateCustomerInfoCache();
    const info = await Purchases.getCustomerInfo();
    return tierOf(info.entitlements);
  } catch (error) {
    console.warn('getCustomerInfo failed:', error);
    return null;
  }
}

/** Tie the RevenueCat customer to the signed-in Supabase user. */
export async function identifyUser(userId: string): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logIn(userId);
  } catch (error) {
    console.warn('Purchases.logIn failed:', error);
  }
}

/** On sign-out, so the next account doesn't inherit this one's entitlement. */
export async function resetPurchasesUser(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch (error) {
    console.warn('Purchases.logOut failed:', error);
  }
}

/**
 * The offering used to render the paywall's packages: the one the RevenueCat
 * dashboard marks as CURRENT. We used to look this up by the hardcoded name
 * `default`, but that offering was deleted and recreated as a new current one —
 * keying off the name found nothing and the paywall rendered empty. `current`
 * follows whatever the dashboard promotes. The `all` fallback only guards the
 * case where nothing is marked current but some offering still exists.
 */
export async function getDefaultOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.current ?? Object.values(offerings.all)[0] ?? null;
  } catch (error) {
    console.warn('Purchases.getOfferings failed:', error);
    return null;
  }
}

/** Any paid plan (Personal and up), or null when unknown — see readTier. */
export async function readEntitlement(fresh = false): Promise<boolean | null> {
  const tier = await readTier(fresh);
  return tier === null ? null : tier !== 'free';
}

function tierOf(entitlements: { active: Record<string, unknown> }): Tier {
  if (typeof entitlements.active[ELITE_ENTITLEMENT_ID] !== 'undefined') return 'elite';
  if (typeof entitlements.active[ENTITLEMENT_ID] !== 'undefined') return 'pro';
  if (typeof entitlements.active[PERSONAL_ENTITLEMENT_ID] !== 'undefined') return 'personal';
  return 'free';
}

function hasEntitlement(entitlements: { active: Record<string, unknown> }): boolean {
  return tierOf(entitlements) !== 'free';
}

/** Whether this device currently reports `kandoo_pro` active. Drives what the
 *  UI shows (the Free/Pro badge); the server remains the authority on access. */
export async function isEntitled(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return hasEntitlement(info.entitlements);
  } catch (error) {
    console.warn('getCustomerInfo failed:', error);
    return false;
  }
}

/**
 * Buy a package. Returns the tier afterwards (Elite packages grant Elite). A cancel
 * throws `userCancelled` — the caller treats that as a quiet no-op, never an
 * error.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<Tier> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return tierOf(customerInfo.entitlements);
}

export async function restorePurchases(): Promise<boolean> {
  const customerInfo = await Purchases.restorePurchases();
  return hasEntitlement(customerInfo.entitlements);
}

/** True when the RevenueCat SDK reports a cancelled purchase, not a failure. */
export function isUserCancelled(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { userCancelled?: boolean }).userCancelled === true
  );
}
