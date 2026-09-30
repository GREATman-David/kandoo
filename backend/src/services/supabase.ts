import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** How long to wait before retrying a request Supabase rejected for clock skew. */
const SKEW_RETRY_MS = 1200;

/**
 * Supabase's gateway can stamp the token it passes to the database a moment
 * "in the future" of the database's own clock, which is then rejected with
 * PGRST303 "JWT issued at future" — intermittently, on any query. Seen in
 * testing as Home's Recently failing at launch. The query itself is fine, so
 * such a request is retried once after a short wait; anything else passes
 * straight through.
 */
async function fetchWithSkewRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status !== 401) return response;

  const body = await response.clone().text().catch(() => '');
  if (!body.includes('PGRST303')) return response;

  console.warn('Supabase rejected a request for clock skew (PGRST303); retrying once.');
  await new Promise((resolve) => setTimeout(resolve, SKEW_RETRY_MS));
  return fetch(input, init);
}

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  { global: { fetch: fetchWithSkewRetry } }
);
