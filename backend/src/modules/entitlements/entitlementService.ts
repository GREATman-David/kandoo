/**
 * The paywall line is memory depth: free recall reaches back 7 days, Pro reaches
 * back forever. That boundary is enforced HERE, on the server, not on the device
 * — a client boolean is trivially spoofable, and memory depth is the whole
 * product. The device only presents the paywall; the server decides who is Pro.
 *
 * Pro status comes from RevenueCat's V2 REST API, keyed by the Supabase user id
 * (the app calls `Purchases.logIn(supabaseUserId)`, so RevenueCat's customer id
 * IS the Supabase id). Two calls, both cached:
 *   1. lookup_key `kandoo_pro` → RevenueCat's internal entitlement id
 *      (`/entitlements`, config, cached an hour).
 *   2. a customer's active entitlement ids (`/customers/{id}/active_entitlements`,
 *      cached a minute per user).
 * V2's active_entitlements returns the opaque internal id, never the lookup key,
 * which is why the secret key needs project-configuration read as well as
 * customer read.
 */

const API_BASE = 'https://api.revenuecat.com/v2';
const ENTITLEMENT_LOOKUP_KEY = 'kandoo_pro';

const ENTITLEMENT_ID_TTL_MS = 60 * 60 * 1000; // config barely changes
const PRO_STATUS_TTL_MS = 60 * 1000; // brief, so a new purchase unlocks fast

type Cached<T> = { value: T; at: number };

let entitlementIdCache: Cached<string> | null = null;
const proStatusCache = new Map<string, Cached<boolean>>();

function credentials(): { secret: string; projectId: string } | null {
  const secret = process.env.REVENUECAT_SECRET_KEY;
  const projectId = process.env.REVENUECAT_PROJECT_ID;
  if (!secret || !projectId) return null;
  return { secret, projectId };
}

async function revenueCatGet(
  path: string,
  secret: string
): Promise<{ items?: unknown[] } | null> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
  });

  // A customer with no purchases yet simply doesn't exist in RevenueCat — that
  // is a normal "free" answer, not an error.
  if (response.status === 404) return null;

  if (!response.ok) {
    throw new Error(`RevenueCat ${path} returned ${response.status}`);
  }

  return (await response.json()) as { items?: unknown[] };
}

/**
 * Resolve the human lookup key `kandoo_pro` to RevenueCat's internal
 * entitlement id. Cached for an hour: entitlement configuration is not
 * something that changes between requests.
 */
async function resolveEntitlementId(
  secret: string,
  projectId: string
): Promise<string | null> {
  if (
    entitlementIdCache &&
    Date.now() - entitlementIdCache.at < ENTITLEMENT_ID_TTL_MS
  ) {
    return entitlementIdCache.value;
  }

  const data = await revenueCatGet(`/projects/${projectId}/entitlements`, secret);
  const items = (data?.items ?? []) as {
    id?: string;
    lookup_key?: string;
  }[];

  const match = items.find((item) => item.lookup_key === ENTITLEMENT_LOOKUP_KEY);
  if (!match?.id) return null;

  entitlementIdCache = { value: match.id, at: Date.now() };
  return match.id;
}

/**
 * Whether this user currently holds the `kandoo_pro` entitlement. Fails CLOSED
 * (treated as free) on any misconfiguration or REST failure: a transient
 * RevenueCat outage must never hand out Pro, and free still answers the last
 * 7 days, so the user is never blocked — only asked to upgrade for older ones.
 */
export async function isProUser(userId: string): Promise<boolean> {
  const cached = proStatusCache.get(userId);
  if (cached && Date.now() - cached.at < PRO_STATUS_TTL_MS) {
    return cached.value;
  }

  const creds = credentials();
  if (!creds) {
    // Not configured (e.g. local dev without keys): everyone is free.
    console.warn(
      'RevenueCat is not configured (REVENUECAT_SECRET_KEY / ' +
        'REVENUECAT_PROJECT_ID); treating all users as free.'
    );
    return false;
  }

  let pro = false;
  try {
    const entitlementId = await resolveEntitlementId(
      creds.secret,
      creds.projectId
    );
    if (entitlementId) {
      const data = await revenueCatGet(
        `/projects/${creds.projectId}/customers/${encodeURIComponent(
          userId
        )}/active_entitlements`,
        creds.secret
      );
      const active = (data?.items ?? []) as { entitlement_id?: string }[];
      pro = active.some((item) => item.entitlement_id === entitlementId);
    }
  } catch (error) {
    console.error('RevenueCat entitlement check failed; treating as free:', error);
    pro = false;
  }

  proStatusCache.set(userId, { value: pro, at: Date.now() });
  return pro;
}
