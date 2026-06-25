import { createContext, useContext, useState, useEffect, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '/api';

const AuthContext = createContext(null);

async function parseResponse(res) {
  const text = await res.text();
  if (!text) throw new Error(`Server error ${res.status} — empty response`);
  try {
    return JSON.parse(text);
  } catch {
    // Server returned HTML (e.g. Vercel error page) or plain text
    if (res.status === 500) throw new Error('Server error — backend may be unreachable');
    if (res.status === 502 || res.status === 503) throw new Error('Backend is offline — please try again later');
    if (res.status === 429) throw new Error('Too many attempts — please wait 15 minutes');
    throw new Error(`Unexpected response (${res.status})`);
  }
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [token,   setToken]   = useState(() => localStorage.getItem('cr_token'));
  const [loading, setLoading] = useState(true);

  const authFetch = useCallback(
    async (path, opts = {}) => {
      let res;
      try {
        res = await fetch(`${API}${path}`, {
          ...opts,
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...opts.headers,
          },
        });
      } catch {
        throw new Error('Cannot reach server — check your connection');
      }

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
    let res;
    try {
      res = await fetch(`${API}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      throw new Error('Cannot reach server — is the backend running?');
    }

    const data = await parseResponse(res);
    if (!res.ok) throw new Error(data.error || `Login failed (${res.status})`);
    setToken(data.token);
    setUser(data.user);
    localStorage.setItem('cr_token', data.token);
    return data.user;
  };

  const register = async (fields) => {
    let res;
    try {
      res = await fetch(`${API}/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
    } catch {
      throw new Error('Cannot reach server — is the backend running?');
    }

    const data = await parseResponse(res);
    if (!res.ok) throw new Error(data.error || `Registration failed (${res.status})`);
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
