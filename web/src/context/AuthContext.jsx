import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '../lib/supabase';
import { myProfile } from '../lib/api';

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
      },
    });
    if (error) throw new Error(friendlyError(error, 'Could not create the account.'));
    return {
      needsEmailConfirmation: !data.session,
      email: String(email).trim().toLowerCase(),
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email).trim().toLowerCase(),
      password,
    });
    if (error) throw new Error(friendlyError(error, 'Could not sign you in.'));
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
    refreshProfile,
  }), [session, profile, role, loading, blocked, signUp, signIn, signOut, refreshProfile]);

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
