import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, ApiError } from '../lib/api';
import type { Identity } from '../lib/api';
import { isCloud } from './profile';
import { CloudSessionController } from './cloud-session';
import type { CloudSessionState } from './cloud-session';

interface AuthState {
  user: Identity | null; ready: boolean; error: unknown;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>; refresh: () => Promise<void>;
}
const Context = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  return isCloud ? <CloudAuthProvider>{children}</CloudAuthProvider> : <LocalAuthProvider>{children}</LocalAuthProvider>;
}
function LocalAuthProvider({ children }: { children: ReactNode }) {
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
function CloudAuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CloudSessionState>({ user: null, ready: false, error: undefined });
  const controller = useRef<CloudSessionController | null>(null);
  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unauthorized = () => controller.current?.invalidate();
    window.addEventListener('warehouse:unauthorized', unauthorized);
    void import('./cloud-client').then(({ cloudClient, accessToken }) => {
      if (cancelled) return;
      const sdk = cloudClient();
      const current = new CloudSessionController({
        hasSession: async () => !!await accessToken(),
        signIn: async (email, password) => {
          const { error } = await sdk.auth.signInWithPassword({ email, password });
          if (error) throw new ApiError(error.status === 429 ? 429 : error.status && error.status >= 500 ? 503 : 401,
            'AUTH_SIGN_IN_FAILED', 'Không thể đăng nhập. Kiểm tra tài khoản hoặc thử lại sau.');
        },
        signOut: async () => {
          const { error } = await sdk.auth.signOut({ scope: 'local' });
          if (error) throw new ApiError(503, 'PROVIDER_SIGN_OUT_FAILED', 'Phiên ứng dụng đã bị thu hồi. Chưa xác nhận đăng xuất với dịch vụ xác thực.');
        },
        me: () => api.me({ signal: AbortSignal.timeout(15000) }),
        confirm: () => api.confirmLogin({ signal: AbortSignal.timeout(15000) }),
        revoke: () => api.logout({ signal: AbortSignal.timeout(15000) }),
        publish: setState,
      });
      controller.current = current;
      const { data } = sdk.auth.onAuthStateChange(event => {
        // Never await another SDK operation inside this callback.
        const timer = setTimeout(() => { timers.delete(timer); if (!cancelled) current.changed(event); }, 0);
        timers.add(timer);
      });
      stop = () => { data.subscription.unsubscribe(); current.dispose(); };
      void current.refresh();
    }).catch(() => { if (!cancelled) setState({ user: null, ready: true, error: new Error('Không thể khởi tạo đăng nhập Cloud.') }); });
    return () => {
      cancelled = true; stop?.(); controller.current = null;
      for (const timer of timers) clearTimeout(timer);
      window.removeEventListener('warehouse:unauthorized', unauthorized);
    };
  }, []);
  const current = () => {
    if (!controller.current) throw new ApiError(503, 'AUTH_UNAVAILABLE', 'Đăng nhập chưa sẵn sàng.');
    return controller.current;
  };
  return <Context.Provider value={{ ...state, login: (email, password) => current().login(email, password),
    logout: () => current().logout(), refresh: () => current().refresh() }}>{children}</Context.Provider>;
}
export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing AuthProvider');
  return context;
}
