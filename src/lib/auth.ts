import type { User, UserRole } from '../types';

// localStorage keys shared with the API layer (lib/api.ts reads og_token directly).
const TOKEN_KEY = 'og_token';
const USER_KEY = 'og_user';

/** Persist the JWT for subsequent API requests. */
export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

/** Read the stored JWT, or null when logged out. */
export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/** Wipe both token and cached user on logout / auth failure. */
export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Cache the user profile so the UI can hydrate without a network round-trip. */
export function saveUser(user: User): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/** Parse the cached user profile; corrupt JSON is treated as logged-out. */
export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** A session counts as active only when BOTH token and cached user exist. */
export function isAuthenticated(): boolean {
  return !!getToken() && !!getStoredUser();
}

/** True when the user carries any of the given roles. Generic role gate. */
export function hasRole(user: User | null, ...roles: UserRole[]): boolean {
  if (!user) return false;
  return roles.includes(user.role);
}

// Removed dead code: isAdmin(), canAccessAdmin(), canManageCleanup(),
// canViewAnalytics() were defined but never imported anywhere (isAdmin and
// canAccessAdmin were exact duplicates). Add such wrappers back if needed.

/** Tailwind classes for the colored role badge in the admin user table. */
export function getRoleBadgeColor(role: UserRole): string {
  switch (role) {
    case 'ADMIN': return 'text-red-400 bg-red-500/10 border-red-500/30';
    case 'FIELD_OPERATOR': return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30';
    case 'ENVIRONMENTAL_OFFICER': return 'text-green-400 bg-green-500/10 border-green-500/30';
    case 'CLEANUP_TEAM': return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
    default: return 'text-slate-400 bg-slate-500/10 border-slate-500/30';
  }
}

/** Human-readable label for each role, shown instead of the raw enum. */
export function getRoleLabel(role: UserRole): string {
  switch (role) {
    case 'ADMIN': return 'Administrator';
    case 'FIELD_OPERATOR': return 'Field Operator';
    case 'ENVIRONMENTAL_OFFICER': return 'Environmental Officer';
    case 'CLEANUP_TEAM': return 'Cleanup Team';
    default: return role;
  }
}
