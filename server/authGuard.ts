/**
 * Server-side authentication & authorization guard.
 *
 * ── What was wrong before ──────────────────────────────────────────────────
 * The guard admitted a caller in three unacceptable ways:
 *   1. `attachAuthContext` mapped one *static string*
 *      bearer string (a fixed 2026-era literal, quoted in the regression tests)
 *      straight to SUPER_ADMIN.
 *      That literal is in `lib/auth.ts`, which is compiled into the public
 *      browser bundle — so the deployed site shipped its own admin master key
 *      in JavaScript, and `securityEngine.verifySession` honoured a second
 *      static root token as well.
 *   2. `POST /api/security/auth/persona-session` (allow-listed as "staff auth")
 *      minted a fresh staff session for *any role*, with no password, and
 *      `/api/security/auth/ensure-super-admin` re-created the Firebase
 *      super-admin with a hardcoded password.
 *   3. Enforcement was **write-only**: reads were public unless a hand-kept
 *      list named them, so `GET /api/orders` returned the entire order book
 *      (names, phones, addresses, payment state) to an anonymous curl.
 *
 * ── Policy now ─────────────────────────────────────────────────────────────
 *   - Identity comes from a signed session (`server/sessionTokens.ts`) read
 *     from an httpOnly cookie or an `Authorization: Bearer` header. There is no
 *     bypass token, no persona endpoint, no fallback credential.
 *   - Every `/api/**` route is protected **fail-closed**: a path must appear on
 *     an explicit public allow-list to be reachable anonymously. Reads and
 *     writes are both covered.
 *   - Cookie-authenticated mutations must also echo the session-bound CSRF
 *     value (double-submit), so a third-party page cannot ride a live session.
 *   - Staff authority is checked against the RBAC matrix
 *     (`server/routePermissions.ts`), not merely "is a staffer".
 *   - Customer/supplier self-service routes are additionally ownership-checked;
 *     a shopper identity never implies staff authority.
 *
 * @license Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';
import { securityEngine } from './securityEngine';
import { serverDb } from './db';
import { verifySessionPayload } from './sessionTokens';
import { requiredPermissionFor } from './routePermissions';
import { staffAuth, type StaffAccount } from './security/staffStore';
import { customerAuth } from './security/customerAuth';
import {
  ADMIN_COOKIE,
  CSRF_HEADER,
  CUSTOMER_COOKIE,
  SUPPLIER_COOKIE,
  csrfHeaderMatches,
  isUnsafeMethod,
  parseCookies,
} from './http/cookies';
import type { Role } from '../src/types';

export interface AuthContext {
  kind: 'STAFF' | 'CUSTOMER' | 'SUPPLIER' | 'ANONYMOUS';
  role?: Role;
  userId?: string;
  userName?: string;
  customerId?: string;
  supplierId?: string;
  /** Populated for staff so downstream handlers never re-resolve the token. */
  account?: StaffAccount;
  /** Present when the caller arrived via a cookie rather than a bearer token. */
  viaCookie?: boolean;
  csrf?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

/**
 * Client identity for rate limiting and the audit trail.
 *
 * `req.ip` is preferred because `app.set('trust proxy', 1)` is what makes
 * Express count hops from the *right*, i.e. from the proxy we trust — reading
 * `x-forwarded-for` directly and taking the first entry would let any caller
 * behind the proxy invent their own identity and sidestep the per-IP budget.
 * The header is only consulted when there is no parsed value, and the socket
 * address last.
 */
export const clientIpOf = (req: Request): string => {
  const parsed = typeof req.ip === 'string' ? req.ip.trim() : '';
  if (parsed) return parsed.replace(/^::ffff:/, '');
  const forwarded = req.headers['x-forwarded-for'];
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : '';
  return first || req.socket?.remoteAddress?.replace(/^::ffff:/, '') || '127.0.0.1';
};

const bearerOf = (req: Request): string => {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return '';
};

const cookieToken = (req: Request, name: string): string | null => {
  const jar = parseCookies(req);
  return jar[name] || null;
};

/** Extracts + verifies whoever is calling. Never rejects. */
export function attachAuthContext(req: Request, _res: Response, next: NextFunction) {
  const bearer = bearerOf(req);

  // --- Staff: cookie first (browser), then bearer (API tooling) -------------
  const staffToken = cookieToken(req, ADMIN_COOKIE) || (bearer ? bearer : '');
  if (staffToken) {
    const staff = staffAuth.resolve(staffToken);
    if (staff) {
      req.auth = {
        kind: 'STAFF',
        role: staff.account.role as Role,
        userId: staff.account.id,
        userName: staff.account.name,
        account: staff.account,
        viaCookie: Boolean(cookieToken(req, ADMIN_COOKIE)),
        csrf: staff.payload.csrf,
      };
      next();
      return;
    }
  }

  // --- Customer -------------------------------------------------------------
  const customerToken = cookieToken(req, CUSTOMER_COOKIE) || (bearer && !req.auth ? bearer : '');
  if (customerToken) {
    const customer = customerAuth.resolve(customerToken);
    if (customer) {
      req.auth = {
        kind: 'CUSTOMER',
        customerId: customer.customer.id,
        userName: customer.customer.name,
        role: 'CUSTOMER',
        viaCookie: Boolean(cookieToken(req, CUSTOMER_COOKIE)),
        csrf: customer.payload.csrf,
      };
      next();
      return;
    }
  }

  // --- Supplier / vendor portal --------------------------------------------
  const supplierToken = cookieToken(req, SUPPLIER_COOKIE) || (bearer && !req.auth ? bearer : '');
  if (supplierToken) {
    const supplier = verifySessionPayload(supplierToken, 'SUPPLIER');
    if (supplier.ok) {
      req.auth = {
        kind: 'SUPPLIER',
        supplierId: supplier.payload.sub,
        userName: supplier.payload.name,
        role: 'SUPPLIER',
        viaCookie: Boolean(cookieToken(req, SUPPLIER_COOKIE)),
        csrf: supplier.payload.csrf,
      };
      next();
      return;
    }
  }

  req.auth = { kind: 'ANONYMOUS' };
  next();
}

/**
 * Paths the storefront may read without any session. Keep this list short and
 * explicit: it is the anonymous attack surface of the whole platform.
 */
const PUBLIC_READ_PATTERNS: RegExp[] = [
  /^\/api\/products(\/|$)/,
  /^\/api\/catalog\//,
  /^\/api\/categories(\/|$)/,
  /^\/api\/content(\/|$)/,
  /^\/api\/brand\/logo$/,
  /^\/api\/orders\/track$/,
  // Which payment rails exist. Booleans + static copy only, and the storefront
  // must know before it offers a button that cannot take money.
  /^\/api\/payments\/capabilities$/,
  /^\/api\/health(\/|$)/,
  /^\/api\/system\/health$/,
  // Storefront-facing coupon/flash-deal listing (no customer data).
  /^\/api\/promotions\/(public|flash-deals|active)/,
  // Staff/customer auth endpoints have to be reachable pre-login.
  /^\/api\/security\/auth\/(login|session|verify|reset-password-request|reset-password-confirm|mfa-verify)$/,
  /^\/api\/customer\/auth\/(login|register|reset-password|verify-reset)$/,
  /^\/api\/suppliers\/portal\/login$/,
  // Payment gateway return/redirect pages the browser is sent to.
  /^\/api\/payments\/(sslcommerz|bkash)\/(redirect|return|status|cancel|success)/,
];

/** Anonymous mutations, each of which validates its own input. */
const PUBLIC_MUTATION_PATTERNS: RegExp[] = [
  /^\/api\/orders\/create$/,
  /^\/api\/checkout\//,
  /^\/api\/promotions\/validate$/,
  /^\/api\/marketing\/command\/attributions$/,
  // Gateway server-to-server callbacks — signature-verified in the handlers.
  /^\/api\/payments\/ipn$/,
  /^\/api\/payments\/sslcommerz\/(init|validate)$/,
  /^\/api\/payments\/bkash\/(create|execute|callback)$/,
  /^\/api\/courier\/webhook$/,
  /^\/api\/webhooks\/receive/,
  /^\/api\/security\/auth\/(login|logout|change-password|reset-password-request|reset-password-confirm|mfa-verify|enrol-2fa|verify-2fa)$/,
  /^\/api\/customer\/auth\//,
  /^\/api\/suppliers\/portal\/login$/,
  /^\/api\/integrations\/.*\/(verify|test|health)$/,
  /^\/api\/services\/health$/,
];

const isPublicRead = (path: string) => PUBLIC_READ_PATTERNS.some((re) => re.test(path));
const isPublicMutation = (path: string) => PUBLIC_MUTATION_PATTERNS.some((re) => re.test(path));

/** Self-service surfaces a non-staff session may reach. */
const CUSTOMER_SELF_SERVICE = /^\/api\/customer\//;
const SUPPLIER_SELF_SERVICE = /^\/api\/suppliers\/portal\//;

const deny = (res: Response, status: number, code: string, message: string, messageBn: string) => {
  if (res.headersSent) return;
  res.status(status).json({ success: false, error: message, errorBn: messageBn, code });
};

/**
 * Blanket guard. Order matters: identity is already resolved by
 * `attachAuthContext`, so this only decides.
 */
export function enforceApiSurface(req: Request, res: Response, next: NextFunction) {
  const path = req.path;
  if (!path.startsWith('/api/')) return next();

  const method = req.method.toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';
  const auth = req.auth;

  // 1. CSRF: any cookie-authenticated state-changing request must echo the
  //    session-bound token. Bearer callers are exempt by design.
  if (!isRead && auth?.viaCookie) {
    if (!csrfHeaderMatches(req, auth.csrf)) {
      return deny(
        res, 403, 'CSRF_TOKEN_INVALID',
        'Security token missing or mismatched. Reload the page and try again.',
        'সিকিউরিটি টোকেন নেই বা মিলছে না। পেজটি রিলোড করে আবার চেষ্টা করুন।'
      );
    }
  }

  // 2. Anonymous traffic: only allow-listed paths.
  if (!auth || auth.kind === 'ANONYMOUS') {
    if (isRead && isPublicRead(path)) return next();
    if (!isRead && isPublicMutation(path)) return next();
    return deny(
      res, 401, 'AUTH_REQUIRED',
      isRead ? 'Sign in to view this information.' : 'Sign in to perform this action.',
      isRead ? 'এই তথ্য দেখতে লগইন করুন।' : 'এই কাজটি করতে লগইন করুন।'
    );
  }

  // 3. Staff: enforce the RBAC permission this route needs.
  if (auth.kind === 'STAFF') {
    const rule = requiredPermissionFor(method, path);
    if (rule?.permission && auth.role && !securityEngine.hasPermission(auth.role, rule.permission)) {
      securityEngine.logAudit({
        operator: auth.userName || auth.userId || 'UNKNOWN',
        role: auth.role,
        action: 'PERMISSION_DENIED',
        category: 'AUTH',
        severity: 'WARNING',
        resource: 'API',
        resourceId: path,
        details: `Role ${auth.role} attempted ${method} ${path} without ${rule.permission}${rule.note ? ` (${rule.note})` : ''}.`,
        ipAddress: clientIpOf(req),
      });
      return deny(
        res, 403, 'PERMISSION_DENIED',
        `Your role (${auth.role}) does not have the required permission: ${rule.permission}.`,
        `আপনার ভূমিকা (${auth.role}) এই কাজের অনুমতি রাখে না: ${rule.permission}।`
      );
    }
    return next();
  }

  // 4. Customers and suppliers may only reach their own surfaces.
  if (auth.kind === 'CUSTOMER' && CUSTOMER_SELF_SERVICE.test(path)) return next();
  if (auth.kind === 'SUPPLIER' && SUPPLIER_SELF_SERVICE.test(path)) return next();

  // 5. A customer may read/track *their own* orders, and print their own
  //    invoices; anything else on the staff surface is refused.
  if (
    auth.kind === 'CUSTOMER' &&
    (/^\/api\/orders(\/|$)/.test(path) || /^\/api\/print\/order\//.test(path) || /^\/api\/promotions\/validate$/.test(path))
  ) {
    return next();
  }

  return deny(
    res, 403, 'STAFF_ROLE_REQUIRED',
    'This action requires a staff account.',
    'এই কাজটি করতে স্টাফ অ্যাকাউন্ট প্রয়োজন।'
  );
}

/** Back-compatible alias (the name existed before the rewrite). */
export const enforceStaffSurface = enforceApiSurface;

/** Route-level guard for one specific RBAC permission. */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (auth?.kind !== 'STAFF' || !auth.role) {
      return deny(res, 401, 'STAFF_AUTH_REQUIRED', 'Staff authentication required.', 'স্টাফ লগইন প্রয়োজন।');
    }
    if (!securityEngine.hasPermission(auth.role, permission)) {
      securityEngine.logAudit({
        operator: auth.userName || auth.userId || 'UNKNOWN',
        role: auth.role,
        action: 'PERMISSION_DENIED',
        category: 'AUTH',
        severity: 'WARNING',
        resource: 'API',
        resourceId: req.path,
        details: `Role ${auth.role} attempted ${req.method} ${req.path} without ${permission}.`,
        ipAddress: clientIpOf(req),
      });
      return deny(
        res, 403, 'PERMISSION_DENIED',
        `Your role (${auth.role}) does not have the required permission: ${permission}.`,
        `আপনার ভূমিকা (${auth.role}) এই কাজের অনুমতি রাখে না: ${permission}।`
      );
    }
    next();
  };
}

/** Only a Super Administrator may pass. */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.kind !== 'STAFF') {
    return deny(res, 401, 'STAFF_AUTH_REQUIRED', 'Staff authentication required.', 'স্টাফ লগইন প্রয়োজন।');
  }
  if (req.auth.role !== 'SUPER_ADMIN') {
    return deny(res, 403, 'SUPER_ADMIN_REQUIRED', 'This action requires Super Administrator rights.', 'এই কাজটির জন্য সুপার অ্যাডমিন ক্ষমতা প্রয়োজন।');
  }
  next();
}

/**
 * Ownership guard for customer-scoped resources (fixes the IDOR where any
 * caller could read `/api/customer/profile/<any id>` and where the identity was
 * derived from a *guessable token shape* rather than a verified credential).
 */
export function requireCustomerSelf(paramName = 'customerId') {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (auth?.kind === 'STAFF') return next();

    const target =
      (req.params as Record<string, string>)[paramName] ||
      (req.body ? (req.body.customerId as string) : undefined) ||
      (req.query.customerId as string);

    if (!target) {
      return deny(res, 400, 'CUSTOMER_ID_REQUIRED', 'A customer id is required for this request.', 'এই অনুরোধের জন্য কাস্টমার আইডি প্রয়োজন।');
    }
    if (auth?.kind === 'CUSTOMER' && auth.customerId === target) return next();

    return deny(res, 403, 'NOT_RESOURCE_OWNER', 'You can only access your own account data.', 'আপনি শুধুমাত্র নিজের অ্যাকাউন্টের তথ্য দেখতে পারবেন।');
  };
}

function requireRecordOwner(
  resolveOwner: (id: string) => string | undefined,
  paramName: string,
  notFoundMessage: string,
  notFoundMessageBn: string
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (auth?.kind === 'STAFF') return next();

    const recordId = (req.params as Record<string, string>)[paramName];
    const owner = recordId ? resolveOwner(recordId) : undefined;

    // Unknown record answers 404 rather than leaking existence via 403.
    if (!owner) {
      if (!res.headersSent) {
        res.status(404).json({ success: false, error: notFoundMessage, errorBn: notFoundMessageBn, code: 'NOT_FOUND' });
      }
      return;
    }
    if (auth?.kind === 'CUSTOMER' && auth.customerId === owner) return next();

    return deny(res, 403, 'NOT_RESOURCE_OWNER', 'You can only access your own account data.', 'আপনি শুধুমাত্র নিজের অ্যাকাউন্টের তথ্য দেখতে পারবেন।');
  };
}

export function requireAddressOwner(paramName = 'addressId') {
  return requireRecordOwner(
    (id) => serverDb.customerAddresses.find((a) => a.id === id)?.customerId,
    paramName,
    'Address not found.',
    'ঠিকানা পাওয়া যায়নি।'
  );
}

export function requireNotificationOwner(paramName = 'id') {
  return requireRecordOwner(
    (id) => serverDb.customerNotifications.find((n) => n.id === id)?.customerId,
    paramName,
    'Notification not found.',
    'নোটিফিকেশন পাওয়া যায়নি।'
  );
}

/**
 * Guards a route addressed by **order number** so the owning customer (or any
 * staff role) may reach it — used by invoice printing and order detail views.
 */
export function requireOrderNumberOwner(queryParam = 'orderNumber', paramKey = 'orderNumber') {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (auth?.kind === 'STAFF') return next();
    if (auth?.kind !== 'CUSTOMER') {
      return deny(res, 401, 'AUTH_REQUIRED', 'Sign in to view this order.', 'এই অর্ডারটি দেখতে লগইন করুন।');
    }

    const number = String(
      (req.params as Record<string, string>)[paramKey] || req.query[queryParam] || ''
    ).trim();
    const order = serverDb.orders.find((o) => String(o.orderNumber || '').toLowerCase() === number.toLowerCase());
    if (!order) {
      return deny(res, 404, 'ORDER_NOT_FOUND', 'Order not found.', 'অর্ডারটি পাওয়া যায়নি।');
    }

    const ownByCid = auth.customerId && (order as { customer?: { id?: string } }).customer?.id === auth.customerId;
    const ownByPhone =
      (order as { customer?: { phone?: string } }).customer?.phone ===
      (serverDb.customers.find((c) => c.id === auth.customerId)?.phone ?? '\u0000');

    if (ownByCid || ownByPhone) return next();
    return deny(res, 403, 'NOT_RESOURCE_OWNER', 'You can only view your own orders.', 'আপনি শুধু নিজের অর্ডার দেখতে পারবেন।');
  };
}

export function requireSupplierSelf(paramName = 'supplierId') {
  return (req: Request, res: Response, next: NextFunction) => {
    const auth = req.auth;
    if (auth?.kind === 'STAFF') return next();

    const target =
      (req.params as Record<string, string>)[paramName] ||
      (req.body ? (req.body.supplierId as string) : undefined) ||
      (req.query.supplierId as string);

    if (!target) {
      return deny(res, 400, 'SUPPLIER_ID_REQUIRED', 'A supplier id is required for this request.', 'এই অনুরোধের জন্য সাপ্লায়ার আইডি প্রয়োজন।');
    }
    if (auth?.kind === 'SUPPLIER' && auth.supplierId === target) return next();

    return deny(res, 403, 'NOT_RESOURCE_OWNER', 'You can only access your own supplier data.', 'আপনি শুধুমাত্র নিজের সাপ্লায়ার তথ্য দেখতে পারবেন।');
  };
}

export function callerCustomerId(req: Request): string | undefined {
  return req.auth?.kind === 'CUSTOMER' ? req.auth.customerId : undefined;
}

export function isStaff(req: Request): boolean {
  return req.auth?.kind === 'STAFF';
}

/** Customer id used to scope list endpoints, or `null` for a full staff view. */
export function resolveCustomerScope(req: Request): string | null {
  if (req.auth?.kind === 'CUSTOMER' && req.auth.customerId) return req.auth.customerId;
  return null;
}

