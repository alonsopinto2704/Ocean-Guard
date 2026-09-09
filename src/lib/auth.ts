import type { User, UserRole } from '../types';

const TOKEN_KEY = 'og_token';
const USER_KEY = 'og_user';

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function saveUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return !!getToken() && !!getStoredUser();
}

export function hasRole(user: User | null, ...roles: UserRole[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

export function isAdmin(user: User | null): boolean {
  return hasRole(user, 'ADMIN');
}

export function canAccessAdmin(user: User | null): boolean {
  return hasRole(user, 'ADMIN');
}

export function canManageCleanup(user: User | null): boolean {
  return hasRole(user, 'ADMIN', 'FIELD_OPERATOR', 'CLEANUP_TEAM');
}

export function canViewAnalytics(user: User | null): boolean {
  return hasRole(user, 'ADMIN', 'ENVIRONMENTAL_OFFICER');
}

export function getRoleBadgeColor(role: UserRole): string {
  switch (role) {
    case 'ADMIN': return 'text-red-400 bg-red-500/10 border-red-500/30';
    case 'FIELD_OPERATOR': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
    case 'ENVIRONMENTAL_OFFICER': return 'text-green-400 bg-green-500/10 border-green-500/30';
    case 'CLEANUP_TEAM': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  }
}

export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'ADMIN': return 'Administrator';
    case 'FIELD_OPERATOR': return 'Field Operator';
    case 'ENVIRONMENTAL_OFFICER': return 'Environmental Officer';
    case 'CLEANUP_TEAM': return 'Cleanup Team';
    default: return role;
  }
}
