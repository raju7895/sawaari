/* The ways of getting in that are switched on.
 *
 * A button that cannot work is worse than no button: the visitor types
 * their number, the screen says "the code is on its way", and nothing
 * ever arrives. So the extra ways in are only shown when the thing they
 * need is really there:
 *
 *   VITE_ENABLE_PHONE_OTP   a phone provider (Twilio Verify & co.) is
 *                            set up in Supabase
 *   VITE_ENABLE_EMAIL_OTP   a working SMTP provider is set up, so the
 *                            6-digit e-mail code really arrives
 *
 * E-mail and password always work — they need nothing but the project.
 * Both flags default to off, so a missing provider can never be seen by
 * a visitor.
 */

const flag = (name) => String(import.meta.env[name] || '').toLowerCase() === 'true';

/** Sign in with a 6-digit code that arrives by SMS. */
export const PHONE_OTP_ENABLED = flag('VITE_ENABLE_PHONE_OTP');

/** Sign in with a 6-digit code that arrives by e-mail. */
export const EMAIL_OTP_ENABLED = flag('VITE_ENABLE_EMAIL_OTP');

/**
 * Sign in without an account ("Try as Guest").
 *
 * It needs "Anonymous sign-ins" to be switched on in the Supabase
 * dashboard (Authentication → Sign In / Providers → Anonymous sign-ins).
 * A guest can look around and book a ride; the account cannot be reached
 * again, because there is no address to sign in with.
 */
export const GUEST_LOGIN_ENABLED = flag('VITE_ENABLE_GUEST_LOGIN') !== 'false';

/**
 * The shared demo account.
 *
 * The address is public by design — it is the point of a demo account.
 * The password is not written in the code: it comes from the build
 * environment, and the account itself is created in the Supabase
 * dashboard (or with supabase/guest-login.sql).
 */
export const DEMO_EMAIL = import.meta.env.VITE_DEMO_ACCOUNT_EMAIL || '';
export const DEMO_PASSWORD = import.meta.env.VITE_DEMO_ACCOUNT_PASSWORD || '';
