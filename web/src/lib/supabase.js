/* The ONE Supabase client.
 *
 * Everything the browser talks to — Auth, Postgres (through PostgREST),
 * Storage and Realtime — goes through this instance. The URL and the anon
 * key come from the build environment; the service-role key is NEVER used
 * here (it would give the browser full access to the database).
 *
 *   VITE_SUPABASE_URL        https://<project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY   the "anon" / publishable key
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when the build carries a usable Supabase configuration. */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.error(
    '[supabase] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. ' +
    'Copy .env.example to .env, fill them in, and rebuild (Render: Clear build cache & deploy).'
  );
}

export const supabase = createClient(
  url || 'http://127.0.0.1:54321',        // audit:dev-only — local Supabase Studio
  anonKey || 'missing-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'implicit',
    },
    global: { headers: { 'x-application-name': 'sawaari' } },
    realtime: { params: { eventsPerSecond: 10 } },
  }
);

export const SUPABASE_URL = url || null;

/** The signed-in user's id (or null). */
export const currentUserId = () => supabase.auth.getUser().then((r) => r.data?.user?.id || null);

/** Turn a Supabase error into a sentence a rider can act on. */
export function supabaseErrorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  const raw = error.message || error.error_description || error.msg || '';
  const map = {
    'Invalid login credentials': 'That email or password is not right.',
    'User already registered': 'An account already exists for that email. Try signing in.',
    'Email not confirmed': 'Confirm your email address first — check your inbox.',
    'Password should be at least 6 characters': 'Choose a password of at least 6 characters.',
    'rate limit': 'Too many attempts. Wait a minute and try again.',
    'Failed to fetch': 'Could not reach the server. Check your connection and the server address in Server settings.',
    'JWT': 'Your session expired. Please sign in again.',
  };
  const hit = Object.keys(map).find((k) => raw.toLowerCase().includes(k.toLowerCase()));
  if (hit) return map[hit];
  if (raw.includes('duplicate key')) return 'That account already exists.';
  return raw || fallback;
}
