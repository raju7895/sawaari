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

/**
 * An error from Supabase Auth that still carries the machine-readable code,
 * so a screen can react to it (an unconfirmed e-mail goes to the verify
 * screen, for example) instead of only showing a sentence.
 */
export class AuthError extends Error {
  constructor(message, error) {
    super(message);
    this.name = 'AuthError';
    this.code = (error && (error.code || error.error_code)) || '';
    this.status = (error && error.status) || 0;
    this.raw = (error && (error.message || error.error_description)) || message;
  }
}

/** A sentence a rider can act on, instead of "something went wrong". */
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  const raw = typeof error === 'string' ? error : (error.message || error.error_description || '');
  const code = (error && (error.code || error.error_code)) || '';

  /* The machine code says exactly what happened. It is checked first, so a
     used-up mail quota is never shown as "too many attempts". */
  const byCode = [
    ['over_email_send_rate_limit', 'We cannot send e-mails at the moment — the mail quota is used up. Try again in a minute, or ask an administrator to set your password.'],
    ['email_exists', 'An account already exists for that e-mail address. Try signing in.'],
    ['email_not_confirmed', 'Confirm your e-mail address first — we sent you a code.'],
    ['email_address_invalid', 'That e-mail address does not look right.'],
    ['phone_provider_disabled', 'Phone sign-in is not switched on for this platform yet. Please use your e-mail address and password.'],
    ['sms_provider_not_configured', 'Phone sign-in is not switched on for this platform yet. Please use your e-mail address and password.'],
    ['sms_send_failed', 'The SMS could not be sent. Please try again in a minute, or sign in with your e-mail address.'],
    ['over_sms_send_rate_limit', 'Too many SMS were sent. Please wait a minute and try again.'],
    ['over_request_rate_limit', 'Too many attempts. Please wait a minute and try again.'],
    ['weak_password', 'That password is too weak. Use at least 8 characters with a number and a letter.'],
    ['otp_expired', 'That code is not right or has expired. Type it again, or ask for a new one.'],
    ['signup_disabled', 'Sign-ups are closed at the moment. Please try again later.'],
  ];
  const hitCode = byCode.find(([needle]) => code === needle);
  if (hitCode) return hitCode[1];

  const map = [
    ['Invalid login credentials', 'That e-mail address and password do not match.'],
    ['User already registered', 'An account already exists for that e-mail address. Try signing in.'],
    ['already been registered', 'An account already exists for that e-mail address. Try signing in.'],
    ['Email not confirmed', 'Confirm your e-mail address first — we sent you a code.'],
    ['Password should be at least', 'Choose a longer password (at least 6 characters).'],
    ['Failed to fetch', 'Could not reach the server. Check your connection — the Supabase project may be paused.'],
    ['fetch failed', 'Could not reach the server. Check your connection — the Supabase project may be paused.'],
    ['NetworkError', 'Could not reach the server. Check your connection and try again.'],
    ['JWT', 'Your session expired. Please sign in again.'],
    ['Token has expired or is invalid', 'That code is not right or has expired. Type it again, or ask for a new one.'],
    ['expired_token', 'That code has expired. Ask for a new one.'],
    ['invalid_token', 'That code is not right. Check the digits and type it again.'],
    ['Unable to validate credentials', 'Could not sign you in — please try again.'],
    ['duplicate key', 'That record already exists.'],
    ['violates row-level security', 'You do not have permission to do that.'],
    ['insufficient_privilege', 'You do not have permission to do that.'],
    /* the mail quota — that is NOT an attempt limit, so it must never be
       shown as one */
    ['email rate limit exceeded', 'We cannot send e-mails at the moment — the mail quota is used up. Try again in a minute, or ask an administrator to set your password.'],
    ['Error sending confirmation email', 'We could not send the e-mail. Please try again in a minute.'],
    ['Error sending magic link email', 'We could not send the e-mail. Please try again in a minute.'],
    ['Error sending sms', 'The SMS could not be sent. Please try again in a minute, or sign in with your e-mail address.'],
    ['Unsupported phone provider', 'Phone sign-in is not switched on for this platform yet. Please use your e-mail address and password.'],
    ['Phone provider not configured', 'Phone sign-in is not switched on for this platform yet. Please use your e-mail address and password.'],
    ['Phone number should conform to E.164', 'That mobile number does not look right. Use the international form, for example +919876543210.'],
    ['Phone number is not valid', 'That mobile number does not look right. Use the international form, for example +919876543210.'],
    ['invalid_phone', 'That mobile number does not look right. Use the international form, for example +919876543210.'],
    ['signup is disabled', 'Sign-ups are closed at the moment. Please try again later.'],
    ['Email address invalid', 'That e-mail address does not look right.'],
    /* anything else that smells like a limit */
    ['rate limit', 'Too many attempts. Please wait a minute and try again.'],
  ];
  const hit = map.find(([needle]) => raw.toLowerCase().includes(needle.toLowerCase()));
  if (hit) return hit[1];
  if (code === '429' || code === 'over_email_send_rate_limit') {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  return raw || fallback;
}
