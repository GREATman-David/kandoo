/**
 * The paywall line is memory depth: free recall reaches back 10 days, a paid
 * plan reaches back forever. That boundary is enforced HERE, on the server, not
 * on the device — a client boolean is trivially spoofable, and memory depth is
 * the whole product. The device only presents the paywall; the server decides.
 *
 * Tiers, each including everything below it:
 *   Free
 *   Personal (`kandoo_personal`) — everyday life: whole history, Places,
 *     kept photos, Kandoo's voice, Insights.
 *   Pro (`kandoo_pro`) — work: reading pages and documents into notes, Teams
 *     (as a member).
 *   Elite (`kandoo_elite`) — Mr. Kandoo, research, leading a team.
 * Status comes from RevenueCat's V2 REST API, keyed by the Supabase user id
 * (the app calls `Purchases.logIn(supabaseUserId)`, so RevenueCat's customer id
 * IS the Supabase id). Two calls, both cached:
 *   1. lookup keys → RevenueCat's internal entitlement ids
 *      (`/entitlements`, config, cached an hour).
 *   2. a customer's active entitlement ids (`/customers/{id}/active_entitlements`,
 *      cached a minute per user).
 * V2's active_entitlements returns the opaque internal id, never the lookup key,
 * which is why the secret key needs project-configuration read as well as
 * customer read.
 */

const API_BASE = 'https://api.revenuecat.com/v2';

export type Tier = 'free' | 'personal' | 'pro' | 'elite';
type PaidTier = Exclude<Tier, 'free'>;

/** Most generous first: the first one a customer holds is their tier. */
const PAID_TIERS: PaidTier[] = ['elite', 'pro', 'personal'];
const LOOKUP_KEYS: Record<PaidTier, string> = {
  personal: 'kandoo_personal',
  pro: 'kandoo_pro',
  elite: 'kandoo_elite',
};
const RANK: Record<Tier, number> = { free: 0, personal: 1, pro: 2, elite: 3 };

/** Does `tier` include everything in `needed`? */
export function tierAtLeast(tier: Tier, needed: Tier): boolean {
  return RANK[tier] >= RANK[needed];
}

const ENTITLEMENT_ID_TTL_MS = 60 * 60 * 1000; // config barely changes
const TIER_TTL_MS = 60 * 1000; // brief, so a new purchase unlocks fast

type Cached<T> = { value: T; at: number };
type EntitlementIds = Record<PaidTier, string | null>;

let entitlementIdCache: Cached<EntitlementIds> | null = null;
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
 * Resolve the lookup keys to RevenueCat's internal entitlement ids. Cached for
 * an hour: entitlement configuration is not something that changes between
 * requests. A tier whose entitlement isn't set up yet resolves to null and is
 * simply never granted.
 */
async function resolveEntitlementIds(secret: string, projectId: string): Promise<EntitlementIds> {
  if (entitlementIdCache && Date.now() - entitlementIdCache.at < ENTITLEMENT_ID_TTL_MS) {
    return entitlementIdCache.value;
  }

  const data = await revenueCatGet(`/projects/${projectId}/entitlements`, secret);
  const items = (data?.items ?? []) as { id?: string; lookup_key?: string }[];
  const idOf = (key: string) => items.find((item) => item.lookup_key === key)?.id ?? null;
  const value: EntitlementIds = {
    personal: idOf(LOOKUP_KEYS.personal),
    pro: idOf(LOOKUP_KEYS.pro),
    elite: idOf(LOOKUP_KEYS.elite),
  };

  entitlementIdCache = { value, at: Date.now() };
  return value;
}

/** The best tier among entitlements held, by internal id or lookup key. */
function bestTier(ids: EntitlementIds, holds: (id: string | null, key: string) => boolean): Tier {
  return PAID_TIERS.find((t) => holds(ids[t], LOOKUP_KEYS[t])) ?? 'free';
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
  if (!opts.fresh && cached && Date.now() - cached.at < TIER_TTL_MS) {
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
    if (PAID_TIERS.some((t) => ids[t])) {
      const data = await revenueCatGet(
        `/projects/${creds.projectId}/customers/${encodeURIComponent(userId)}/active_entitlements`,
        creds.secret
      );
      const active = new Set(
        ((data?.items ?? []) as { entitlement_id?: string }[]).map((item) => item.entitlement_id)
      );
      tier = bestTier(ids, (id) => id !== null && active.has(id));
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
        const fromSubs = bestTier(ids, (id, key) => (id !== null && granted.has(id)) || granted.has(key));
        if (RANK[fromSubs] > RANK[tier]) tier = fromSubs;
      }
    }
  } catch (error) {
    console.error('RevenueCat entitlement check failed; treating as free:', error);
    tier = 'free';
  }

  tierCache.set(userId, { value: tier, at: Date.now() });
  return tier;
}

/** Any paid plan (Personal and up): whole history, Places, Kandoo's voice. */
export async function isPaidUser(userId: string, opts: { fresh?: boolean } = {}): Promise<boolean> {
  return (await getUserTier(userId, opts)) !== 'free';
}
