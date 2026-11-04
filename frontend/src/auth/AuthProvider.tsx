import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import type { Identity } from '../lib/api';

interface AuthState {
  user: Identity | null; ready: boolean; error: unknown;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>; refresh: () => Promise<void>;
}
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>();
  const initialRestore = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => {
    setError(undefined);
    try { setUser((await api.me({ signal: AbortSignal.timeout(15000) })).data); }
    catch (failure) {
      setUser(null);
      if (!(failure instanceof ApiError && failure.status === 401)) setError(failure);
    } finally { setReady(true); }
  }, []);
  useEffect(() => {
    const unauthorized = () => { setUser(null); setError(undefined); };
    window.addEventListener('warehouse:unauthorized', unauthorized);
    initialRestore.current ??= refresh();
    return () => window.removeEventListener('warehouse:unauthorized', unauthorized);
  }, [refresh]);
  async function login(username: string, password: string) {
    const result = await api.login(username, password, { signal: AbortSignal.timeout(15000) });
    setUser(result.data); setError(undefined); setReady(true);
  }
  async function logout() { await api.logout({ signal: AbortSignal.timeout(15000) }); setUser(null); }
  return <Context.Provider value={{ user, ready, error, login, logout, refresh }}>{children}</Context.Provider>;
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing AuthProvider');
  return context;
}
