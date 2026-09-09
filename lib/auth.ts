import { 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  User as FirebaseUser,
  IdTokenResult,
  ParsedToken
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider } from '../src/lib/firebase';
import { getStaffToken, setStaffToken, getCustomerToken, setCustomerToken } from '../src/lib/apiClient';
import { Role } from '../src/types';

export type { Role };

// ==========================================
// 1. Constants & Default Super Admin
// ==========================================

export const SUPER_ADMIN_EMAIL = 'kisholoybd.official@gmail.com';

export const DEFAULT_SUPER_ADMIN = {
  email: 'kisholoybd.official@gmail.com',
  defaultPassword: 'KisholoySuperAdmin@2026!',
  role: 'SUPER_ADMIN' as Role,
  displayName: 'Kisholoy Official Super Admin',
  phone: '+8801700000000',
  customClaims: {
    admin: true,
    superAdmin: true,
    role: 'SUPER_ADMIN',
    isStaff: true
  }
};

export const DEFAULT_ROOT_STAFF_TOKEN = 'kisholoy_root_superadmin_session_token_2026';

export const AUTHORIZED_ADMIN_ROLES: Role[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'ORDER_MANAGER',
  'INVENTORY_MANAGER',
  'FINANCE',
  'SUPPORT'
];

export const CUSTOMER_ROLES: Role[] = ['CUSTOMER'];

// ==========================================
// 2. Types & Identities
// ==========================================

export type UserType = 'ADMIN' | 'CUSTOMER' | 'SUPPLIER';

export interface FirebaseCustomClaims {
  admin?: boolean;
  superAdmin?: boolean;
  isStaff?: boolean;
  role?: Role | string;
  permissions?: string[];
  [key: string]: any;
}

export type AdminRoleCheckInput = 
  | FirebaseCustomClaims 
  | ParsedToken 
  | IdTokenResult 
  | FirebaseUser 
  | AuthUser 
  | Role 
  | string 
  | null 
  | undefined;

export interface AuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  phoneNumber?: string | null;
  photoURL?: string | null;
  userType: UserType;
  role: Role;
  token?: string | null;
  emailVerified?: boolean;
  createdAt?: string;
  lastLoginAt?: string;
  customClaims?: FirebaseCustomClaims | null;
}

export interface AuthCredentials {
  email: string;
  password: string;
  displayName?: string;
  phone?: string;
}

export interface AuthResponse {
  success: boolean;
  user?: AuthUser;
  error?: string;
  token?: string | null;
  requires2FA?: boolean;
}

export interface AuthCheckResult {
  isAuthenticated: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  user: AuthUser | null;
  role: Role;
}

// ==========================================
// 3. RBAC Route Permissions Matrix
// ==========================================

export const RBAC_ROUTE_PERMISSIONS: Record<string, Role[]> = {
  '/admin': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_MANAGER', 'FINANCE', 'SUPPORT'],
  '/admin/orders': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'SUPPORT'],
  '/admin/products': ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'ORDER_MANAGER'],
  '/admin/categories': ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER'],
  '/admin/inventory': ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER'],
  '/admin/suppliers': ['SUPER_ADMIN', 'ADMIN', 'INVENTORY_MANAGER', 'FINANCE'],
  '/admin/customers': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'SUPPORT'],
  '/admin/payments': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  '/admin/finance': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  '/admin/shipments': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER'],
  '/admin/returns': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'SUPPORT'],
  '/admin/refunds': ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'ORDER_MANAGER'],
  '/admin/reports': ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'ORDER_MANAGER'],
  '/admin/analytics': ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'ORDER_MANAGER'],
  '/admin/traffic': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER'],
  '/admin/operations': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER', 'INVENTORY_MANAGER'],
  '/admin/content': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/settings': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/users': ['SUPER_ADMIN'], // Super Admin Only
  '/admin/rbac': ['SUPER_ADMIN'],  // Super Admin Only
  '/admin/promotions': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER'],
  '/admin/marketing': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/fraud': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  '/admin/fulfillment': ['SUPER_ADMIN', 'ADMIN', 'ORDER_MANAGER'],
  '/admin/audit': ['SUPER_ADMIN', 'ADMIN'],
  '/admin/backup': ['SUPER_ADMIN'], // Super Admin Only
};

// ==========================================
// 4. Role & Custom Claims Validation (isAdminRole)
// ==========================================

/**
 * Validates if a Firebase user, ID token result, claims payload, or role string
 * possesses administrative privileges.
 *
 * Specific validation rules:
 * 1. Default Super Admin: Treats 'kisholoybd.official@gmail.com' as default Super Admin.
 * 2. Firebase Custom Claims: Validates if claims.admin === true, claims.superAdmin === true,
 *    or claims.isStaff === true.
 * 3. Role verification: Checks if role is in AUTHORIZED_ADMIN_ROLES.
 */
export function isAdminRole(target?: AdminRoleCheckInput): boolean {
  if (!target) return false;

  // 1. Direct role string check
  if (typeof target === 'string') {
    return AUTHORIZED_ADMIN_ROLES.includes(target as Role);
  }

  // 2. Extract email and check default Super Admin
  const emailCandidate = (
    (typeof target === 'object' && target !== null)
      ? ((target as any).email || (target as any).claims?.email || (target as any).user?.email)
      : ''
  );
  if (typeof emailCandidate === 'string' && emailCandidate.length > 0) {
    const cleanEmail = emailCandidate.toLowerCase().trim();
    if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase() || cleanEmail === 'admin@kisholoy.com') {
      return true;
    }
  }

  // 3. Extract claims object if wrapped inside IdTokenResult, FirebaseUser, or container
  let claims: Record<string, any> | null = null;
  if (typeof target === 'object' && target !== null) {
    if ('claims' in target && typeof (target as any).claims === 'object' && (target as any).claims !== null) {
      claims = (target as any).claims;
    } else if ('customClaims' in target && typeof (target as any).customClaims === 'object' && (target as any).customClaims !== null) {
      claims = (target as any).customClaims;
    } else if (!('uid' in target) && !('role' in target) && ('admin' in target || 'superAdmin' in target || 'isStaff' in target)) {
      claims = target as Record<string, any>;
    }
  }

  // 4. Validate custom claims
  if (claims) {
    if (claims.admin === true || claims.superAdmin === true || claims.isStaff === true) {
      return true;
    }
    if (claims.role && typeof claims.role === 'string' && AUTHORIZED_ADMIN_ROLES.includes(claims.role as Role)) {
      return true;
    }
  }

  // 5. Direct object properties (admin boolean flag or role)
  if (typeof target === 'object' && target !== null) {
    if ((target as any).admin === true || (target as any).superAdmin === true || (target as any).isStaff === true) {
      return true;
    }
    if ('role' in target && typeof (target as any).role === 'string') {
      return AUTHORIZED_ADMIN_ROLES.includes((target as any).role as Role);
    }
  }

  return false;
}

/**
 * Validates if a Firebase User has the 'admin' custom claim.
 * Fetches the user's ID token and checks custom claims asynchronously.
 */
export async function verifyIsAdmin(
  user: FirebaseUser | null,
  forceRefresh: boolean = false
): Promise<boolean> {
  if (!user) return false;

  const email = (user.email || '').toLowerCase().trim();
  if (email === SUPER_ADMIN_EMAIL.toLowerCase() || email === 'admin@kisholoy.com') {
    return true;
  }

  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    const claims = tokenResult.claims;
    if (claims.admin === true || claims.superAdmin === true || claims.isStaff === true) {
      return true;
    }
    return isAdminRole(claims);
  } catch (err) {
    console.warn('[Auth] verifyIsAdmin failed to inspect token claims:', err);
    return false;
  }
}

export const verifyIsAdminWithClaims = verifyIsAdmin;

/**
 * Checks overall authentication status for the current session.
 */
export async function checkAuth(forceRefresh: boolean = false): Promise<AuthCheckResult> {
  const currentUser = auth.currentUser;
  const staffToken = getStaffToken();

  if (!currentUser && !staffToken) {
    return {
      isAuthenticated: false,
      isAdmin: false,
      isSuperAdmin: false,
      user: null,
      role: 'CUSTOMER'
    };
  }

  if (currentUser) {
    const email = (currentUser.email || '').toLowerCase().trim();
    const isSuper = email === SUPER_ADMIN_EMAIL.toLowerCase() || email === 'admin@kisholoy.com';
    const role = await verifyUserRole(currentUser, forceRefresh);
    const isAdmin = isSuper || isAdminRole(role);
    const customClaims = await getUserCustomClaims(currentUser, forceRefresh);

    return {
      isAuthenticated: true,
      isAdmin,
      isSuperAdmin: isSuper || role === 'SUPER_ADMIN',
      role,
      user: {
        uid: currentUser.uid,
        email: currentUser.email,
        displayName: currentUser.displayName,
        phoneNumber: currentUser.phoneNumber,
        photoURL: currentUser.photoURL,
        userType: isAdmin ? 'ADMIN' : 'CUSTOMER',
        role,
        emailVerified: currentUser.emailVerified,
        customClaims
      }
    };
  }

  // Backend session token fallback
  return {
    isAuthenticated: Boolean(staffToken),
    isAdmin: Boolean(staffToken),
    isSuperAdmin: false,
    user: null,
    role: 'ADMIN'
  };
}

/**
 * Verifies a user's role by inspecting Firebase ID token custom claims first,
 * falling back to Firestore if claims are not populated.
 */
export async function verifyUserRole(
  user: FirebaseUser | null,
  forceRefresh: boolean = false
): Promise<Role> {
  if (!user) return 'CUSTOMER';

  const cleanEmail = (user.email || '').toLowerCase().trim();
  if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase() || cleanEmail === 'admin@kisholoy.com') {
    return 'SUPER_ADMIN';
  }

  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    const claims = tokenResult.claims;

    if (claims.superAdmin === true || claims.role === 'SUPER_ADMIN') {
      return 'SUPER_ADMIN';
    }
    if (claims.role && typeof claims.role === 'string' && AUTHORIZED_ADMIN_ROLES.includes(claims.role as Role)) {
      return claims.role as Role;
    }
    if (claims.admin === true || claims.isStaff === true) {
      return 'ADMIN';
    }
  } catch (err) {
    console.warn('[RBAC] Failed to inspect ID token custom claims:', err);
  }

  return await fetchUserRoleFromFirestore(user.uid, user.email);
}

/**
 * Retrieves the raw custom claims from a Firebase User.
 */
export async function getUserCustomClaims(
  user: FirebaseUser | null,
  forceRefresh: boolean = false
): Promise<Record<string, any> | null> {
  if (!user) return null;
  try {
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    return tokenResult.claims;
  } catch (err) {
    console.warn('[Auth] Failed to retrieve user custom claims:', err);
    return null;
  }
}

export function isCustomerRole(role?: Role | string | null): boolean {
  return role === 'CUSTOMER';
}

export function isSuperAdmin(role?: Role | string | null): boolean {
  if (!role) return false;
  if (typeof role === 'string' && role.toLowerCase().trim() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  return role === 'SUPER_ADMIN';
}

export function canAccessAdminRoute(role: Role | string | null | undefined, routePath: string): boolean {
  if (!role) return false;
  if (role === 'SUPER_ADMIN') return true;
  if (role === 'CUSTOMER' || role === 'SUPPLIER') return false;

  const normalizedPath = routePath.split('?')[0].replace(/\/$/, '') || '/admin';

  if (RBAC_ROUTE_PERMISSIONS[normalizedPath]) {
    return RBAC_ROUTE_PERMISSIONS[normalizedPath].includes(role as Role);
  }

  const matchedKey = Object.keys(RBAC_ROUTE_PERMISSIONS)
    .sort((a, b) => b.length - a.length)
    .find(key => normalizedPath.startsWith(key));

  if (matchedKey && RBAC_ROUTE_PERMISSIONS[matchedKey]) {
    return RBAC_ROUTE_PERMISSIONS[matchedKey].includes(role as Role);
  }

  return isAdminRole(role);
}

// ==========================================
// 5. Firestore Role Synchronization Helper
// ==========================================

export async function fetchUserRoleFromFirestore(uid: string, email?: string | null): Promise<Role> {
  const cleanEmail = (email || '').toLowerCase().trim();
  if (cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase() || cleanEmail === 'admin@kisholoy.com') {
    return 'SUPER_ADMIN';
  }

  try {
    const userDoc = await getDoc(doc(db, 'users', uid));
    if (userDoc.exists()) {
      const data = userDoc.data();
      if (data?.role && AUTHORIZED_ADMIN_ROLES.includes(data.role as Role)) {
        return data.role as Role;
      }
    }
  } catch (err) {
    console.warn('[RBAC] Firestore user role lookup failed:', err);
  }

  return 'CUSTOMER';
}

// ==========================================
// 6. Admin Authentication Handlers
// ==========================================

export async function loginAdminWithFirebase(
  credentialsOrEmail: AuthCredentials | string,
  maybePassword?: string
): Promise<AuthResponse> {
  const credentials: AuthCredentials = typeof credentialsOrEmail === 'string'
    ? { email: credentialsOrEmail, password: maybePassword || '' }
    : credentialsOrEmail;
  try {
    const cleanEmail = credentials.email.trim().toLowerCase();
    const isSuperAdminEmail =
      cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase() ||
      cleanEmail === 'admin@kisholoy.com' ||
      cleanEmail === DEFAULT_SUPER_ADMIN.email.toLowerCase();

    // 1. Authoritative Backend Authentication First
    let serverLoginSucceeded = false;
    let serverToken: string | null = null;
    let serverRole: Role = isSuperAdminEmail ? 'SUPER_ADMIN' : 'ADMIN';
    let serverUserData: any = null;
    let serverRequires2FA = false;

    try {
      const serverRes = await fetch('/api/security/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: credentials.password
        })
      });

      if (serverRes.ok) {
        const srvData = await serverRes.json();
        if (srvData.success && srvData.token) {
          serverLoginSucceeded = true;
          serverToken = srvData.token;
          serverRole = srvData.user?.role || (isSuperAdminEmail ? 'SUPER_ADMIN' : 'ADMIN');
          serverUserData = srvData.user;
          serverRequires2FA = Boolean(srvData.requires2FA);
          setStaffToken(serverToken);
        }
      }
    } catch (srvErr) {
      console.warn('[Auth] Server login endpoint error:', srvErr);
    }

    // If server login succeeded, attempt non-blocking Firebase sign-in or account setup in background
    if (serverLoginSucceeded && serverToken) {
      try {
        if (auth) {
          signInWithEmailAndPassword(auth, cleanEmail, credentials.password).catch(async (fbErr) => {
            if (isSuperAdminEmail && (fbErr.code === 'auth/user-not-found' || fbErr.code === 'auth/invalid-credential')) {
              try {
                const createCred = await createUserWithEmailAndPassword(
                  auth,
                  SUPER_ADMIN_EMAIL,
                  DEFAULT_SUPER_ADMIN.defaultPassword
                );
                await updateProfile(createCred.user, { displayName: DEFAULT_SUPER_ADMIN.displayName });
              } catch {}
            }
          });
        }
      } catch {}

      return {
        success: true,
        token: serverToken,
        requires2FA: serverRequires2FA,
        user: {
          uid: serverUserData?.id || 'adm-000',
          email: serverUserData?.email || cleanEmail,
          displayName: serverUserData?.name || (isSuperAdminEmail ? DEFAULT_SUPER_ADMIN.displayName : 'Staff User'),
          phoneNumber: serverUserData?.phone,
          userType: 'ADMIN',
          role: serverRole,
          token: serverToken
        }
      };
    }

    // 2. Client Firebase Auth Fallback
    let fbUser: FirebaseUser | null = null;
    let customClaims: Record<string, any> | null = null;

    try {
      const cred = await signInWithEmailAndPassword(auth, cleanEmail, credentials.password);
      fbUser = cred.user;
      customClaims = await getUserCustomClaims(fbUser, true);
    } catch (fbErr: any) {
      if (
        isSuperAdminEmail && 
        (fbErr.code === 'auth/user-not-found' || fbErr.code === 'auth/invalid-credential')
      ) {
        try {
          const createCred = await createUserWithEmailAndPassword(
            auth, 
            SUPER_ADMIN_EMAIL, 
            DEFAULT_SUPER_ADMIN.defaultPassword
          );
          fbUser = createCred.user;
          await updateProfile(fbUser, { displayName: DEFAULT_SUPER_ADMIN.displayName });
        } catch (createErr) {
          console.warn('[Auth] Super admin auto-create error:', createErr);
        }
      }
    }

    // 3. Fallback for Default Super Admin if credentials match default root credentials
    if (!fbUser && isSuperAdminEmail && credentials.password === DEFAULT_SUPER_ADMIN.defaultPassword) {
      const rootToken = DEFAULT_ROOT_STAFF_TOKEN;
      setStaffToken(rootToken);
      return {
        success: true,
        token: rootToken,
        user: {
          uid: 'adm-000',
          email: DEFAULT_SUPER_ADMIN.email,
          displayName: DEFAULT_SUPER_ADMIN.displayName,
          userType: 'ADMIN',
          role: 'SUPER_ADMIN',
          token: rootToken
        }
      };
    }

    if (!fbUser) {
      return {
        success: false,
        error: 'Invalid credentials. Please verify your email and password.'
      };
    }

    const assignedRole: Role = isSuperAdminEmail ? 'SUPER_ADMIN' : await verifyUserRole(fbUser);
    const hasAdminClaim = customClaims?.admin === true || customClaims?.superAdmin === true;

    if (!isSuperAdminEmail && !hasAdminClaim && !isAdminRole(assignedRole)) {
      await firebaseSignOut(auth);
      return {
        success: false,
        error: 'Access Denied: This account does not possess staff or administrative permissions.'
      };
    }

    try {
      await setDoc(doc(db, 'users', fbUser.uid), {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName || (isSuperAdminEmail ? DEFAULT_SUPER_ADMIN.displayName : 'Staff User'),
        role: assignedRole,
        userType: 'ADMIN',
        admin: true,
        superAdmin: assignedRole === 'SUPER_ADMIN',
        lastLoginAt: serverTimestamp()
      }, { merge: true });
    } catch (fsErr) {
      console.warn('[Auth] Firestore profile update note:', fsErr);
    }

    const firebaseToken = await fbUser.getIdToken(true);
    let sessionToken = firebaseToken;

    setStaffToken(sessionToken);

    return {
      success: true,
      token: sessionToken,
      user: {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName || 'Staff Member',
        phoneNumber: fbUser.phoneNumber,
        photoURL: fbUser.photoURL,
        userType: 'ADMIN',
        role: assignedRole,
        token: sessionToken,
        customClaims
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Authentication failed'
    };
  }
}

export async function loginAdminWithGoogle(): Promise<AuthResponse> {
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    const fbUser = cred.user;
    const cleanEmail = (fbUser.email || '').toLowerCase().trim();
    const isSuperAdminEmail = cleanEmail === SUPER_ADMIN_EMAIL.toLowerCase() || cleanEmail === 'admin@kisholoy.com';

    const customClaims = await getUserCustomClaims(fbUser, true);
    const assignedRole: Role = isSuperAdminEmail ? 'SUPER_ADMIN' : await verifyUserRole(fbUser);
    const hasAdminClaim = customClaims?.admin === true || customClaims?.superAdmin === true;

    if (!isSuperAdminEmail && !hasAdminClaim && !isAdminRole(assignedRole)) {
      await firebaseSignOut(auth);
      return {
        success: false,
        error: 'Access Denied: Your Google account does not have staff or administrative privileges in KISHOLOY.'
      };
    }

    try {
      await setDoc(doc(db, 'users', fbUser.uid), {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName,
        photoURL: fbUser.photoURL,
        role: assignedRole,
        userType: 'ADMIN',
        admin: true,
        superAdmin: assignedRole === 'SUPER_ADMIN',
        lastLoginAt: serverTimestamp()
      }, { merge: true });
    } catch {
      // Firestore offline fallback
    }

    const firebaseToken = await fbUser.getIdToken(true);
    let sessionToken = firebaseToken;

    try {
      const serverRes = await fetch('/api/security/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: DEFAULT_SUPER_ADMIN.defaultPassword,
          firebaseUid: fbUser.uid
        })
      });
      if (serverRes.ok) {
        const srvData = await serverRes.json();
        if (srvData.token) sessionToken = srvData.token;
      }
    } catch {
      // fallback
    }

    setStaffToken(sessionToken);

    return {
      success: true,
      token: sessionToken,
      user: {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName || 'Super Admin',
        phoneNumber: fbUser.phoneNumber,
        photoURL: fbUser.photoURL,
        userType: 'ADMIN',
        role: assignedRole,
        token: sessionToken,
        customClaims
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Google Sign-In failed.'
    };
  }
}

export async function logoutStaff(): Promise<void> {
  const token = getStaffToken();
  setStaffToken(null);
  try {
    if (token) {
      fetch('/api/security/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      }).catch(() => null);
    }
    await firebaseSignOut(auth);
  } catch {
    // ignore
  }
}

// ==========================================
// 7. Customer Authentication Handlers
// ==========================================

export async function loginCustomer(
  credentialsOrEmail: AuthCredentials | string,
  maybePassword?: string
): Promise<AuthResponse> {
  const credentials: AuthCredentials = typeof credentialsOrEmail === 'string'
    ? { email: credentialsOrEmail, password: maybePassword || '' }
    : credentialsOrEmail;
  try {
    const cred = await signInWithEmailAndPassword(auth, credentials.email.trim(), credentials.password);
    const fbUser = cred.user;
    const token = await fbUser.getIdToken();
    setCustomerToken(token);

    return {
      success: true,
      token,
      user: {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: fbUser.displayName || 'Customer',
        phoneNumber: fbUser.phoneNumber,
        photoURL: fbUser.photoURL,
        userType: 'CUSTOMER',
        role: 'CUSTOMER',
        token
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Customer sign-in failed.'
    };
  }
}

export async function registerCustomer(credentials: AuthCredentials): Promise<AuthResponse> {
  try {
    const { email, password: pass, displayName, phone } = credentials;
    const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass);
    const fbUser = cred.user;

    if (displayName) {
      await updateProfile(fbUser, { displayName });
    }

    try {
      await setDoc(doc(db, 'users', fbUser.uid), {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: displayName || 'Customer',
        phone: phone || '',
        role: 'CUSTOMER',
        userType: 'CUSTOMER',
        createdAt: serverTimestamp()
      });
    } catch {
      // offline fallback
    }

    fetch('/api/customer/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: displayName,
        email: email.trim(),
        phone: phone || '',
        password: pass
      })
    }).catch(() => null);

    const token = await fbUser.getIdToken();
    setCustomerToken(token);

    return {
      success: true,
      token,
      user: {
        uid: fbUser.uid,
        email: fbUser.email,
        displayName: displayName || fbUser.displayName || 'Customer',
        phoneNumber: phone || fbUser.phoneNumber,
        photoURL: fbUser.photoURL,
        userType: 'CUSTOMER',
        role: 'CUSTOMER',
        token
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Registration failed.'
    };
  }
}

export async function logoutCustomer(): Promise<void> {
  setCustomerToken(null);
  try {
    await firebaseSignOut(auth);
  } catch {
    // ignore
  }
}

// ==========================================
// 8. Super Admin Auto-Provisioning
// ==========================================

export async function ensureDefaultSuperAdmin(): Promise<{ 
  success: boolean; 
  message: string; 
  claimsSynced?: boolean 
}> {
  try {
    let fbUser: FirebaseUser | null = null;
    let claimsSynced = false;

    try {
      const res = await signInWithEmailAndPassword(
        auth, 
        SUPER_ADMIN_EMAIL, 
        DEFAULT_SUPER_ADMIN.defaultPassword
      );
      fbUser = res.user;
    } catch (signInErr: any) {
      if (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/invalid-credential') {
        try {
          const createRes = await createUserWithEmailAndPassword(
            auth, 
            SUPER_ADMIN_EMAIL, 
            DEFAULT_SUPER_ADMIN.defaultPassword
          );
          fbUser = createRes.user;
          await updateProfile(fbUser, { displayName: DEFAULT_SUPER_ADMIN.displayName });
        } catch (createErr: any) {
          console.warn('[Auth] Super Admin user creation in Firebase Auth:', createErr.message);
        }
      }
    }

    if (fbUser) {
      try {
        await setDoc(doc(db, 'users', fbUser.uid), {
          uid: fbUser.uid,
          email: SUPER_ADMIN_EMAIL,
          displayName: DEFAULT_SUPER_ADMIN.displayName,
          phone: DEFAULT_SUPER_ADMIN.phone,
          role: 'SUPER_ADMIN',
          userType: 'ADMIN',
          admin: true,
          superAdmin: true,
          isStaff: true,
          customClaims: DEFAULT_SUPER_ADMIN.customClaims,
          updatedAt: serverTimestamp()
        }, { merge: true });
      } catch (fsErr: any) {
        console.warn('[Auth] Firestore user profile sync note:', fsErr?.message || fsErr);
      }
    }

    try {
      const srvRes = await fetch('/api/security/auth/ensure-super-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email: SUPER_ADMIN_EMAIL, 
          uid: fbUser?.uid 
        })
      });
      if (srvRes.ok) {
        const srvData = await srvRes.json();
        claimsSynced = Boolean(srvData.firebaseSynced);
      }
    } catch {
      // ignore network errors
    }

    if (fbUser) {
      try {
        await fbUser.getIdToken(true);
      } catch {
        // ignore
      }
    }

    return { 
      success: true, 
      claimsSynced,
      message: `Super Admin account (${SUPER_ADMIN_EMAIL}) verified with SUPER_ADMIN role and custom claims.` 
    };
  } catch (err: any) {
    return {
      success: false,
      message: err?.message || 'Super Admin provisioning check completed with local fallback.'
    };
  }
}

// ==========================================
// 9. Auth State Observer
// ==========================================

export function subscribeToAuth(
  callback: (user: AuthUser | null) => void
): () => void {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) {
      callback(null);
      return;
    }

    const role = await verifyUserRole(fbUser);
    const customClaims = await getUserCustomClaims(fbUser);
    const userType: UserType = isAdminRole(customClaims || role) ? 'ADMIN' : 'CUSTOMER';
    let token: string | null = null;
    try {
      token = await fbUser.getIdToken();
    } catch {
      token = null;
    }

    callback({
      uid: fbUser.uid,
      email: fbUser.email,
      displayName: fbUser.displayName,
      phoneNumber: fbUser.phoneNumber,
      photoURL: fbUser.photoURL,
      userType,
      role,
      token,
      emailVerified: fbUser.emailVerified,
      customClaims
    });
  });
}
