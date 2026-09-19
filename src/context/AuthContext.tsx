// NOTE: 'use client' is a Next.js directive — dead code in this Vite SPA, so it was removed.
import {
  createContext, useContext, useState, useCallback, useEffect, type ReactNode
} from 'react';
import { authApi } from '../lib/api';
import {
  saveToken, saveUser, clearToken, getToken, getStoredUser, isAuthenticated as checkAuth
} from '../lib/auth';
import type { AuthState } from '../types';

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// Context is kept null until a provider mounts, so useAuth() can detect misuse.
const AuthContext = createContext<AuthContextValue | null>(null);

/** Top-level auth provider: owns session state, login/logout, and token validation. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: getStoredUser(),
    token: getToken(),
    // Keep protected routes behind the auth check when a stored token exists.
    isLoading: checkAuth(),
    isAuthenticated: checkAuth(),
  });

  /** Authenticate against the API, persist the session, and swap in the fresh state. */
  const login = useCallback(async (email: string, password: string) => {
    setState(s => ({ ...s, isLoading: true }));
    try {
      const { token, user } = await authApi.login(email, password);
      saveToken(token);
      saveUser(user);
      setState({ user, token, isLoading: false, isAuthenticated: true });
    } catch (err) {
      setState(s => ({ ...s, isLoading: false }));
      throw err;
    }
  }, []);

  /** Best-effort server logout, then always clear local session state. */
  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearToken();
    setState({ user: null, token: null, isLoading: false, isAuthenticated: false });
  }, []);

  /** Re-fetch the profile to validate the token; clears the session if invalid/expired. */
  const refreshUser = useCallback(async () => {
    if (!getToken()) return;
    try {
      const { user } = await authApi.me();
      saveUser(user);
      setState(s => ({ ...s, user, isLoading: false, isAuthenticated: true }));
    } catch {
      clearToken();
      setState({ user: null, token: null, isLoading: false, isAuthenticated: false });
    }
  }, []);

  // Validate token on mount
  useEffect(() => {
    if (checkAuth()) {
      refreshUser();
    }
  }, [refreshUser]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Access auth state + actions; throws if used outside <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
