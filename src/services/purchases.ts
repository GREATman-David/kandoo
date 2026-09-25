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
export const ENTITLEMENT_ID = 'kandoo_pro';
const OFFERING_ID = 'default';

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

/** The `default` offering, used to render the paywall's packages. */
export async function getDefaultOffering(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  try {
    const offerings = await Purchases.getOfferings();
    return offerings.all[OFFERING_ID] ?? offerings.current ?? null;
  } catch (error) {
    console.warn('Purchases.getOfferings failed:', error);
    return null;
  }
}

function hasEntitlement(entitlements: {
  active: Record<string, unknown>;
}): boolean {
  return typeof entitlements.active[ENTITLEMENT_ID] !== 'undefined';
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
 * Buy a package. Returns whether `kandoo_pro` is active afterwards. A cancel
 * throws `userCancelled` — the caller treats that as a quiet no-op, never an
 * error.
 */
export async function purchasePackage(pkg: PurchasesPackage): Promise<boolean> {
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return hasEntitlement(customerInfo.entitlements);
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
