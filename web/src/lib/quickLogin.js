/* The two ways in that do not need an e-mail address.
 *
 *   • a demo account — a shared account anybody may use to look around.
 *     The address and the password come from the build environment (they
 *     are public by design and are printed in the app on purpose), so
 *     nothing secret is in the source.
 *   • a guest — an anonymous account with no address at all. It can
 *     browse and book a ride, but it can never become a driver and never
 *     reaches the console.
 */
import { supabase } from './supabase';

const DEMO = {
  rider: {
    email: import.meta.env.VITE_DEMO_PASSENGER_EMAIL || '',
    password: import.meta.env.VITE_DEMO_PASSENGER_PASSWORD || '',
  },
  driver: {
    email: import.meta.env.VITE_DEMO_DRIVER_EMAIL || '',
    password: import.meta.env.VITE_DEMO_DRIVER_PASSWORD || '',
  },
};

/**
 * True when the demo accounts are meant to be offered on this build.
 * The buttons are shown as soon as an address is known — if a password is
 * missing the button says exactly that, which is more useful than a
 * button that is simply not there.
 */
export function demoAccountsReady() {
  return Boolean(DEMO.rider.email || DEMO.driver.email);
}

/** True when the guest button may be shown. */
export function guestLoginEnabled() {
  return String(import.meta.env.VITE_ENABLE_GUEST || '').toLowerCase() === 'true';
}

/**
 * Signs in as the demo rider or the demo driver.
 * The role in public.profiles decides where the person lands.
 */
export async function demoLogin(role = 'rider') {
  const creds = DEMO[role];
  if (!creds?.email || !creds?.password) {
    const missing = !creds?.email ? 'address' : 'password';
    throw new Error(
      `The demo ${role} account is not configured on this site yet (the ${missing} is missing). `
      + 'Ask an administrator to add it to the build environment.',
    );
  }

  const { data, error } = await supabase.auth.signInWithPassword(creds);
  if (error) {
    const message = (error.message || '').toLowerCase();
    if (error.code === 'invalid_credentials' || message.includes('invalid login')) {
      throw new Error('The demo account does not exist yet, or its password does not match.');
    }
    if (error.code === 'email_not_confirmed') {
      throw new Error('The demo account still has to be confirmed in Supabase.');
    }
    throw new Error(error.message || 'The demo account could not sign in.');
  }
  return data;
}

/**
 * Signs in without an account.
 * Needs "Anonymous sign-ins" to be switched on in Supabase.
 */
export async function guestLogin() {
  if (!guestLoginEnabled()) {
    throw new Error('Guest access is turned off for this site.');
  }

  const { data, error } = await supabase.auth.signInAnonymously({
    options: { data: { role: 'guest', full_name: 'Guest' } },
  });
  if (error) {
    const message = (error.message || '').toLowerCase();
    if (message.includes('anonymous') && message.includes('disabled')) {
      throw new Error('Guest access is disabled in Supabase. An administrator can turn it on under Authentication → Sign In / Providers.');
    }
    if (message.includes('captcha')) {
      throw new Error('A CAPTCHA is required for guest access. Ask an administrator to turn it off or to add the widget.');
    }
    if (message.includes('database error')) {
      throw new Error('The guest profile could not be created. Ask an administrator to run supabase/guest-login.sql.');
    }
    if (error.status === 429) {
      throw new Error('Too many guest sign-ins from this network. Please try again in a minute.');
    }
    throw new Error(error.message || 'Guest access is not available at the moment.');
  }
  return data;
}

/**
 * Turns a guest into a real account — the same user id, so the rides they
 * booked are kept.
 */
export async function upgradeGuest(email, password) {
  const { error } = await supabase.auth.updateUser({ email, password });
  if (error) {
    const message = (error.message || '').toLowerCase();
    if (message.includes('email address') && message.includes('registered')) {
      throw new Error('That e-mail address already has an account. Sign in with it instead.');
    }
    if (message.includes('password')) {
      throw new Error('That password is not strong enough. Use at least 8 characters.');
    }
    throw new Error(error.message || 'The account could not be changed.');
  }
  return true;
}
