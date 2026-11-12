import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from '../api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!getToken()) { setLoading(false); return; }
      try {
        const me = await api.get('/api/users/me');
        setUser({ ...me, role: me.role });
      } catch {
        setToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (identifier, password) => {
    const res = await api.post('/api/auth/login', { identifier, password });
    setToken(res.token);
    setUser({ ...res.user });
    return res.user;
  }, []);

  /* ── Administrator sign-in (email + password + mandatory 2FA) ── */
  const adminLogin = useCallback(async (identifier, password) => {
    const res = await api.post('/api/admin-auth/login', { identifier, password });
    if (res.token) {
      setToken(res.token);
      setUser({ ...res.user, permissions: res.user.permissions || [] });
    }
    return res;
  }, []);

  const verifyAdminTwoFactor = useCallback(async (challenge, code) => {
    const res = await api.post('/api/admin-auth/verify-2fa', { challenge, code });
    if (res.token) {
      setToken(res.token);
      setUser({ ...res.user, permissions: res.user.permissions || [] });
    }
    return res;
  }, []);

  const register = useCallback(async (payload) => {
    return api.post('/api/auth/register', payload);
  }, []);

  const verifyOtp = useCallback(async (phone, code, purpose = 'register') => {
    const res = await api.post('/api/auth/verify-otp', { phone, code, purpose });
    if (res.token) {
      setToken(res.token);
      setUser({ ...res.user });
    }
    return res;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    localStorage.removeItem('sawaari-user');
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.get('/api/users/me');
      setUser((u) => ({ ...(u || {}), ...me }));
      return me;
    } catch { return null; }
  }, []);

  return (
    <AuthContext.Provider value={{
      user, loading, login, register, verifyOtp, logout, refreshUser, setUser,
      adminLogin, verifyAdminTwoFactor,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => useContext(AuthContext);
