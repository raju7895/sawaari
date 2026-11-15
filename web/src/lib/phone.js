/* Mobile numbers.
 *
 * Supabase wants the international form — E.164 — and nothing else:
 * "+919876543210". A number with spaces, a leading zero or no country
 * code is refused ("Phone number should conform to E.164 format"), and
 * the error arrives long after the visitor has typed their number, which
 * is a bad way to find out.
 *
 * So the number is put into one form before it is sent anywhere, and the
 * same form is stored in the database (public.profiles.phone and
 * auth.users.phone).
 */

/** The country code used for a plain 10-digit Indian mobile number. */
export const DEFAULT_COUNTRY = '+91';

/**
 * Turns whatever was typed into E.164.
 *   "9876543210"          → "+919876543210"
 *   "09876543210"         → "+919876543210"
 *   "+91 98765 43210"     → "+919876543210"
 *   "+919876543210"       → "+919876543210"
 */
export function toE164(input, country = DEFAULT_COUNTRY) {
  const raw = String(input ?? '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `${country}${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `${country}${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11) return `+${digits}`;
  return `+${digits}`;
}

/** True when the number can be sent to Supabase. */
export function isValidE164(phone) {
  const value = String(phone || '');
  if (!/^\+[1-9]\d{7,14}$/.test(value)) return false;
  /* an Indian number always has ten digits after the country code */
  if (value.startsWith('+91') && value.length !== 13) return false;
  return true;
}

/**
 * The number as a person reads it: "+91 98765 43210".
 * Used for the screens — the database keeps the E.164 form.
 */
export function formatPhone(phone) {
  const e164 = toE164(phone);
  if (!isValidE164(e164)) return String(phone || '');
  const country = e164.slice(1, 3);
  const rest = e164.slice(3);
  if (rest.length !== 10) return e164;
  return `+${country} ${rest.slice(0, 5)} ${rest.slice(5)}`;
}

/** The number without the country code — what the sign-up form asks for. */
export function nationalNumber(phone) {
  const e164 = toE164(phone);
  if (!isValidE164(e164)) return String(phone || '');
  const rest = e164.slice(3);
  return rest.length === 10 ? rest : e164.slice(1);
}
