import type { User } from '@supabase/supabase-js';

import { supabase } from '@/services/supabase';

/**
 * How Kandoo addresses the user — "David", "Dr. Mensah", "Ama". Pro users set
 * it after upgrading (or from their account); Kandoo Agent says it out loud.
 * Kept in the account's own profile metadata, so it follows them to a new
 * phone; it is never shown to anyone else.
 */

export const MAX_NAME_LENGTH = 40;

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** The name the user chose, else the first name from sign-up, else null. */
export function preferredName(user: Pick<User, 'user_metadata'> | null | undefined): string | null {
  const meta = user?.user_metadata ?? {};
  const chosen = clean(meta.preferred_name);
  if (chosen) return chosen;
  const signUp = clean(meta.name) ?? clean(meta.full_name) ?? clean(meta.first_name);
  return signUp ? signUp.split(/\s+/)[0] : null;
}

/** Only the name the user chose themselves (null until they have). */
export function chosenName(user: Pick<User, 'user_metadata'> | null | undefined): string | null {
  return clean(user?.user_metadata?.preferred_name);
}

export async function setPreferredName(name: string): Promise<void> {
  const value = name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
  if (!value) throw new Error('Say what Kandoo should call you.');
  const { error } = await supabase.auth.updateUser({ data: { preferred_name: value } });
  if (error) throw error;
}
