/**
 * The paywall line is memory depth: free recall reaches back 10 days, Pro reaches
 * back forever. That boundary is enforced HERE, on the server, not on the device
 * — a client boolean is trivially spoofable, and memory depth is the whole
 * product. The device only presents the paywall; the server decides who is Pro.
 *
 * Tiers: Free, Pro (`kandoo_pro`) and Elite (`kandoo_elite`, which includes
 * everything in Pro). Status comes from RevenueCat's V2 REST API, keyed by the Supabase user id
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
const PRO_LOOKUP_KEY = 'kandoo_pro';
/** Kandoo Elite: everything in Pro, plus Kandoo Agent minutes. */
const ELITE_LOOKUP_KEY = 'kandoo_elite';

const ENTITLEMENT_ID_TTL_MS = 60 * 60 * 1000; // config barely changes
const PRO_STATUS_TTL_MS = 60 * 1000; // brief, so a new purchase unlocks fast

type Cached<T> = { value: T; at: number };

export type Tier = 'free' | 'pro' | 'elite';

let entitlementIdCache: Cached<{ pro: string | null; elite: string | null }> | null = null;
const tierCache = new Map<string, Cached<Tier>>();

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
 * Resolve the lookup keys `kandoo_pro` / `kandoo_elite` to RevenueCat's
 * internal entitlement ids. Cached for an hour: entitlement configuration is
 * not something that changes between requests.
 */
async function resolveEntitlementIds(
  secret: string,
  projectId: string
): Promise<{ pro: string | null; elite: string | null }> {
  if (entitlementIdCache && Date.now() - entitlementIdCache.at < ENTITLEMENT_ID_TTL_MS) {
    return entitlementIdCache.value;
  }

  const data = await revenueCatGet(`/projects/${projectId}/entitlements`, secret);
  const items = (data?.items ?? []) as { id?: string; lookup_key?: string }[];
  const idOf = (key: string) => items.find((item) => item.lookup_key === key)?.id ?? null;
  const value = { pro: idOf(PRO_LOOKUP_KEY), elite: idOf(ELITE_LOOKUP_KEY) };

  entitlementIdCache = { value, at: Date.now() };
  return value;
}

/**
 * This user's tier. Fails CLOSED (treated as free) on any misconfiguration or
 * REST failure: a transient RevenueCat outage must never hand out a paid tier,
 * and free still answers the last 10 days, so the user is never blocked — only
 * asked to upgrade.
 */
export async function getUserTier(
  userId: string,
  /** Skip the cache — the app sends this right after a purchase. */
  opts: { fresh?: boolean } = {}
): Promise<Tier> {
  const cached = tierCache.get(userId);
  if (!opts.fresh && cached && Date.now() - cached.at < PRO_STATUS_TTL_MS) {
    return cached.value;
  }

  const creds = credentials();
  if (!creds) {
    // Not configured (e.g. local dev without keys): everyone is free.
    console.warn(
      'RevenueCat is not configured (REVENUECAT_SECRET_KEY / ' +
        'REVENUECAT_PROJECT_ID); treating all users as free.'
    );
    return 'free';
  }

  let tier: Tier = 'free';
  try {
    const ids = await resolveEntitlementIds(creds.secret, creds.projectId);
    if (ids.pro || ids.elite) {
      const data = await revenueCatGet(
        `/projects/${creds.projectId}/customers/${encodeURIComponent(userId)}/active_entitlements`,
        creds.secret
      );
      const active = new Set(
        ((data?.items ?? []) as { entitlement_id?: string }[]).map((item) => item.entitlement_id)
      );
      tier = ids.elite && active.has(ids.elite) ? 'elite' : ids.pro && active.has(ids.pro) ? 'pro' : 'free';
      // active_entitlements can lag a renewal (seen with Test Store renewals:
      // the subscription says gives_access with both entitlements while the
      // list is empty). Below Elite, ask the subscriptions themselves.
      if (tier !== 'elite' && data) {
        const subs = await revenueCatGet(
          `/projects/${creds.projectId}/customers/${encodeURIComponent(userId)}/subscriptions`,
          creds.secret
        );
        const granted = new Set<string>();
        for (const sub of (subs?.items ?? []) as { gives_access?: boolean; entitlements?: unknown }[]) {
          if (!sub.gives_access) continue;
          const list = Array.isArray(sub.entitlements)
            ? sub.entitlements
            : ((sub.entitlements as { items?: unknown[] } | undefined)?.items ?? []);
          for (const e of list) {
            if (typeof e === 'string') granted.add(e);
            else if (e && typeof e === 'object') {
              const { id, lookup_key } = e as { id?: string; lookup_key?: string };
              if (id) granted.add(id);
              if (lookup_key) granted.add(lookup_key);
            }
          }
        }
        const has = (id: string | null, key: string) => (id !== null && granted.has(id)) || granted.has(key);
        if (has(ids.elite, ELITE_LOOKUP_KEY)) tier = 'elite';
        else if (tier === 'free' && has(ids.pro, PRO_LOOKUP_KEY)) tier = 'pro';
      }
    }
  } catch (error) {
    console.error('RevenueCat entitlement check failed; treating as free:', error);
    tier = 'free';
  }

  tierCache.set(userId, { value: tier, at: Date.now() });
  return tier;
}

/** Pro features (whole history, Places, Kandoo's voice): Pro or Elite. */
export async function isProUser(userId: string, opts: { fresh?: boolean } = {}): Promise<boolean> {
  return (await getUserTier(userId, opts)) !== 'free';
}
