/**
 * Client-side authentication helper.
 *
 * ⚠️ This file is a *convenience wrapper around the server*, not an authority.
 * Everything it reports is fetched from the backend; nothing here decides
 * whether a request is allowed. The previous version of this module was the
 * opposite: it held a hard-coded super-admin password, auto-created that
 * account in Firebase when a login missed, and — when the API was unreachable
 * — handed out a static root token that the server accepted as SUPER_ADMIN.
 * Anyone who read the deployed JavaScript bundle therefore had admin.
 *
 * The old behaviour is gone. Concretely:
 *   - no credential of any kind is stored in this bundle;
 *   - the "is this an admin?" answer comes from `GET /api/security/auth/session`,
 *     which the server resolves from an httpOnly signed session cookie;
 *   - a failed/unreachable API means *not authenticated*, never "assume admin".
 *
 * @license Apache-2.0
 */

import type { Role } from '../src/types';
import {
  AUTH_EXPIRED_EVENT,
  apiFetch,
  apiFetchJson,
  getStaffToken,
  setStaffToken,
  setCustomerToken,
} from '../src/lib/apiClient';

export type { Role };

export interface StaffSessionUser {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: Role;
  status?: string;
  twoFactorEnabled?: boolean;
  lastLoginAt?: string;
  mustChangePassword?: boolean;
}

export interface StaffSession {
  valid: boolean;
  user: StaffSessionUser | null;
  role: Role | null;
  permissions: string[];
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
}

export interface AuthResponse {
  success: boolean;
  error?: string;
  errorBn?: string;
  code?: string;
  user?: StaffSessionUser;
  role?: Role;
  mustChangePassword?: boolean;
  requires2FA?: boolean;
  retryAfterSeconds?: number;
}

const EMPTY_SESSION: StaffSession = {
  valid: false,
  user: null,
  role: null,
  permissions: [],
  mustChangePassword: false,
  twoFactorEnabled: false,
};

// ─────────────────────────── role helpers (UI only) ──────────────────────────

const STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'FINANCE', 'SUPPORT', 'STAFF'];

export const AUTHORIZED_ADMIN_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'FINANCE', 'SUPPORT'];

/**
 * Purely a UI hint so the shell can render the right sidebar. It is not a
 * security boundary — the API rejects unauthorised calls regardless of what
 * this returns, which is the whole point of `server/authGuard.ts`.
 */
export function isAdminRole(target?: Role | string | null | Record<string, unknown>): boolean {
  if (!target) return false;
  if (typeof target === 'string') return STAFF_ROLES.includes(target as Role);
  const role = (target as Record<string, unknown>).role;
  if (typeof role === 'string' && STAFF_ROLES.includes(role as Role)) return true;
  const claims = (target as Record<string, unknown>).customClaims as Record<string, unknown> | undefined;
  const claimRole = claims?.role;
  if (typeof claimRole === 'string' && STAFF_ROLES.includes(claimRole as Role)) return true;
  return (target as Record<string, unknown>).admin === true || (target as Record<string, unknown>).isStaff === true;
}

export function isSuperAdmin(role?: Role | string | null): boolean {
  return role === 'SUPER_ADMIN';
}

export function isCustomerRole(role?: Role | string | null): boolean {
  return role === 'CUSTOMER';
}

/**
 * Route → role matrix for the admin shell. Kept so navigation can hide what a
 * role cannot use; enforced again (with the real permission strings) on the
 * server by `server/routePermissions.ts`.
 */
export const RBAC_ROUTE_PERMISSIONS: Record<string, Role[]> = {
  '/admin': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'FINANCE', 'SUPPORT', 'STAFF'],
  '/admin/orders': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'SUPPORT', 'FINANCE'],
  '/admin/products': ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER'],
  '/admin/categories': ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER'],
  '/admin/inventory': ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER'],
  '/admin/suppliers': ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'INVENTORY_MANAGER'],
  '/admin/customers': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'ORDER_MANAGER'],
  '/admin/payments': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  '/admin/shipments': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER'],
  '/admin/fulfillment': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_MANAGER'],
  '/admin/returns': ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'SUPPORT', 'ORDER_MANAGER'],
  '/admin/refunds': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  '/admin/finance': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  '/admin/reports': ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'ORDER_MANAGER'],
  '/admin/analytics': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  '/admin/operations': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'SUPPORT'],
  '/admin/content': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/promotions': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/marketing': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/fraud': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
  '/admin/settings': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/users': ['SUPER_ADMIN'],
  '/admin/rbac': ['SUPER_ADMIN'],
  '/admin/roles': ['SUPER_ADMIN'],
  '/admin/audit': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/backup': ['SUPER_ADMIN'],
};

export function canAccessAdminRoute(role: Role | string | null | undefined, routePath: string): boolean {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  const exact = RBAC_ROUTE_PERMISSIONS[routePath];
  if (exact) return exact.includes(role as Role);
  const segments = routePath.split('/').filter(Boolean);
  while (segments.length > 2) {
    segments.pop();
    const parent = RBAC_ROUTE_PERMISSIONS[`/${segments.join('/')}`];
    if (parent) return parent.includes(role as Role);
  }
  const root = RBAC_ROUTE_PERMISSIONS['/admin'];
  return root ? root.includes(role as Role) : false;
}

// ─────────────────────────────── session ────────────────────────────────────

/**
 * Asks the server who the caller is. `credentials: 'include'` is implied for
 * same-origin fetch, so the httpOnly session cookie rides along; a caller with
 * only a localStorage bearer still works because `apiFetch` attaches it.
 */
export async function fetchStaffSession(): Promise<StaffSession> {
  try {
    const data = await apiFetchJson<{
      valid: boolean;
      user?: StaffSessionUser;
      role?: Role;
      permissions?: string[];
      mustChangePassword?: boolean;
      twoFactorEnabled?: boolean;
    }>('/api/security/auth/session', { auth: 'staff' });

    if (!data?.valid || !data.user) return { ...EMPTY_SESSION };
    return {
      valid: true,
      user: data.user,
      role: (data.role || data.user.role) as Role,
      permissions: data.permissions || [],
      mustChangePassword: Boolean(data.mustChangePassword),
      twoFactorEnabled: Boolean(data.twoFactorEnabled),
    };
  } catch {
    // Unreachable API = signed out. Never "assume admin" as a fallback.
    return { ...EMPTY_SESSION };
  }
}

/** Kept for existing call sites; now resolves against the server session. */
export async function verifyUserRole(): Promise<Role | null> {
  const session = await fetchStaffSession();
  return session.valid ? (session.role as Role) : null;
}

export async function verifyIsAdmin(): Promise<boolean> {
  const session = await fetchStaffSession();
  return session.valid && isAdminRole(session.role);
}

export const verifyIsAdminWithClaims = verifyIsAdmin;

// ─────────────────────────────── staff auth ─────────────────────────────────

async function postJson(url: string, body: unknown): Promise<{ res: Response; data: any } | null> {
  try {
    const res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      auth: 'none',
    });
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { res, data };
  } catch {
    return null;
  }
}

const FALLBACK_LOGIN_ERROR: Partial<AuthResponse> = {
  error: 'The sign-in service is unreachable. Check your connection and try again.',
  errorBn: 'সাইন ইন সার্ভিসে পৌঁছানো যাচ্ছে না। ইন্টারনেট দেখে আবার চেষ্টা করুন।',
  code: 'NETWORK',
};

export async function loginStaff(
  email: string,
  password: string,
  totpCode?: string
): Promise<AuthResponse> {
  const result = await postJson('/api/security/auth/login', { email, password, totpCode });
  if (!result) return { success: false, ...FALLBACK_LOGIN_ERROR };
  const { data, res } = result;

  if (!res.ok || !data?.success) {
    return {
      success: false,
      error: data?.error || `Sign-in failed (HTTP ${res.status}).`,
      errorBn: data?.errorBn || 'লগইন ব্যর্থ হয়েছে।',
      code: data?.code,
      requires2FA: data?.code === 'MFA_REQUIRED',
      retryAfterSeconds: data?.retryAfterSeconds,
    };
  }

  // Store token in client memory and session storage so API tooling and
  // iframe previews can provide Authorization: Bearer along with the session cookie.
  if (data.token) {
    setStaffToken(data.token);
    if (typeof window !== 'undefined') {
      (window as unknown as { __kshBearer?: string | null }).__kshBearer = data.token;
    }
  }

  return {
    success: true,
    user: data.user,
    role: data.role,
    mustChangePassword: Boolean(data.mustChangePassword),
    requires2FA: false,
  };
}

/** Alias kept for older call sites. */
export const loginAdminWithFirebase = loginStaff;

export async function logoutStaff(): Promise<void> {
  try {
    await apiFetch('/api/security/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', auth: 'staff' });
  } catch {
    /* the cookie is cleared server-side; nothing to undo locally */
  }
  setStaffToken(null);
}

export async function changeStaffPassword(currentPassword: string, newPassword: string): Promise<{ success: boolean; error?: string; errorBn?: string }> {
  const result = await postJson('/api/security/auth/change-password', { currentPassword, newPassword });
  if (!result) return { success: false, error: 'Password service unreachable.', errorBn: 'পাসওয়ার্ড সার্ভিসে পৌঁছানো যাচ্ছে না।' };
  const { data, res } = result;
  if (!res.ok || !data?.success) return { success: false, error: data?.error, errorBn: data?.errorBn };
  return { success: true };
}

export async function requestStaffPasswordReset(emailOrPhone: string): Promise<{ success: boolean; message?: string; devCode?: string; error?: string }> {
  const result = await postJson('/api/security/auth/reset-password-request', { emailOrPhone });
  if (!result) return { success: false, error: 'Reset service unreachable.' };
  const { data, res } = result;
  if (!res.ok || !data?.success) return { success: false, error: data?.error };
  return { success: true, message: data.message, devCode: data.devCode };
}

export async function confirmStaffPasswordReset(
  emailOrPhone: string,
  code: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  const result = await postJson('/api/security/auth/reset-password-confirm', { emailOrPhone, code, newPassword });
  if (!result) return { success: false, error: 'Reset service unreachable.' };
  const { data, res } = result;
  if (!res.ok || !data?.success) return { success: false, error: data?.error };
  return { success: true };
}

/** Step-up verification for destructive admin actions (payouts, role grants). */
export async function verifyStepUpMfa(code: string, actionType: string): Promise<{ success: boolean; error?: string; errorBn?: string }> {
  const result = await postJson('/api/security/auth/mfa-verify', { code, actionType });
  if (!result) return { success: false, error: 'Verification service unreachable.' };
  const { data, res } = result;
  if (!res.ok || !data?.success) return { success: false, error: data?.error, errorBn: data?.errorBn };
  return { success: true };
}

export async function enrolTwoFactor(): Promise<{ success: boolean; secret?: string; otpauthUri?: string; error?: string }> {
  const result = await postJson('/api/security/auth/enrol-2fa', {});
  if (!result) return { success: false, error: 'Service unreachable.' };
  const { data, res } = result;
  if (!res.ok || !data?.success) return { success: false, error: data?.error };
  return { success: true, secret: data.secret, otpauthUri: data.otpauthUri };
}

export async function disableTwoFactor(code: string): Promise<{ success: boolean; error?: string }> {
  const result = await postJson('/api/security/auth/disable-2fa', { code });
  if (!result) return { success: false, error: 'Service unreachable.' };
  const { data, res } = result;
  if (!res.ok || !data?.success) return { success: false, error: data?.error };
  return { success: true };
}

/** Public hint for the login screen: is this deployment configured at all? */
export async function fetchBootstrapState(): Promise<{ adminReady: boolean; hint: string | null } | null> {
  return apiFetchJson<{ adminReady: boolean; hint: string | null }>('/api/security/auth/bootstrap-state', { auth: 'none' });
}

// ──────────────────────────── customer auth ─────────────────────────────────

export interface CustomerSession {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  [key: string]: unknown;
}

export async function loginCustomer(identifier: string, password: string): Promise<{ success: boolean; customer?: CustomerSession; error?: string; errorBn?: string; code?: string }> {
  const result = await postJson('/api/customer/auth/login', { identifier, password });
  if (!result) return { success: false, ...FALLBACK_LOGIN_ERROR, error: FALLBACK_LOGIN_ERROR.error as string };
  const { data, res } = result;
  if (!res.ok || !data?.success) {
    return { success: false, error: data?.error, errorBn: data?.errorBn, code: data?.code };
  }
  setCustomerToken(null); // cookie session; no token in storage
  return { success: true, customer: data.customer };
}

export async function registerCustomer(payload: {
  name: string;
  phone: string;
  email?: string;
  password: string;
  address?: string;
  district?: string;
}): Promise<{ success: boolean; customer?: CustomerSession; error?: string; errorBn?: string }> {
  const result = await postJson('/api/customer/auth/register', payload);
  if (!result) return { success: false, error: 'Registration service unreachable.', errorBn: 'সার্ভিসে পৌঁছানো যাচ্ছে না।' };
  const { data, res } = result;
  if (!res.ok || !data?.success) return { success: false, error: data?.error, errorBn: data?.errorBn };
  setCustomerToken(null);
  return { success: true, customer: data.customer };
}

export async function logoutCustomer(): Promise<void> {
  try {
    await apiFetch('/api/customer/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', auth: 'customer' });
  } catch {
    /* ignore */
  }
  setCustomerToken(null);
}

export async function fetchCustomerSession(): Promise<CustomerSession | null> {
  const data = await apiFetchJson<{ valid: boolean; customer?: CustomerSession }>('/api/customer/auth/me', { auth: 'customer' });
  return data?.valid ? data.customer ?? null : null;
}

/**
 * Session-expiry subscription kept for the admin shell. The real signal comes
 * from the API's 401 handling in `apiClient`, not from a client-side timer.
 */
export function subscribeToAuth(listener: (session: StaffSession) => void): () => void {
  const handler = () => {
    void fetchStaffSession().then(listener);
  };
  window.addEventListener(AUTH_EXPIRED_EVENT, handler);
  window.addEventListener('focus', handler);
  return () => {
    window.removeEventListener(AUTH_EXPIRED_EVENT, handler);
    window.removeEventListener('focus', handler);
  };
}
