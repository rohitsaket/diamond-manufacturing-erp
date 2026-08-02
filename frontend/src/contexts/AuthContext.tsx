import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { api, tokenStore, ApiError, setUnauthorizedHandler } from '../api/client';

interface AuthUser {
  email: string;
  name: string;
  role: string;
  /** Set only for self-service logins; links the account to an employee record. */
  employeeId?: number | null;
  theme?: 'light' | 'dark' | 'system';
  mustChangePassword?: boolean;
  avatarUrl?: string | null;
}

/** Roles that may see company-wide screens. Self-service workers may not. */
export const STAFF_ROLES = ['admin', 'manager', 'operator', 'accountant', 'hr'];

export function isStaffRole(role: string | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const AUTH_KEY = 'harene_auth';

function loadSession(): AuthUser | null {
  // Only trust a stored user if we also still hold a token.
  if (!tokenStore.get()) return null;
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (raw) return JSON.parse(raw) as AuthUser;
  } catch {
    /* ignore */
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(loadSession);

  const login = useCallback(async (email: string, password: string) => {
    if (!email.trim()) return { success: false, error: 'Email is required' };
    if (!password.trim()) return { success: false, error: 'Password is required' };

    try {
      const res = await api.post<LoginResponse>('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });
      tokenStore.set(res.token);
      localStorage.setItem(AUTH_KEY, JSON.stringify(res.user));
      setUser(res.user);
      return { success: true };
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.';
      return { success: false, error: message };
    }
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    localStorage.removeItem(AUTH_KEY);
    setUser(null);
  }, []);

  // Let the API client sign the user out on any 401 (expired/invalid token).
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ isAuthenticated: !!user, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
