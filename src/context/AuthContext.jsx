import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(() => localStorage.getItem('cr_token'));
  const [loading, setLoading] = useState(true);

  // Attach token to every fetch via Authorization header
  const authFetch = useCallback(
    async (path, opts = {}) => {
      const res = await fetch(`${API}${path}`, {
        ...opts,
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...opts.headers,
        },
      });

      // Auto-refresh if access token expired
      if (res.status === 401) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          return fetch(`${API}${path}`, {
            ...opts,
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${refreshed}`,
              ...opts.headers,
            },
          });
        }
      }
      return res;
    },
    [token]
  );

  // Refresh access token using httpOnly refresh cookie
  const refreshAccessToken = async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST', credentials: 'include',
      });
      if (!res.ok) { logout(); return null; }
      const { token: newToken } = await res.json();
      setToken(newToken);
      localStorage.setItem('cr_token', newToken);
      return newToken;
    } catch {
      logout();
      return null;
    }
  };

  // Load current user on mount
  useEffect(() => {
    if (!token) { setLoading(false); return; }
    fetch(`${API}/auth/me`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(({ user }) => setUser(user))
      .catch(() => { setToken(null); localStorage.removeItem('cr_token'); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email, password) => {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('cr_token', data.token);
    return data.user;
  };

  const register = async (fields) => {
    const res = await fetch(`${API}/auth/register`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('cr_token', data.token);
    return data.user;
  };

  const logout = async () => {
    try {
      await fetch(`${API}/auth/logout`, {
        method: 'POST', credentials: 'include',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* swallow */ }
    setUser(null);
    setToken(null);
    localStorage.removeItem('cr_token');
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, authFetch, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
