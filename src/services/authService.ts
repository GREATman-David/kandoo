import { cancelAllReminders } from './localNotifications';
import { clearOfflineCache } from './offlineCache';
import { supabase } from './supabase';

export async function signUp(email: string, password: string) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    throw error;
  }

  return data;
}

/**
 * Sign out on this phone, always. The global sign-out (revoking the refresh
 * token server-side) needs a connection; without one it fails and would leave
 * the user signed in, so it falls back to a local sign-out. Either way nothing
 * of this account stays on the phone: saved copies and scheduled reminders go.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.warn('Global sign-out failed; signing out on this device:', error);
    const local = await supabase.auth.signOut({ scope: 'local' });
    if (local.error) {
      throw local.error;
    }
  }

  await Promise.all([clearOfflineCache(), cancelAllReminders()]);
}

/** Send a password-reset email. Errors bubble up for authErrorMessage to map. */
export async function sendPasswordReset(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) {
    throw error;
  }
}

export type AuthMode = 'signin' | 'signup' | 'reset';

/**
 * Turn any auth failure into ONE plain line — never the raw Supabase/exception
 * text. Supabase's messages ("Invalid login credentials", "User already
 * registered", a stray OkHttp string) are for logs, not for a person looking at
 * a login screen. The raw error is logged by the caller; this is what they read.
 */
export function authErrorMessage(error: unknown, mode: AuthMode): string {
  const raw = error instanceof Error ? error.message.toLowerCase() : '';
  const status = (error as { status?: number } | null)?.status;

  if (raw.includes('invalid login')) {
    return "That email and password don't match. Give it another go.";
  }
  if (raw.includes('already registered') || raw.includes('already been registered')) {
    return 'That email already has an account — try signing in instead.';
  }
  if (raw.includes('at least') && raw.includes('password')) {
    return 'Passwords need at least 6 characters.';
  }
  if (raw.includes('email not confirmed')) {
    return 'Confirm your email first, then sign in.';
  }
  if (raw.includes('valid email') || raw.includes('invalid email') || raw.includes('unable to validate')) {
    return "That doesn't look like a valid email address.";
  }
  if (status === 429 || raw.includes('rate limit') || raw.includes('too many')) {
    return 'Too many tries just now. Wait a moment and try again.';
  }
  if (raw.includes('network') || raw.includes('fetch') || raw.includes('timeout')) {
    return "Couldn't reach Kandoo. Check your connection and try again.";
  }

  // Plain, mode-specific fallback — still never the raw exception.
  if (mode === 'signup') return "Couldn't create your account just now. Try again.";
  if (mode === 'reset') return "Couldn't send the reset email just now. Try again.";
  return "Couldn't sign you in just now. Try again.";
}