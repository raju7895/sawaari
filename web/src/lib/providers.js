/* Which sign-in methods the platform really has.
 *
 * The Auth service answers /auth/v1/settings with what is switched on.
 * A button that cannot work is worse than no button — so the Google
 * button only appears once the provider is really enabled in Supabase
 * (Authentication → Sign In / Providers → Google).
 *
 * The answer is asked for once and then remembered.
 */
import { SUPABASE_URL } from './supabase';

const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let google = null;

export async function googleProviderEnabled() {
  if (google !== null) return google;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: ANON },
    });
    const data = await res.json();
    google = Boolean(data?.external?.google);
  } catch {
    google = false;
  }
  return google;
}

/** Forgets the answer — used when the owner has just switched it on. */
export function forgetProviders() {
  google = null;
}
