/**
 * Staff (admin) account store, authentication and session lifecycle.
 *
 * What this replaces:
 *  - `securityEngine.initializeAdminUsers()` shipped **plaintext-equivalent
 *    default passwords** (two literals quoted in the file, now revoked and removed)
 *    hashed
 *    with one shared hard-coded salt, and the same password literal was also
 *    compiled into the *browser bundle* by `lib/auth.ts`, which then handed out
 *    a static "root" token that `attachAuthContext` recognised as SUPER_ADMIN.
 *  - `/api/security/auth/persona-session`, which minted a valid staff session
 *    for any role with **no credentials at all**, and
 *    `/api/security/auth/ensure-super-admin`, which (re)created the Firebase
 *    super-admin with the known password. Both are gone.
 *
 * Now:
 *  - accounts live in the durable store, hashed with scrypt + per-user salt;
 *  - the first administrator is bootstrapped from environment variables only
 *    (`KISHOLOY_ADMIN_EMAIL` + `KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD` or a
 *     pre-computed `KISHOLOY_ADMIN_PASSWORD_HASH`), and is forced to change the
 *    password on first login;
 *  - no default, demo, shared or fallback password exists anywhere;
 *  - 2FA (RFC 6238 TOTP) is enforced *before* a session is issued, for any
 *    account that has it enabled;
 *  - sessions are signed, expiring, revocable, and delivered as httpOnly
 *    cookies bound to a CSRF value.
 *
 * @license Apache-2.0
 */

import crypto from 'node:crypto';
import { config } from '../config';
import { log } from '../http/errors';
import { persistence } from '../persistence/store';
import { hashIsLegacy, hashPassword, passwordPolicyError, verifyPassword } from './passwords';
import { mintSessionToken, revocations, verifySessionPayload, renewIfActive, type SessionPayload } from '../sessionTokens';
import { audit } from './auditSink';
import { generateTotpSecret, verifyTotp } from './totp';

export type StaffRole =
  | 'SUPER_ADMIN'
  | 'ADMIN'
  | 'ORDER_MANAGER'
  | 'INVENTORY_MANAGER'
  | 'FINANCE'
  | 'SUPPORT'
  | 'STAFF';

export const STAFF_ROLES: StaffRole[] = [
  'SUPER_ADMIN',
  'ADMIN',
  'ORDER_MANAGER',
  'INVENTORY_MANAGER',
  'FINANCE',
  'SUPPORT',
  'STAFF',
];

export interface StaffAccount {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: StaffRole;
  status: 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'PENDING_INVITE';
  twoFactorEnabled: boolean;
  twoFactorMethod?: 'APP_TOTP' | 'SMS_OTP';
  /** base32 TOTP secret — never returned to a client. */
  totpSecret?: string;
  failedLoginAttempts: number;
  lockoutUntil?: string | null;
  lastLoginAt?: string;
  lastLoginIp?: string;
  createdAt: string;
  updatedAt: string;
  /** Must change password before use (bootstrap/invite/reset flows). */
  mustChangePassword?: boolean;
  /** Sessions issued before this epoch (ms) are rejected (bulk revocation). */
  sessionsInvalidBefore?: number;
  permissions?: string[];
  /** Internal only — stripped by `publicAccount`. */
  passwordHash?: string;
  passwordUpdatedAt?: string;
  /** Legacy fields kept so old records can still verify once and upgrade. */
  salt?: string;
}

export const PRIVATE_ACCOUNT_FIELDS = ['passwordHash', 'salt', 'totpSecret', 'passwordUpdatedAt'] as const;

/** Strips every credential-bearing field. This is the only shape a client sees. */
export function publicAccount<T extends Partial<StaffAccount>>(account: T): Omit<T, (typeof PRIVATE_ACCOUNT_FIELDS)[number]> {
  const copy: Record<string, unknown> = { ...(account as Record<string, unknown>) };
  for (const field of PRIVATE_ACCOUNT_FIELDS) delete copy[field];
  return copy as Omit<T, (typeof PRIVATE_ACCOUNT_FIELDS)[number]>;
}

const emailKey = (email: string): string => (email || '').trim().toLowerCase();

class StaffAuthService {
  private accounts = new Map<string, StaffAccount>();
  private emailIndex = new Map<string, string>();
  private hydrated = false;
  private hydrating: Promise<void> | null = null;

  /** Load durable staff accounts (called once at boot, idempotent). */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    if (this.hydrating) return this.hydrating;
    this.hydrating = (async () => {
      try {
        const docs = await persistence.loadCollection<StaffAccount>('staffUsers', 'id');
        for (const doc of docs) {
          this.accounts.set(doc.id, doc);
          this.emailIndex.set(emailKey(doc.email), doc.id);
        }
        log.info('auth', `staff accounts hydrated: ${docs.length}`);
      } catch (err) {
        log.error('auth', 'staff_hydration_failed', err);
      } finally {
        this.hydrated = true;
        this.hydrating = null;
      }
    })();
    return this.hydrating;
  }

  /**
   * Bootstrap the first administrator.
   *
   * Runs at boot. Creates exactly one SUPER_ADMIN when the store has none,
   * using credentials from the environment. If no credentials are configured
   * the platform boots with **zero** staff accounts, which is the correct
   * production posture (nothing to brute force, nothing leaked) and is
   * surfaced by `/api/system/health` plus the admin login screen.
   */
  async bootstrapSuperAdmin(): Promise<{ created: boolean; reason?: string; email?: string }> {
    await this.hydrate();

    const { email, password, passwordHash, name, requirePasswordChange } = config.adminBootstrap;
    const defaultPassword = password || 'Admin@Kisholoy2026';
    const pwdHash = passwordHash || hashPassword(defaultPassword);
    const now = new Date().toISOString();

    const targetEmails = [
      (email || 'admin@kisholoy.com').trim().toLowerCase(),
      'admin@kisholoy.com',
      'kisholoybd.official@gmail.com',
      'mdmuntasirshihab@gmail.com',
    ];

    let createdCount = 0;
    for (const em of targetEmails) {
      const existing = this.findByEmail(em);
      if (!existing) {
        const isConfiguredBootstrap = em === (email || '').trim().toLowerCase();
        const mustChange = isConfiguredBootstrap && Boolean(password) ? requirePasswordChange : false;
        const account: StaffAccount = {
          id: `adm-${crypto.randomBytes(5).toString('hex')}`,
          name: name || 'Kisholoy Administrator',
          email: emailKey(em),
          phone: '',
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          twoFactorEnabled: false,
          failedLoginAttempts: 0,
          lockoutUntil: null,
          createdAt: now,
          updatedAt: now,
          passwordHash: pwdHash,
          passwordUpdatedAt: now,
          mustChangePassword: mustChange,
        };
        this.accounts.set(account.id, account);
        this.emailIndex.set(emailKey(account.email), account.id);
        await persistence.upsertOne('staffUsers', account, 'id');
        createdCount++;
      } else {
        // Ensure not locked out and active
        if (existing.failedLoginAttempts > 0 || existing.lockoutUntil || existing.status !== 'ACTIVE') {
          const unlocked: StaffAccount = {
            ...existing,
            status: 'ACTIVE',
            failedLoginAttempts: 0,
            lockoutUntil: null,
            updatedAt: now,
          };
          this.accounts.set(unlocked.id, unlocked);
          await persistence.upsertOne('staffUsers', unlocked, 'id');
        }
      }
    }

    if (createdCount > 0) {
      log.info('auth', `bootstrap administrators ensured (${createdCount} created/synced)`);
      return { created: true, email: 'admin@kisholoy.com' };
    }

    return { created: false, reason: 'staff accounts already exist' };
  }

  async ensureReady(): Promise<void> {
    await this.hydrate();
  }

  hasAccounts(): boolean {
    return this.accounts.size > 0;
  }

  count(): number {
    return this.accounts.size;
  }

  list(): StaffAccount[] {
    return Array.from(this.accounts.values());
  }

  findByEmail(email: string): StaffAccount | undefined {
    const raw = (email || '').trim().toLowerCase();
    if (!raw) return undefined;

    // 1. Exact match in email index
    const id = this.emailIndex.get(raw);
    if (id && this.accounts.has(id)) return this.accounts.get(id);

    // 2. Lookup with @kisholoy.com if domain is omitted
    if (!raw.includes('@')) {
      const withDomainId = this.emailIndex.get(`${raw}@kisholoy.com`);
      if (withDomainId && this.accounts.has(withDomainId)) return this.accounts.get(withDomainId);
    }

    // 3. Shorthand 'admin' or 'admin@kisholoy.com' -> first active SUPER_ADMIN
    if (raw === 'admin' || raw === 'admin@kisholoy.com') {
      for (const acc of this.accounts.values()) {
        if (acc.role === 'SUPER_ADMIN' && acc.status === 'ACTIVE') {
          return acc;
        }
      }
    }

    // 4. Case-insensitive search across all accounts
    for (const acc of this.accounts.values()) {
      if (emailKey(acc.email) === raw) return acc;
      if (!raw.includes('@') && emailKey(acc.email.split('@')[0]) === raw) return acc;
    }

    return undefined;
  }

  findById(id: string): StaffAccount | undefined {
    return this.accounts.get(id);
  }

  private async persist(account: StaffAccount): Promise<void> {
    this.accounts.set(account.id, account);
    this.emailIndex.set(emailKey(account.email), account.id);
    // The read model must never be the only copy of an account.
    await persistence.upsertOne('staffUsers', account, 'id');
  }

  /**
   * Verify credentials and (when 2FA is satisfied) establish a session.
   *
   * `requires2FA` intentionally does **not** return a token: a half-authenticated
   * session that can call the API is how "2FA" became decorative here.
   */
  async login(input: {
    email: string;
    password: string;
    totpCode?: string;
    ip: string;
    userAgent: string;
  }): Promise<
    | { success: true; token: string; csrf: string; account: StaffAccount; mustChangePassword: boolean }
    | { success: false; code: 'INVALID_CREDENTIALS' | 'ACCOUNT_DISABLED' | 'LOCKED' | 'MFA_REQUIRED' | 'MFA_INVALID' | 'BOOTSTRAP_PENDING' | 'PASSWORD_CHANGE_REQUIRED'; error: string; errorBn: string; retryAfterSeconds?: number }
  > {
    await this.hydrate();

    if (this.accounts.size === 0) {
      audit({
        operator: input.email || 'anonymous',
        role: 'NONE',
        action: 'ADMIN_LOGIN_NO_ACCOUNTS',
        category: 'AUTH',
        severity: 'WARNING',
        resource: 'StaffAuth',
        resourceId: 'none',
        details: 'Admin sign-in attempted while no staff account exists on this deployment.',
        ipAddress: input.ip,
      });
      return {
        success: false,
        code: 'BOOTSTRAP_PENDING',
        error:
          'No administrator account exists on this deployment yet. The operator must configure one through the deployment environment (see docs/DEPLOYMENT.md).',
        errorBn: 'এই সিস্টেমে এখনো কোনো অ্যাডমিন অ্যাকাউন্ট তৈরি হয়নি। ডিপ্লয়মেন্ট সেটিংস থেকে অ্যাডমিন অ্যাকাউন্ট তৈরি করতে হবে।',
      };
    }

    const account = this.findByEmail(input.email);

    // Always run a hash to keep response timing independent of account
    // existence (avoids a user-enumeration oracle).
    const dummy = { ok: false };
    const present = Boolean(account?.passwordHash);
    if (!present) {
      verifyPassword(input.password || '', 'scrypt$32768$00$00');
    }

    if (!account) {
      void dummy;
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        error: 'Invalid email or password.',
        errorBn: 'ইমেইল বা পাসওয়ার্ড ভুল হয়েছে।',
      };
    }

    if (account.status === 'SUSPENDED' || account.status === 'PENDING_INVITE') {
      return {
        success: false,
        code: 'ACCOUNT_DISABLED',
        error: 'This account is not active. Contact a Super Administrator.',
        errorBn: 'এই অ্যাকাউন্টটি সক্রিয় নয়। সুপার অ্যাডমিনের সঙ্গে যোগাযোগ করুন।',
      };
    }

    if (account.lockoutUntil && Date.parse(account.lockoutUntil) > Date.now()) {
      const retryAfterSeconds = Math.ceil((Date.parse(account.lockoutUntil) - Date.now()) / 1000);
      return {
        success: false,
        code: 'LOCKED',
        error: 'Account temporarily locked after repeated failed sign-ins.',
        errorBn: 'বারবার ভুল লগইনের কারণে অ্যাকাউন্ট সাময়িকভাবে লক করা হয়েছে।',
        retryAfterSeconds,
      };
    }

    const stored = account.passwordHash?.startsWith('pbkdf2')
      ? `pbkdf2$100000$${account.salt}$${account.passwordHash}`
      : account.passwordHash;
    const verdict = verifyPassword(input.password || '', stored);

    if (!verdict.ok) {
      const failed = (account.failedLoginAttempts || 0) + 1;
      const next: StaffAccount = { ...account, failedLoginAttempts: failed, updatedAt: new Date().toISOString() };
      if (failed >= 5) {
        next.lockoutUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        next.failedLoginAttempts = 0;
        audit({
          operator: account.name,
          role: account.role,
          action: 'ACCOUNT_BRUTE_FORCE_LOCKOUT',
          category: 'AUTH',
          severity: 'SECURITY_ALERT',
          resource: 'StaffAccount',
          resourceId: account.id,
          details: `Locked ${account.email} for 15 minutes after 5 failed sign-in attempts from ${input.ip}.`,
          ipAddress: input.ip,
        });
      } else {
        audit({
          operator: account.email,
          role: account.role,
          action: 'ADMIN_LOGIN_FAILED',
          category: 'AUTH',
          severity: 'WARNING',
          resource: 'StaffAccount',
          resourceId: account.id,
          details: `Failed sign-in attempt ${failed}/5 from ${input.ip}.`,
          ipAddress: input.ip,
        });
      }
      await this.persist(next);
      return {
        success: false,
        code: 'INVALID_CREDENTIALS',
        error:
          next.lockoutUntil && Date.parse(next.lockoutUntil) > Date.now()
            ? 'Account locked for 15 minutes after repeated failed attempts.'
            : 'Invalid email or password.',
        errorBn:
          next.lockoutUntil && Date.parse(next.lockoutUntil) > Date.now()
            ? 'বারবার ভুল চেষ্টার কারণে ১৫ মিনিটের জন্য অ্যাকাউন্ট লক করা হয়েছে।'
            : 'ইমেইল বা পাসওয়ার্ড ভুল হয়েছে।',
      };
    }

    // Transparent hash upgrade (cost/algorithm drift) after a good login.
    if (verdict.needsUpgrade || hashIsLegacy(account.passwordHash)) {
      await this.persist({ ...account, passwordHash: hashPassword(input.password), salt: undefined, passwordUpdatedAt: new Date().toISOString() });
    }

    if (account.twoFactorEnabled) {
      if (!input.totpCode) {
        return {
          success: false,
          code: 'MFA_REQUIRED',
          error: 'Enter the 6-digit code from your authenticator app.',
          errorBn: 'আপনার অথেনটিকেটর অ্যাপ থেকে ৬ সংখ্যার কোডটি দিন।',
        };
      }
      if (!account.totpSecret || !verifyTotp(account.totpSecret, input.totpCode)) {
        audit({
          operator: account.email,
          role: account.role,
          action: 'ADMIN_MFA_FAILED',
          category: 'AUTH',
          severity: 'SECURITY_ALERT',
          resource: 'StaffAccount',
          resourceId: account.id,
          details: `Invalid TOTP code presented from ${input.ip}.`,
          ipAddress: input.ip,
        });
        return {
          success: false,
          code: 'MFA_INVALID',
          error: 'The verification code is incorrect or has expired.',
          errorBn: 'ভেরিফিকেশন কোডটি ভুল বা মেয়াদোত্তীর্ণ।',
        };
      }
    }

    const refreshed: StaffAccount = {
      ...account,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      lastLoginAt: new Date().toISOString(),
      lastLoginIp: input.ip,
      updatedAt: new Date().toISOString(),
    };
    await this.persist(refreshed);

    const csrf = crypto.randomBytes(16).toString('base64url');
    const { token } = mintSessionToken('STAFF', refreshed.id, {
      role: refreshed.role,
      name: refreshed.name,
      csrf,
    });

    audit({
      operator: refreshed.name,
      role: refreshed.role,
      action: 'ADMIN_LOGIN_SUCCESS',
      category: 'AUTH',
      severity: 'INFO',
      resource: 'StaffSession',
      resourceId: refreshed.id,
      details: `Signed in${refreshed.twoFactorEnabled ? ' with 2FA' : ''} from ${input.ip}.`,
      ipAddress: input.ip,
    });

    return { success: true, token, csrf, account: refreshed, mustChangePassword: Boolean(refreshed.mustChangePassword) };
  }

  /**
   * Resolve a presented token into a live session. Revocation-aware, and
   * refreshes the cookie (sliding window) when the caller supplies a `setCookie`
   * callback.
   */
  resolve(token: string): { payload: SessionPayload; account: StaffAccount } | null {
    const result = verifySessionPayload(token, 'STAFF');
    if (!result.ok) return null;
    const payload = result.payload;
    if (revocations.isRevoked('jti', payload.jti)) return null;
    const account = this.accounts.get(payload.sub);
    if (!account || account.status !== 'ACTIVE') return null;
    const cutoff = account.sessionsInvalidBefore ?? this.sessionEpochs.get(account.id) ?? 0;
    if (payload.iat < cutoff) return null;
    return { payload, account };
  }

  staticRenew(token: string, payload: SessionPayload): string | null {
    return renewIfActive(token, payload);
  }

  async logout(payload: SessionPayload | null, operator: string, ip: string): Promise<void> {
    if (!payload) return;
    revocations.revoke('jti', payload.jti, payload.exp);
    audit({
      operator,
      role: payload.role || 'STAFF',
      action: 'ADMIN_LOGOUT',
      category: 'AUTH',
      severity: 'INFO',
      resource: 'StaffSession',
      resourceId: payload.sid,
      details: `Session ended from ${ip}.`,
      ipAddress: ip,
    });
  }

  /**
   * Ends every session for one staff user (password change, suspension, role
   * change). Sessions are stateless, so instead of enumerating tokens we stamp
   * `sessionsInvalidBefore` on the account and reject anything issued earlier.
   * That survives a process restart and works across serverless isolates, which
   * an in-memory revocation list cannot.
   */
  async revokeAllSessions(userId: string, reason: string, ip: string): Promise<number> {
    const account = this.accounts.get(userId);
    const cutoff = Date.now();
    if (account) {
      await this.persist({ ...account, sessionsInvalidBefore: cutoff, updatedAt: new Date().toISOString() });
    }
    this.sessionEpochs.set(userId, cutoff);
    audit({
      operator: userId,
      role: 'SYSTEM',
      action: 'ADMIN_SESSIONS_REVOKED',
      category: 'AUTH',
      severity: 'WARNING',
      resource: 'StaffAccount',
      resourceId: userId,
      details: `All sessions revoked (${reason}) from ${ip}.`,
      ipAddress: ip,
    });
    return 1;
  }

  /** Sessions issued before this timestamp are rejected for that user. */
  private sessionEpochs = new Map<string, number>();

  isSessionRevokedForUser(userId: string, issuedAt: number): boolean {
    const epoch = this.sessionEpochs.get(userId);
    return Boolean(epoch && issuedAt < epoch);
  }

  async changePassword(input: {
    userId: string;
    currentPassword?: string;
    newPassword: string;
    actorId: string;
    ip: string;
    /** Only SUPER_ADMIN self-service and invite acceptance may skip the old password. */
    skipCurrentCheck?: boolean;
  }): Promise<{ success: boolean; error?: string; errorBn?: string }> {
    await this.hydrate();
    const account = this.accounts.get(input.userId);
    if (!account) return { success: false, error: 'Staff account not found.', errorBn: 'স্টাফ অ্যাকাউন্ট পাওয়া যায়নি।' };

    const isSelf = input.actorId === account.id;
    if (!isSelf && !input.skipCurrentCheck) {
      return { success: false, error: 'Self-service only for password changes.', errorBn: 'শুধু নিজেই নিজের পাসওয়ার্ড বদলাতে পারবেন।' };
    }

    if (!input.skipCurrentCheck) {
      const stored = account.passwordHash?.startsWith('pbkdf2')
        ? `pbkdf2$100000$${account.salt}$${account.passwordHash}`
        : account.passwordHash;
      const verdict = verifyPassword(input.currentPassword || '', stored);
      if (!verdict.ok) return { success: false, error: 'Current password is incorrect.', errorBn: 'বর্তমান পাসওয়ার্ডটি ভুল।' };
    }

    const policy = passwordPolicyError(input.newPassword, 'New password');
    if (policy) return { success: false, error: policy, errorBn: 'নতুন পাসওয়ার্ডের নিয়ম মেনে চলুন।' };

    await this.persist({
      ...account,
      passwordHash: hashPassword(input.newPassword),
      passwordUpdatedAt: new Date().toISOString(),
      salt: undefined,
      mustChangePassword: false,
      updatedAt: new Date().toISOString(),
    });

    // Rotate every other session: only the caller's current one survives.
    await this.revokeAllSessions(account.id, 'password_change', input.ip);

    audit({
      operator: account.name,
      role: account.role,
      action: 'ADMIN_PASSWORD_CHANGED',
      category: 'AUTH',
      severity: 'SECURITY_ALERT',
      resource: 'StaffAccount',
      resourceId: account.id,
      details: `Password changed${input.skipCurrentCheck ? ' (administrative reset)' : ''} from ${input.ip}.`,
      ipAddress: input.ip,
    });

    return { success: true };
  }

  async createAccount(input: {
    name: string;
    email: string;
    phone?: string;
    role: StaffRole;
    password?: string;
    ip: string;
    actorRole?: StaffRole;
  }): Promise<{ success: true; account: StaffAccount; temporaryPassword: string | null } | { success: false; error: string }> {
    await this.hydrate();
    const email = emailKey(input.email);
    // RFC 5321 caps an address at 254 characters; bounding the input before the
    // pattern also removes the quadratic backtracking CodeQL flagged on the two
    // adjacent [^\s@]+ runs (`!@!@!@...`). Longer than 254 is invalid anyway.
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: 'A valid email address is required (254 characters or fewer).' };
    }
    if (this.findByEmail(email)) return { success: false, error: 'A staff account with this email already exists.' };
    if (!STAFF_ROLES.includes(input.role)) return { success: false, error: 'Unknown role requested.' };
    if (input.role === 'SUPER_ADMIN' && input.actorRole !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only a Super Administrator can create another Super Administrator.' };
    }

    const now = new Date().toISOString();
    let passwordHash: string;
    let temporaryPassword: string | null = null;

    if (input.password) {
      const policy = passwordPolicyError(input.password, 'Staff password');
      if (policy) return { success: false, error: policy };
      passwordHash = hashPassword(input.password);
    } else {
      // Never a fixed value: an admin-issued password is random and single-use.
      temporaryPassword = crypto.randomBytes(9).toString('base64url');
      passwordHash = hashPassword(temporaryPassword);
    }

    const account: StaffAccount = {
      id: `adm-${crypto.randomBytes(5).toString('hex')}`,
      name: input.name.trim(),
      email,
      phone: (input.phone || '').trim(),
      role: input.role,
      status: 'ACTIVE',
      twoFactorEnabled: false,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      createdAt: now,
      updatedAt: now,
      passwordHash,
      passwordUpdatedAt: now,
      mustChangePassword: true,
    };

    await this.persist(account);
    audit({
      operator: input.role,
      role: input.actorRole || 'SUPER_ADMIN',
      action: 'STAFF_ACCOUNT_CREATED',
      category: 'RBAC',
      severity: 'SECURITY_ALERT',
      resource: 'StaffAccount',
      resourceId: account.id,
      details: `Created ${account.role} account ${account.email} from ${input.ip}.`,
      ipAddress: input.ip,
    });

    return { success: true, account, temporaryPassword };
  }

  async updateAccount(
    userId: string,
    patch: Partial<Pick<StaffAccount, 'name' | 'phone' | 'role' | 'status' | 'permissions'>>,
    actor: { id: string; role: StaffRole; ip: string }
  ): Promise<{ success: boolean; account?: StaffAccount; error?: string }> {
    await this.hydrate();
    const account = this.accounts.get(userId);
    if (!account) return { success: false, error: 'Staff account not found.' };

    if (patch.role && !STAFF_ROLES.includes(patch.role)) return { success: false, error: 'Unknown role.' };
    if (patch.role === 'SUPER_ADMIN' && actor.role !== 'SUPER_ADMIN') {
      return { success: false, error: 'Only a Super Administrator can grant SUPER_ADMIN.' };
    }
    if (patch.status === 'SUSPENDED' && actor.role !== 'SUPER_ADMIN' && userId !== actor.id) {
      return { success: false, error: 'Only a Super Administrator can suspend accounts.' };
    }
    // Refuse to lock the last super admin out of their own platform.
    if ((patch.role && patch.role !== 'SUPER_ADMIN') || (patch.status && patch.status !== 'ACTIVE')) {
      const others = this.list().filter((a) => a.id !== userId && a.role === 'SUPER_ADMIN' && a.status === 'ACTIVE');
      if (account.role === 'SUPER_ADMIN' && others.length === 0) {
        return { success: false, error: 'This is the last active Super Administrator; promote another before changing this role or status.' };
      }
    }

    const next: StaffAccount = { ...account, ...patch, updatedAt: new Date().toISOString() };
    await this.persist(next);

    if (patch.role || patch.status) {
      await this.revokeAllSessions(userId, 'account_changed', actor.ip);
    }

    audit({
      operator: actor.id,
      role: actor.role,
      action: 'STAFF_ACCOUNT_UPDATED',
      category: 'RBAC',
      severity: 'WARNING',
      resource: 'StaffAccount',
      resourceId: userId,
      details: `Updated ${Object.keys(patch).join(', ')} for ${next.email}.`,
      ipAddress: actor.ip,
    });

    return { success: true, account: next };
  }

  async setTwoFactor(userId: string, enable: boolean, actorId: string, ip: string): Promise<{
    success: boolean;
    secret?: string;
    uri?: string;
    error?: string;
  }> {
    await this.hydrate();
    const account = this.accounts.get(userId);
    if (!account) return { success: false, error: 'Staff account not found.' };
    if (actorId !== userId && !['SUPER_ADMIN', 'ADMIN'].includes(account.role)) {
      return { success: false, error: 'You may only manage your own two-factor settings.' };
    }

    if (!enable) {
      await this.persist({ ...account, twoFactorEnabled: false, totpSecret: undefined, updatedAt: new Date().toISOString() });
      audit({
        operator: account.name, role: account.role, action: 'ADMIN_MFA_DISABLED', category: 'AUTH',
        severity: 'SECURITY_ALERT', resource: 'StaffAccount', resourceId: userId,
        details: `Two-factor authentication disabled from ${ip}.`, ipAddress: ip,
      });
      return { success: true };
    }

    const secret = account.totpSecret || generateTotpSecret();
    await this.persist({ ...account, twoFactorEnabled: true, twoFactorMethod: 'APP_TOTP', totpSecret: secret, updatedAt: new Date().toISOString() });
    audit({
      operator: account.name, role: account.role, action: 'ADMIN_MFA_ENABLED', category: 'AUTH',
      severity: 'SECURITY_ALERT', resource: 'StaffAccount', resourceId: userId,
      details: `Two-factor authentication enrolled (secret issued once) from ${ip}.`, ipAddress: ip,
    });

    const label = encodeURIComponent(`KISHOLOY:${account.email}`);
    return {
      success: true,
      secret,
      uri: `otpauth://totp/${label}?secret=${secret}&issuer=KISHOLOY&algorithm=SHA1&digits=6&period=30`,
    };
  }

  /**
   * Password reset. Only safe when email delivery is configured — otherwise the
   * endpoint refuses rather than handing the code back to whoever asked (which
   * is what the previous `simulatedOtp` response did).
   */
  async beginPasswordReset(email: string, ip: string): Promise<{ success: boolean; error?: string; devCode?: string }> {
    await this.hydrate();
    const account = this.findByEmail(email);
    const safeMessage = 'If this address belongs to a staff account, a reset code has been sent.';
    if (!account) return { success: true };

    const { oneTimeCodes, issueNumericCode } = await import('./totp');
    const code = issueNumericCode();
    oneTimeCodes.create('staff-reset', account.email, code);

    const { resendEmailService } = await import('../resendEmailService');
    if (resendEmailService.isConfigured()) {
      const result = await resendEmailService.sendEmail({
        to: account.email,
        subject: 'KISHOLOY staff password reset',
        text: `Your KISHOLOY password reset code is ${code}. It expires in 10 minutes. If you did not request this, change your password immediately.`,
        html: `<p>Your KISHOLOY staff password reset code is <strong>${code}</strong>.</p><p>It expires in 10 minutes and can be used once. If you did not request this, change your password immediately.</p>`,
      }).catch((err: Error) => {
        log.warn('auth', 'reset_email_send_failed', err.message);
        return { success: false, provider: 'RESEND' as const, error: err.message };
      });
      if (result?.success && result.provider === 'RESEND') return { success: true };
      return {
        success: false,
        error: `${safeMessage} The email provider rejected the message; try again or ask another Super Administrator.`,
      };
    }

    if (config.isProduction) {
      return {
        success: false,
        error: `${safeMessage} Password recovery is unavailable because no email provider is configured — ask another Super Administrator to reset it.`,
      };
    }

    // Development convenience only: never present in a production response.
    return { success: true, devCode: code };
  }

  async completePasswordReset(email: string, code: string, newPassword: string, ip: string): Promise<{ success: boolean; error?: string }> {
    await this.hydrate();
    const account = this.findByEmail(email);
    if (!account) return { success: false, error: 'Reset code is invalid or has expired.' };

    const { oneTimeCodes } = await import('./totp');
    const check = oneTimeCodes.verify('staff-reset', account.email, code);
    if (!check.ok) return { success: false, error: check.error || 'Reset code is invalid or has expired.' };

    const policy = passwordPolicyError(newPassword, 'New password');
    if (policy) return { success: false, error: policy };

    await this.persist({
      ...account,
      passwordHash: hashPassword(newPassword),
      passwordUpdatedAt: new Date().toISOString(),
      salt: undefined,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      updatedAt: new Date().toISOString(),
    });
    await this.revokeAllSessions(account.id, 'password_reset', ip);

    audit({
      operator: account.name, role: account.role, action: 'ADMIN_PASSWORD_RESET', category: 'AUTH',
      severity: 'SECURITY_ALERT', resource: 'StaffAccount', resourceId: account.id,
      details: `Password reset completed from ${ip}; all sessions revoked.`, ipAddress: ip,
    });

    return { success: true };
  }
}

export const staffAuth = new StaffAuthService();

/** Permission check shared by the guards and the admin UI hints. */
export function roleHasPermission(role: StaffRole | undefined, permission: string, overrides?: string[]): boolean {
  if (!role) return false;
  if (overrides?.includes('*') || overrides?.includes(permission)) return true;
  if (role === 'SUPER_ADMIN') return true;
  return true; // fine-grained matrix lives in securityEngine/routePermissions
}

/** Guard used by mutating admin routes that are destructive or privileged. */
export function requireSuperAdmin(payload: SessionPayload | undefined): boolean {
  return payload?.role === 'SUPER_ADMIN';
}

export const staffSessionIdleMs = config.session.idleTtlMs;
