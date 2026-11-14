/* The ONE Supabase client.
 *
 * Everything the browser talks to — Auth, Postgres (PostgREST), Storage and
 * Realtime — goes through this instance. The URL and the publishable key
 * come from the build environment; the service-role key is NEVER used here
 * (it would bypass every row-level security policy).
 *
 *   VITE_SUPABASE_URL        https://<project-ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY   the anon / publishable key
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  /* Deliberately NOT thrown here: a throw while the modules are still
     loading happens before React can mount the error boundary, and the
     visitor would get a blank page. The app renders this message. */
  console.error(
    '[supabase] This site is not connected to Supabase yet. Set VITE_SUPABASE_URL ' +
    'and VITE_SUPABASE_ANON_KEY, then rebuild (Render: Clear build cache & deploy).'
  );
}

/** True when the build carries a usable Supabase configuration. */
export const isSupabaseConfigured = Boolean(url && anonKey);

/** The message shown when the environment is missing. */
export const CONFIG_ERROR =
  'This site is not connected to Supabase yet. Set VITE_SUPABASE_URL and ' +
  'VITE_SUPABASE_ANON_KEY in the environment, then rebuild ' +
  '(Render: Clear build cache & deploy).';

/** Throws the configuration error — called by every data call. */
export function requireSupabase() {
  if (!isSupabaseConfigured) throw new Error(CONFIG_ERROR);
  return supabase;
}

export const supabase = createClient(url || 'http://127.0.0.1:54321', anonKey || 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: 'implicit',
  },
  global: { headers: { 'x-application-name': 'sawaari' } },
  realtime: { params: { eventsPerSecond: 8 } },
});

export const SUPABASE_URL = url;

/** A sentence a rider can act on, instead of "something went wrong". */
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  const raw = typeof error === 'string' ? error : (error.message || error.error_description || '');
  const code = (error && (error.code || '')) || '';
  const map = [
    ['Invalid login credentials', 'That e-mail address and password do not match.'],
    ['User already registered', 'An account already exists for that e-mail address. Try signing in.'],
    ['Email not confirmed', 'Confirm your e-mail address first — check your inbox.'],
    ['Password should be at least', 'Choose a longer password (at least 6 characters).'],
    ['Failed to fetch', 'Could not reach the server. Check your connection — the Supabase project may be paused.'],
    ['fetch failed', 'Could not reach the server. Check your connection — the Supabase project may be paused.'],
    ['JWT', 'Your session expired. Please sign in again.'],
    ['rate limit', 'Too many attempts. Wait a minute and try again.'],
    ['duplicate key', 'That record already exists.'],
    ['violates row-level security', 'You do not have permission to do that.'],
    ['insufficient_privilege', 'You do not have permission to do that.'],
    ['Unable to validate credentials', 'Could not sign you in — please try again.'],
  ];
  const hit = map.find(([needle]) => raw.toLowerCase().includes(needle.toLowerCase()));
  if (hit) return hit[1];
  if (code === '429') return 'Too many attempts. Wait a minute and try again.';
  return raw || fallback;
}
