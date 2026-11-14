import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase, supabaseErrorMessage, isSupabaseConfigured } from '../lib/supabase';
import { api, setToken, getToken } from '../lib/api';

const AuthContext = createContext(null);

/**
 * Authentication is Supabase Auth from now on.
 *
 * The session lives in localStorage (managed by supabase-js) and is
 * refreshed automatically; the rider's row in `profiles` is the
 * application profile (role, name, rating, …).
 *
 * The method names are unchanged, so every page keeps working:
 *   login(identifier, password)  → signInWithPassword
 *   register(payload)            → signUp (+ metadata: full_name, phone, role)
 *   logout()                     → signOut
 *   refreshUser()                → re-read the profile
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  /* ── the session drives everything ─────────────────────────────────── */
  useEffect(() => {
    let active = true;

    const applySession = async (next) => {
      if (!active) return;
      setSession(next);
      if (!next?.user) {
        setUser(null);
        setLoading(false);
        setToken(null);
        return;
      }
      // the Supabase access token replaces the old own-JWT
      setToken(next.access_token);
      try {
        const profile = await api.get('/api/users/me');
        if (active) setUser({ ...profile, role: profile.role, email: profile.email || next.user.email });
      } catch {
        if (active) setUser({ id: next.user.id, email: next.user.email, role: next.user.role });
      } finally {
        if (active) setLoading(false);
      }
    };

    if (!isSupabaseConfigured) {
      // no Supabase configured → keep the old token-based session working
      const legacy = getToken();
      if (!legacy) { setLoading(false); return; }
      api.get('/api/users/me')
        .then((profile) => { if (active) setUser({ ...profile, role: profile.role }); })
        .catch(() => setToken(null))
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }

    supabase.auth.getSession().then(({ data }) => applySession(data.session));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      // avoid a deadlock: Supabase warns against awaiting other calls inside this callback
      setTimeout(() => applySession(next), 0);
    });

    return () => { active = false; subscription.subscription.unsubscribe(); };
  }, []);

  const login = useCallback(async (identifier, password) => {
    if (!isSupabaseConfigured) {
      const res = await api.post('/api/auth/login', { identifier, password });
      setToken(res.token);
      setUser({ ...res.user });
      return res.user;
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(identifier).trim().toLowerCase(),
      password,
    });
    if (error) throw new Error(supabaseErrorMessage(error, 'Could not sign you in.'));
    const profile = await api.get('/api/users/me');
    setUser({ ...profile, role: profile.role });
    return profile;
  }, []);

  const register = useCallback(async (payload) => {
    if (!isSupabaseConfigured) return api.post('/api/auth/register', payload);
    const email = String(payload.email || '').trim().toLowerCase();
    if (!email) throw new Error('An e-mail address is required to create an account.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password: payload.password,
      options: {
        data: {
          full_name: payload.name,
          phone: payload.phone,
          role: payload.role === 'driver' ? 'driver' : 'passenger',
        },
      },
    });
    if (error) throw new Error(supabaseErrorMessage(error, 'Could not create the account.'));
    // the profile row is created by the database trigger from this metadata
    if (data.session) {
      const profile = await api.get('/api/users/me');
      setUser({ ...profile, role: profile.role });
    }
    return {
      message: data.session
        ? 'Welcome to Sawaari!'
        : 'Check your inbox and confirm your e-mail address to finish signing up.',
      needsEmailConfirmation: !data.session,
    };
  }, []);

  const logout = useCallback(async () => {
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
    setToken(null);
    localStorage.removeItem('sawaari-user');
    setUser(null);
    setSession(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const profile = await api.get('/api/users/me');
      setUser({ ...profile, role: profile.role });
      return profile;
    } catch {
      return null;
    }
  }, []);

  const value = {
    user,
    session,
    loading,
    login,
    register,
    logout,
    refreshUser,
    isSupabase: isSupabaseConfigured,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
