'use client';
import React, {
  createContext, useContext, useState, useCallback, useEffect, type ReactNode
} from 'react';
import { authApi } from '../lib/api';
import {
  saveToken, saveUser, clearToken, getToken, getStoredUser, isAuthenticated as checkAuth
} from '../lib/auth';
import type { User, AuthState } from '../types';

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: getStoredUser(),
    token: getToken(),
    isLoading: false,
    isAuthenticated: checkAuth(),
  });

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

  const logout = useCallback(async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearToken();
    setState({ user: null, token: null, isLoading: false, isAuthenticated: false });
  }, []);

  const refreshUser = useCallback(async () => {
    if (!getToken()) return;
    try {
      const { user } = await authApi.me();
      saveUser(user);
      setState(s => ({ ...s, user, isAuthenticated: true }));
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

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
