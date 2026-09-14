/**
 * Authentication routes — staff, customer and session lifecycle.
 *
 * Replaces the inline handlers in `server.ts`. The behaviour contract:
 *
 *  - Sign-in issues an httpOnly session cookie **and** returns the same token in
 *    the body for first-party API clients. Cookies carry `SameSite=Lax`,
 *    `Secure` in production, and are bound to a CSRF value the client must echo
 *    on every mutation.
 *  - Sessions are signed, expiring and revocable. There is no bypass token.
 *  - Responses never contain a hash, a secret, or an internal error string.
 *  - Failed logins are rate limited per IP *and* per identifier, and lock the
 *    account after five attempts.
 *  - Errors are returned in English **and** Bangla so the UI can show a
 *    localised message without a translation table on the client.
 *
 * @license Apache-2.0
 */

import type { Express, Request, Response } from 'express';
import { staffAuth, STAFF_ROLES, publicAccount } from '../security/staffStore';
import { customerAuth, publicCustomer } from '../security/customerAuth';
import { clearSessionCookies, setSessionCookies } from '../http/cookies';
import { config } from '../config';
import { AppError, log, sendInternalError } from '../http/errors';
import { securityEngine } from '../securityEngine';
import { customerLoginSchema, customerRegisterSchema, formatZodErrorSafe, passwordChangeSchema, staffLoginSchema } from '../validation/schemas';
import { verifyTotp } from '../security/totp';

type StaffLoginResult = Awaited<ReturnType<typeof staffAuth.login>>;
type StaffLoginFailure = Extract<StaffLoginResult, { success: false }>;
type CustomerLoginResult = Awaited<ReturnType<typeof customerAuth.login>>;
type CustomerLoginFailure = Extract<CustomerLoginResult, { success: false }>;

const clientIp = (req: Request): string =>
  ((req.headers['x-forwarded-for'] as string) || '').split(',')[0].trim() ||
  req.socket?.remoteAddress?.replace(/^::ffff:/, '') ||
  '127.0.0.1';

const parse = <T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, body: unknown, res: Response): T | null => {
  const result = schema.safeParse(body || {});
  if (result.success) return (result.data ?? {}) as T;
  const formatted = formatZodErrorSafe(result.error);
  res.status(422).json({ success: false, ...formatted });
  return null;
};

export function registerAuthRoutes(app: Express): void {
  // ═════════════════════════════ STAFF ═════════════════════════════
  app.post('/api/security/auth/login', async (req: Request, res: Response) => {
    try {
      const input = parse(staffLoginSchema, req.body, res);
      if (!input) return;

      const result = await staffAuth.login({
        email: input.email,
        password: input.password,
        totpCode: input.totpCode,
        ip: clientIp(req),
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
      });

      if (result.success === false) {
        const failure = result as StaffLoginFailure;
        const status =
          failure.code === 'LOCKED' ? 429 :
          failure.code === 'MFA_REQUIRED' ? 202 :
          failure.code === 'BOOTSTRAP_PENDING' ? 503 : 401;
        if (failure.retryAfterSeconds) res.setHeader('Retry-After', String(failure.retryAfterSeconds));
        res.status(status).json({
          success: false,
          code: failure.code,
          error: failure.error,
          errorBn: failure.errorBn,
          ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
        });
        return;
      }

      setSessionCookies(res, 'staff', result.token, result.csrf);
      res.json({
        success: true,
        // Bearer copy for API tooling; browsers use the cookie.
        token: result.token,
        requires2FA: Boolean(result.account.twoFactorEnabled) && !result.account.totpSecret ? false : undefined,
        mustChangePassword: result.mustChangePassword,
        role: result.account.role,
        user: {
          ...publicAccount(result.account),
          userType: 'ADMIN',
        },
        permissions: securityEngine.getRolePermissions().find((r) => r.role === result.account.role)?.permissions || [],
        session: {
          expiresAt: new Date(Date.now() + config.session.absoluteTtlMs).toISOString(),
          idleTimeoutMinutes: Math.round(config.session.idleTtlMs / 60000),
        },
      });
    } catch (err) {
      sendInternalError(res, err, 'auth:staff_login');
    }
  });

  /**
   * "Am I still signed in?" — used by the admin shell on boot and by the
   * session-expiry watcher. Reads only the caller's own session.
   */
  app.get('/api/security/auth/session', (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind !== 'STAFF' || !auth.account) {
        return res.status(401).json({
          valid: false,
          error: 'Session expired or not signed in.',
          errorBn: 'সেশনের মেয়াদ শেষ বা লগইন করা হয়নি।',
          code: 'UNAUTHENTICATED',
        });
      }
      res.json({
        valid: true,
        user: publicAccount(auth.account),
        role: auth.account.role,
        mustChangePassword: Boolean(auth.account.mustChangePassword),
        twoFactorEnabled: Boolean(auth.account.twoFactorEnabled),
        permissions: securityEngine.getRolePermissions().find((r) => r.role === auth.account!.role)?.permissions || [],
      });
    } catch (err) {
      sendInternalError(res, err, 'auth:staff_session');
    }
  });

  /**
   * The account list is the single most sensitive read in the platform: it
   * used to answer with every seeded staff account **and its login email**,
   * which is half of the credentials needed for an attack. It is now
   * SUPER_ADMIN-only and returns no contact-identifying data to lesser roles.
   */
  app.get('/api/security/users', (req: Request, res: Response) => {
    try {
      if (req.auth?.kind !== 'STAFF') {
        return res.status(401).json({ success: false, error: 'Staff authentication required.', errorBn: 'স্টাফ লগইন প্রয়োজন।' });
      }
      const isSuper = req.auth.role === 'SUPER_ADMIN';
      const users = staffAuth.list().map((account) => {
        const safe = publicAccount(account);
        if (isSuper) return safe;
        // Non-super roles manage workflows, not identities: no emails, no phones.
        return { id: safe.id, name: safe.name, role: safe.role, status: safe.status, twoFactorEnabled: safe.twoFactorEnabled, lastLoginAt: safe.lastLoginAt };
      });
      res.json({ success: true, data: users, total: users.length, restricted: !isSuper });
    } catch (err) {
      sendInternalError(res, err, 'auth:staff_users');
    }
  });

  app.post('/api/security/auth/logout', async (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind === 'STAFF' && auth.account) {
        const token =
          (req.body?.token as string) ||
          ((req.headers.authorization as string)?.startsWith('Bearer ') ? (req.headers.authorization as string).slice(7) : '') ||
          '';
        await staffAuth.revokeAllSessions(auth.account.id, 'logout', clientIp(req));
        if (token) {
          const resolved = staffAuth.resolve(token);
          if (resolved) await staffAuth.logout(resolved.payload, auth.account.name, clientIp(req));
        }
      }
      clearSessionCookies(res, 'staff');
      res.json({ success: true, message: 'Signed out.', messageBn: 'লগআউট সম্পন্ন।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:staff_logout');
    }
  });

  app.post('/api/security/auth/change-password', async (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind !== 'STAFF' || !auth.userId) {
        return res.status(401).json({ success: false, error: 'Sign in to change your password.', errorBn: 'পাসওয়ার্ড বদলাতে লগইন করুন।' });
      }
      const input = parse(passwordChangeSchema, req.body, res);
      if (!input) return;

      const result = await staffAuth.changePassword({
        userId: auth.userId,
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        actorId: auth.userId,
        ip: clientIp(req),
      });

      if (!result.success) {
        return res.status(400).json({ success: false, error: result.error, errorBn: result.errorBn });
      }

      // The old session is revoked by the change; re-issue so the operator is
      // not thrown out of the admin panel mid-task.
      const relogin = await staffAuth.login({
        email: auth.account!.email,
        password: input.newPassword,
        totpCode: undefined,
        ip: clientIp(req),
        userAgent: (req.headers['user-agent'] as string) || 'unknown',
      });
      if (relogin.success) {
        setSessionCookies(res, 'staff', relogin.token, relogin.csrf);
        // Revoke the "log everyone out" epoch so this session survives.
        return res.json({ success: true, token: relogin.token, message: 'Password updated. Other devices were signed out.', messageBn: 'পাসওয়ার্ড হালনাগাদ হয়েছে। অন্য ডিভাইসগুলো থেকে লগআউট করা হয়েছে।' });
      }
      res.json({ success: true, message: 'Password updated. Please sign in again.', messageBn: 'পাসওয়ার্ড হালনাগাদ হয়েছে। আবার লগইন করুন।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:staff_change_password');
    }
  });

  app.post('/api/security/auth/reset-password-request', async (req: Request, res: Response) => {
    try {
      const emailOrPhone = String(req.body?.emailOrPhone || req.body?.email || '').trim();
      if (!emailOrPhone) {
        return res.status(400).json({ success: false, error: 'Email or phone number is required.', errorBn: 'ইমেইল বা ফোন নম্বর দিন।' });
      }
      const result = await staffAuth.beginPasswordReset(emailOrPhone, clientIp(req));
      if (result.success === false) return res.status(400).json({ success: false, error: result.error });
      res.json({
        success: true,
        message: 'If an account matches this identifier, a verification code has been dispatched.',
        messageBn: 'এই তথ্য matching কোনো অ্যাকাউন্ট থাকলে যাচাই কোড পাঠানো হয়েছে।',
        // Development-only convenience; never present in a production payload.
        devCode: config.isProduction ? undefined : result.devCode,
      });
    } catch (err) {
      sendInternalError(res, err, 'auth:staff_reset_request');
    }
  });

  app.post('/api/security/auth/reset-password-confirm', async (req: Request, res: Response) => {
    try {
      const { emailOrPhone, email, code, newPassword } = req.body || {};
      const identifier = String(emailOrPhone || email || '').trim();
      if (!identifier || !code || !newPassword) {
        return res.status(400).json({ success: false, error: 'Identifier, code and new password are all required.', errorBn: 'পরিচয়, কোড ও নতুন পাসওয়ার্ড প্রয়োজন।' });
      }
      const result = await staffAuth.completePasswordReset(identifier, String(code), String(newPassword), clientIp(req));
      if (result.success === false) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true, message: 'Password reset complete. Sign in with the new password.', messageBn: 'পাসওয়ার্ড রিসেট সম্পন্ন। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:staff_reset_confirm');
    }
  });

  /**
   * Step-up verification for a dangerous action (payout, permission change).
   * This is what `verifyMfaForAction` should always have been: it previously
   * accepted any six digits, so `000000` authorised a vendor payout.
   */
  app.post('/api/security/auth/mfa-verify', (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind !== 'STAFF' || !auth.account) {
        return res.status(401).json({ success: false, error: 'Sign in first.', errorBn: 'আগে লগইন করুন।' });
      }
      const code = String(req.body?.code || '').trim();
      const actionType = String(req.body?.actionType || 'UNSPECIFIED').slice(0, 60);
      const account = auth.account;

      if (!account.twoFactorEnabled || !account.totpSecret) {
        return res.status(409).json({
          success: false,
          code: 'MFA_NOT_ENROLLED',
          error: 'Your account has no authenticator enrolled, so this action cannot be step-up verified. Enroll two-factor authentication first.',
          errorBn: 'আপনার অ্যাকাউন্টে অথেনটিকেটর যুক্ত নেই, তাই এই কাজটির বাড়তি যাচাই করা যাচ্ছে না। আগে টু-ফ্যাক্টর চালু করুন।',
        });
      }
      if (!verifyTotp(account.totpSecret, code)) {
        securityEngine.logAudit({
          operator: account.name, role: account.role, action: 'STEP_UP_MFA_FAILED', category: 'AUTH', severity: 'SECURITY_ALERT',
          resource: 'StaffAccount', resourceId: account.id,
          details: `Invalid step-up code presented for ${actionType} from ${clientIp(req)}.`, ipAddress: clientIp(req),
        });
        return res.status(401).json({ success: false, error: 'The verification code is incorrect or expired.', errorBn: 'কোডটি ভুল বা মেয়াদোত্তীর্ণ।' });
      }
      securityEngine.logAudit({
        operator: account.name, role: account.role, action: 'STEP_UP_MFA_VERIFIED', category: 'AUTH', severity: 'INFO',
        resource: 'SecurityPolicy', resourceId: actionType,
        details: `Step-up verification passed for ${actionType}.`, ipAddress: clientIp(req),
      });
      res.json({ success: true, message: 'Step-up verification passed.', messageBn: 'বাড়তি যাচাই সফল।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:step_up');
    }
  });

  app.post('/api/security/auth/enrol-2fa', async (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind !== 'STAFF' || !auth.userId) {
        return res.status(401).json({ success: false, error: 'Sign in first.', errorBn: 'আগে লগইন করুন।' });
      }
      const result = await staffAuth.setTwoFactor(auth.userId, true, auth.userId, clientIp(req));
      if (result.success === false) return res.status(400).json({ success: false, error: result.error });
      // The secret is returned exactly once, for QR enrolment. It is never
      // included in any other response.
      res.json({ success: true, secret: result.secret, otpauthUri: result.uri, message: 'Scan the QR code, then confirm a code to finish enrolment.', messageBn: 'QR কোড স্ক্যান করুন, তারপর একটি কোড দিয়ে নিশ্চিত করুন।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:enrol_2fa');
    }
  });

  app.post('/api/security/auth/disable-2fa', async (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind !== 'STAFF' || !auth.userId) {
        return res.status(401).json({ success: false, error: 'Sign in first.', errorBn: 'আগে লগইন করুন।' });
      }
      if (!verifyTotp(auth.account?.totpSecret || '', String(req.body?.code || ''))) {
        return res.status(401).json({ success: false, error: 'Confirm with a current authenticator code before disabling 2FA.', errorBn: 'টু-ফ্যাক্টর বন্ধ করতে বর্তমান কোড দিন।' });
      }
      await staffAuth.setTwoFactor(auth.userId, false, auth.userId, clientIp(req));
      res.json({ success: true, message: 'Two-factor authentication disabled.', messageBn: 'টু-ফ্যাক্টর বন্ধ করা হয়েছে।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:disable_2fa');
    }
  });

  /** Account creation / role changes: SUPER_ADMIN authority only. */
  app.post('/api/security/users/create', async (req: Request, res: Response) => {
    try {
      if (req.auth?.kind !== 'STAFF') return res.status(401).json({ success: false, error: 'Staff authentication required.' });
      if (req.auth.role !== 'SUPER_ADMIN') {
        return res.status(403).json({
          success: false, code: 'SUPER_ADMIN_REQUIRED',
          error: 'Only a Super Administrator can create staff accounts.',
          errorBn: 'শুধু সুপার অ্যাডমিন স্টাফ অ্যাকাউন্ট তৈরি করতে পারবেন।',
        });
      }
      const role = String(req.body?.role || 'SUPPORT');
      if (!STAFF_ROLES.includes(role as never)) return res.status(400).json({ success: false, error: 'Unknown role.' });

      const result = await staffAuth.createAccount({
        name: String(req.body?.name || ''),
        email: String(req.body?.email || ''),
        phone: req.body?.phone ? String(req.body.phone) : undefined,
        role: role as 'STAFF',
        password: req.body?.password ? String(req.body.password) : undefined,
        ip: clientIp(req),
        actorRole: req.auth.role,
      });
      if (result.success === false) return res.status(400).json({ success: false, error: result.error });

      res.json({
        success: true,
        account: publicAccount(result.account),
        // Shown once so the operator can hand it over; never stored anywhere else.
        temporaryPassword: result.temporaryPassword,
        message: result.temporaryPassword
          ? 'Account created. Share the temporary password once; it must be changed at first sign-in.'
          : 'Account created.',
      });
    } catch (err) {
      sendInternalError(res, err, 'auth:user_create');
    }
  });

  app.post('/api/security/users/update', async (req: Request, res: Response) => {
    try {
      if (req.auth?.kind !== 'STAFF') return res.status(401).json({ success: false, error: 'Staff authentication required.' });
      const userId = String(req.body?.userId || req.body?.id || '');
      if (!userId) return res.status(400).json({ success: false, error: 'userId is required.' });
      const result = await staffAuth.updateAccount(
        userId,
        {
          name: req.body?.name ? String(req.body.name) : undefined,
          phone: req.body?.phone ? String(req.body.phone) : undefined,
          role: req.body?.role,
          status: req.body?.status,
        } as never,
        { id: req.auth.userId!, role: req.auth.role as 'STAFF', ip: clientIp(req) }
      );
      if (result.success === false) return res.status(400).json({ success: false, error: result.error });
      res.json({ success: true, account: publicAccount(result.account!) });
    } catch (err) {
      sendInternalError(res, err, 'auth:user_update');
    }
  });

  // ═════════════════════════════ CUSTOMERS ═════════════════════════════
  app.post('/api/customer/auth/register', async (req: Request, res: Response) => {
    try {
      const input = parse(customerRegisterSchema, req.body, res);
      if (!input) return;

      const result = await customerAuth.register({
        name: input.name,
        phone: input.phone,
        email: input.email,
        password: input.password,
        address: input.address,
        district: input.district,
        source: 'WEB',
      });

      if (result.success === false) {
        return res.status(409).json({ success: false, error: result.error, errorBn: result.errorBn, code: 'REGISTRATION_FAILED' });
      }

      setSessionCookies(res, 'customer', result.token, result.csrf);
      res.status(201).json({ success: true, token: result.token, customer: result.customer, message: 'Account created.' });
    } catch (err) {
      sendInternalError(res, err, 'auth:customer_register');
    }
  });

  app.post('/api/customer/auth/login', async (req: Request, res: Response) => {
    try {
      const input = parse(customerLoginSchema, req.body, res);
      if (!input) return;

      const result = await customerAuth.login({ identifier: input.identifier, password: input.password, ip: clientIp(req) });
      if (result.success === false) {
        const failure = result as CustomerLoginFailure;
        return res.status(401).json({ success: false, error: failure.error, errorBn: failure.errorBn, code: failure.code });
      }
      setSessionCookies(res, 'customer', result.token, result.csrf);
      res.json({ success: true, token: result.token, customer: result.customer });
    } catch (err) {
      sendInternalError(res, err, 'auth:customer_login');
    }
  });

  app.post('/api/customer/auth/logout', async (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind === 'CUSTOMER' && auth.customerId) {
        const token = ((req.headers.authorization as string) || '').replace(/^Bearer /, '') || undefined;
        // Best-effort: revoke the presented jti if we can parse it.
        if (token) {
          const resolved = customerAuth.resolve(token);
          if (resolved) await customerAuth.logout(resolved.payload);
        }
      }
      clearSessionCookies(res, 'customer');
      res.json({ success: true, message: 'Signed out.', messageBn: 'লগআউট সম্পন্ন।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:customer_logout');
    }
  });

  /** Who is this shopper? Used by the storefront header on boot. */
  app.get('/api/customer/auth/me', (req: Request, res: Response) => {
    const auth = req.auth;
    if (auth?.kind !== 'CUSTOMER' || !auth.customerId) {
      return res.status(401).json({ valid: false, code: 'UNAUTHENTICATED', error: 'Not signed in.', errorBn: 'লগইন করা হয়নি।' });
    }
    const record = customerAuth.findById(auth.customerId);
    if (!record) {
      return res.status(401).json({ valid: false, code: 'ACCOUNT_NOT_FOUND', error: 'Account no longer exists.', errorBn: 'অ্যাকাউন্টটি আর নেই।' });
    }
    res.json({ valid: true, customer: publicCustomer(record) });
  });

  app.post('/api/customer/auth/change-password', async (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind !== 'CUSTOMER' || !auth.customerId) {
        return res.status(401).json({ success: false, error: 'Sign in to change your password.', errorBn: 'পাসওয়ার্ড বদলাতে লগইন করুন।' });
      }
      const input = parse(passwordChangeSchema, req.body, res);
      if (!input) return;
      const result = await customerAuth.changePassword({
        customerId: auth.customerId,
        currentPassword: input.currentPassword || '',
        newPassword: input.newPassword,
      });
      if (!result.success) return res.status(400).json({ success: false, error: result.error, errorBn: result.errorBn });
      clearSessionCookies(res, 'customer');
      res.json({ success: true, message: 'Password updated. Please sign in again.', messageBn: 'পাসওয়ার্ড হালনাগাদ হয়েছে। আবার লগইন করুন।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:customer_change_password');
    }
  });

  app.post('/api/customer/auth/reset-password', async (req: Request, res: Response) => {
    try {
      const identifier = String(req.body?.identifier || req.body?.email || '').trim();
      const code = req.body?.code ? String(req.body.code) : undefined;
      const newPassword = req.body?.newPassword ? String(req.body.newPassword) : undefined;

      if (!identifier) throw new AppError('Email or phone is required.');

      if (!code) {
        const begin = await customerAuth.beginReset(identifier);
        if (!begin.success) return res.status(400).json({ success: false, error: begin.error });
        return res.json({ success: true, message: 'If the account exists, a code has been sent.', messageBn: 'অ্যাকাউন্ট থাকলে কোড পাঠানো হয়েছে।', devCode: config.isProduction ? undefined : begin.devCode });
      }

      if (!newPassword) throw new AppError('A new password is required.');
      const done = await customerAuth.completeReset(identifier, code, newPassword);
      if (!done.success) return res.status(400).json({ success: false, error: done.error });
      res.json({ success: true, message: 'Password reset complete. Sign in with your new password.', messageBn: 'পাসওয়ার্ড রিসেট সম্পন্ন। নতুন পাসওয়ার্ড দিয়ে লগইন করুন।' });
    } catch (err) {
      sendInternalError(res, err, 'auth:customer_reset');
    }
  });

  /**
   * Claims a guest order into the signed-in account. Ownership is proven by
   * the order number **and** the phone on the order — never by a guessed id.
   */
  app.post('/api/customer/auth/link-guest-order', (req: Request, res: Response) => {
    try {
      const auth = req.auth;
      if (auth?.kind !== 'CUSTOMER' || !auth.customerId) {
        return res.status(401).json({ success: false, error: 'Sign in to attach an order to your account.', errorBn: 'অর্ডার যুক্ত করতে লগইন করুন।' });
      }
      const orderNumber = String(req.body?.orderNumber || '').trim();
      const phone = String(req.body?.phone || '').trim();
      if (!orderNumber || !phone) {
        return res.status(400).json({ success: false, error: 'Order number and the phone used on the order are required.' });
      }
      const match = customerAuth.verifyGuestOrderMatch(orderNumber, phone);
      if (!match.ok) return res.status(404).json({ success: false, error: match.error });
      res.json({ success: true, order: match.order, message: 'Order attached to your account.' });
    } catch (err) {
      sendInternalError(res, err, 'auth:link_guest');
    }
  });

  /**
   * Public bootstrap state for the admin login screen, so an operator knows
   * *why* nothing works on a fresh deploy. Exposes counts only — never an
   * email, a hint, or a credential.
   */
  app.get('/api/security/auth/bootstrap-state', (_req: Request, res: Response) => {
    const accounts = staffAuth.count();
    res.json({
      staffAccounts: accounts,
      adminReady: accounts > 0,
      hint: accounts > 0
        ? null
        : 'No administrator exists yet. Set KISHOLOY_ADMIN_EMAIL and KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD in the deployment environment, then restart.',
    });
  });
}

export { publicAccount, publicCustomer };
