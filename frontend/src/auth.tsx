import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, SESSION_EXPIRED_EVENT } from './api';

export interface AppUser {
  id: number;
  login: string;
  displayName: string;
  profile: string;
  permissions: string[];
}

interface AuthValue {
  user: AppUser | null;
  loading: boolean;
  signIn: (username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await api.get<{ user: AppUser }>('/session');
      setUser(response.data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  const signIn = async (username: string, password: string) => {
    await api.post('/login', { username, password });
    await refresh();
  };

  const signOut = async () => {
    await api.post('/logout');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, signIn, signOut, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return value;
}