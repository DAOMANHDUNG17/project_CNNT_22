import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ApiError } from '../lib/api-types';
import type { Identity } from '../lib/api-types';
import { authorizedGet } from '../lib/backend-api';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: Identity | null;
  ready: boolean;
  error: unknown;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Context = createContext<AuthState | null>(null);

function businessUser(): Promise<Identity> {
  return authorizedGet<Identity>('/auth/me');
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<unknown>();
  const initial = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      setUser(await businessUser());
    } catch (failure) {
      setUser(null);
      if (!(failure instanceof ApiError && failure.status === 401)) setError(failure);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    initial.current ??= refresh();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
        setError(undefined);
      }
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  async function login(email: string, password: string) {
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) throw new ApiError(signInError.status ?? 401, 'AUTH_SIGN_IN_FAILED', 'Đăng nhập không thành công.');
    try {
      setUser(await businessUser());
      setError(undefined);
      setReady(true);
    } catch (failure) {
      await supabase.auth.signOut();
      throw failure;
    }
  }

  async function logout() {
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Đăng xuất không thành công.');
    setUser(null);
  }

  return <Context.Provider value={{ user, ready, error, login, logout, refresh }}>{children}</Context.Provider>;
}

export function useAuth() {
  const value = useContext(Context);
  if (!value) throw new Error('Missing AuthProvider');
  return value;
}
