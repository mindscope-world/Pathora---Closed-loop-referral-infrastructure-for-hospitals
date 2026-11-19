import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ROLE_LABELS, type AuthSessionResponse, type AuthUserDto, type LoginRequest, type SignupRequest } from '../../shared/types';
import { authApi, refreshSession, setAccessToken, setSessionLostHandler } from '../lib/api';

/** The shape the dashboard has always consumed (display strings). Derived from the real user. */
export interface AuthUserSession {
  name: string;
  role: string;
  organization: string;
  email: string;
}

export function toSession(user: AuthUserDto): AuthUserSession {
  return { name: user.name, role: ROLE_LABELS[user.role], organization: user.organization.name, email: user.email };
}

interface AuthContextValue {
  /** 'loading' while the saved session (refresh cookie) is being restored on page load. */
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthUserDto | null;
  session: AuthUserSession | null;
  signIn: (req: LoginRequest) => Promise<void>;
  signUp: (req: SignupRequest) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [user, setUser] = useState<AuthUserDto | null>(null);

  const apply = useCallback((s: AuthSessionResponse | null) => {
    setAccessToken(s?.accessToken ?? null);
    setUser(s?.user ?? null);
    setStatus(s ? 'authenticated' : 'anonymous');
  }, []);

  // Restore a previous session from the httpOnly refresh cookie (if any).
  useEffect(() => {
    let cancelled = false;
    refreshSession().then((s) => {
      if (!cancelled) apply(s);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  // If a refresh fails while the app is in use, fall back to signed-out.
  useEffect(() => {
    setSessionLostHandler(() => apply(null));
    return () => setSessionLostHandler(null);
  }, [apply]);

  const signIn = useCallback(async (req: LoginRequest) => apply(await authApi<AuthSessionResponse>('/auth/login', req)), [apply]);
  const signUp = useCallback(async (req: SignupRequest) => apply(await authApi<AuthSessionResponse>('/auth/signup', req)), [apply]);
  const signOut = useCallback(async () => {
    try {
      await authApi('/auth/logout');
    } catch {
      /* even if the server is unreachable, drop the local session */
    }
    apply(null);
  }, [apply]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, session: user ? toSession(user) : null, signIn, signUp, signOut }),
    [status, user, signIn, signUp, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
