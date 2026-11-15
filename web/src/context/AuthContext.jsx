import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError, AuthError } from '../lib/supabase';
import { myProfile } from '../lib/api';
import { toE164, isValidE164 } from '../lib/phone';

/** Where the confirmation link goes when the visitor clicks it. */
const CALLBACK_PATH = '/auth/callback';

/** The link the e-mail should send people back to. */
function callbackUrl() {
  return `${window.location.origin}${CALLBACK_PATH}`;
}

const AuthContext = createContext(null);

/**
 * The session (Supabase Auth) plus the profile row (the application
 * profile: role, name, phone, avatar).
 *
 * The role decides where a person lands after signing in:
 *   rider  → /passenger
 *   driver → /driver
 *   admin  → /admin
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);

  const loadProfile = useCallback(async (user) => {
    if (!user) {
      setProfile(null);
      setBlocked(false);
      return null;
    }
    try {
      const row = await myProfile();
      setProfile(row);
      const isBlocked = Boolean(row?.is_blocked);
      setBlocked(isBlocked);
      if (isBlocked) {
        // a blocked account is signed out with a message
        await supabase.auth.signOut();
        setSession(null);
        setProfile(null);
      }
      return row;
    } catch {
      setProfile(null);
      return null;
    }
  }, []);

  /* the session survives a refresh — supabase-js restores it from storage */
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session ?? null);
      await loadProfile(data.session?.user ?? null);
      if (active) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, next) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setProfile(null);
        setBlocked(false);
        setLoading(false);
        return;
      }
      if (event === 'TOKEN_REFRESHED') {
        setSession(next);
        return;
      }
      setSession(next);
      setLoading(true);
      await loadProfile(next?.user ?? null);
      setLoading(false);
    });

    return () => { active = false; subscription.unsubscribe(); };
  }, [loadProfile]);

  const signUp = useCallback(async ({ fullName, phone, email, password, role }) => {
    const { data, error } = await supabase.auth.signUp({
      email: String(email).trim().toLowerCase(),
      password,
      options: {
        data: {
          full_name: fullName,
          phone,
          role: role === 'driver' ? 'driver' : 'rider',
        },
        /* where the confirmation link sends the visitor back to */
        emailRedirectTo: callbackUrl(),
      },
    });
    if (error) throw new AuthError(friendlyError(error, 'Could not create the account.'), error);
    return {
      needsEmailConfirmation: !data.session,
      email: String(email).trim().toLowerCase(),
      role: role === 'driver' ? 'driver' : 'rider',
    };
  }, []);

  /**
   * Sends the 6-digit code by e-mail.
   *   • sign-up  → "Confirm signup"  (the code that verifies the address)
   *   • sign-in  → "Magic Link"     (the code that signs somebody in)
   */
  const sendCode = useCallback(async (email, { shouldCreateUser = false } = {}) => {
    const { error } = await supabase.auth.signInWithOtp({
      email: String(email).trim().toLowerCase(),
      options: {
        shouldCreateUser,
        emailRedirectTo: callbackUrl(),
      },
    });
    if (error) throw new AuthError(friendlyError(error, 'Could not send the code.'), error);
    return true;
  }, []);

  /**
   * Asks for the confirmation code again (the button on the verify screen).
   *
   * Only the "signup" code can be re-sent this way — GoTrue's resend
   * endpoint knows "signup", "email_change" and "sms". The code that signs
   * somebody in is sent again with sendCode().
   */
  const resendCode = useCallback(async (email, type = 'signup') => {
    const { error } = await supabase.auth.resend({
      type,
      email: String(email).trim().toLowerCase(),
      options: { emailRedirectTo: callbackUrl() },
    });
    if (error) throw new AuthError(friendlyError(error, 'Could not send the code.'), error);
    return true;
  }, []);

  /**
   * Checks the 6-digit code.
   *
   * The type "email" is the one that covers every flow: GoTrue compares the
   * code with the confirmation code of a sign-up and with the recovery code
   * of a sign-in, so the same screen works for all of them.
   */
  const verifyCode = useCallback(async (email, token, type = 'email') => {
    const address = String(email).trim().toLowerCase();
    const { data, error } = await supabase.auth.verifyOtp({ email: address, token, type });
    if (error) throw new AuthError(friendlyError(error, 'That code is not valid.'), error);
    return data;
  }, []);

  /** The password reset e-mail: a link that opens /reset-password. */
  const sendResetLink = useCallback(async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(
      String(email).trim().toLowerCase(),
      { redirectTo: `${window.location.origin}/reset-password` },
    );
    if (error) throw new AuthError(friendlyError(error, 'Could not send the reset e-mail.'), error);
    return true;
  }, []);

  /**
   * Sends the 6-digit code by SMS.
   *
   * The number is put into the international form first — Supabase only
   * accepts that one. The error is always checked: the screen must not
   * say "the code is on its way" when nothing was sent.
   */
  const sendPhoneCode = useCallback(async (phone, { data, shouldCreateUser = true } = {}) => {
    const number = toE164(phone);
    if (!isValidE164(number)) {
      throw new AuthError(
        'That mobile number does not look right. Use the international form, for example +919876543210.',
        { code: 'invalid_phone' },
      );
    }
    const { error } = await supabase.auth.signInWithOtp({
      phone: number,
      options: { shouldCreateUser, data, channel: 'sms' },
    });
    if (error) throw new AuthError(friendlyError(error, 'We could not send the code by SMS.'), error);
    return number;
  }, []);

  /** Asks for the SMS code again. */
  const resendPhoneCode = useCallback(async (phone) => {
    const number = toE164(phone);
    const { error } = await supabase.auth.resend({ type: 'sms', phone: number });
    if (error) throw new AuthError(friendlyError(error, 'We could not send the code by SMS.'), error);
    return number;
  }, []);

  /** Checks the 6-digit code that arrived by SMS. */
  const verifyPhoneCode = useCallback(async (phone, token) => {
    const number = toE164(phone);
    const { data, error } = await supabase.auth.verifyOtp({ phone: number, token, type: 'sms' });
    if (error) throw new AuthError(friendlyError(error, 'That code is not valid.'), error);
    return data;
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password,
    });
    if (error) throw new AuthError(friendlyError(error, 'Could not sign you in.'), error);
    await loadProfile(data.user);
    return data.user;
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    setBlocked(false);
  }, []);

  const refreshProfile = useCallback(async () => {
    const row = await loadProfile(session?.user ?? null);
    return row;
  }, [loadProfile, session]);

  const role = profile?.role || (session ? 'rider' : null);

  const value = useMemo(() => ({
    session,
    user: session?.user ?? null,
    profile,
    role,
    loading,
    blocked,
    signUp,
    signIn,
    signOut,
    sendCode,
    resendCode,
    verifyCode,
    sendResetLink,
    sendPhoneCode,
    resendPhoneCode,
    verifyPhoneCode,
    refreshProfile,
  }), [session, profile, role, loading, blocked, signUp, signIn, signOut, sendCode, resendCode, verifyCode, sendResetLink, sendPhoneCode, resendPhoneCode, verifyPhoneCode, refreshProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** Where a person belongs after signing in. */
export function homeFor(role) {
  if (role === 'admin') return '/admin';
  if (role === 'driver') return '/driver';
  return '/passenger';
}
