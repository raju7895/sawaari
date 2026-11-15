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
