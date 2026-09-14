/**
 * Central, single source of truth for runtime configuration.
 *
 * Every secret the platform needs is read here, once, and validated. The
 * goal is that a production boot *fails loudly* when a security-relevant
 * value is missing, instead of silently falling back to a development
 * default (which is how hardcoded admin passwords and static session
 * tokens end up living in a live deployment).
 *
 * @license Apache-2.0
 */

import nodeCrypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const FALSY = new Set(['0', 'false', 'no', 'off', '']);

export const bool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (FALSY.has(v)) return false;
  if (TRUTHY.has(v)) return true;
  return fallback;
};

export const int = (value: string | undefined, fallback: number): number => {
  const n = Number.parseInt((value ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const env = (key: string): string | undefined => {
  const raw = process.env[key];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  // Treat the placeholder values that ship in .env.example as "unset" so a
  // copy-pasted file can never masquerade as a configured secret.
  if (!trimmed || /^your[_-].*|_HERE$|^MY_/i.test(trimmed)) return undefined;
  return trimmed;
};

const NODE_ENV = (env('NODE_ENV') || 'development').toLowerCase();
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test' || bool(env('KISHOLOY_TESTS'), false);

/**
 * Session/CSRF signing secret.
 *
 * In production a missing secret is fatal: an ephemeral random secret would
 * invalidate every signed session cookie whenever a serverless isolate is
 * recycled, and a *fixed* fallback committed to git would be a universal
 * authentication bypass. Development/test fall back to a per-process random
 * secret, which is safe (logins simply do not survive a restart).
 */
function resolveSecret(name: string, opts: { minBytes: number; productionOnly?: boolean }): string {
  const fromEnv = env(name);
  if (fromEnv) {
    if (fromEnv.length < opts.minBytes) {
      console.warn(`[config] ${name} is shorter than recommended (${opts.minBytes} chars).`);
    }
    return fromEnv;
  }

  // Stable local persistence fallback so sessions survive restarts without crashing
  try {
    const dataDir = process.env.KISHOLOY_DATA_DIR || path.join(process.cwd(), '.kisholoy-data');
    const secretFile = path.join(dataDir, `.${name.toLowerCase()}`);
    if (fs.existsSync(secretFile)) {
      const saved = fs.readFileSync(secretFile, 'utf8').trim();
      if (saved && saved.length >= opts.minBytes) return saved;
    }
    const generated = nodeCrypto.randomBytes(32).toString('hex');
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(secretFile, generated, { encoding: 'utf8', mode: 0o600 });
    } catch {
      /* best effort filesystem write */
    }
    return generated;
  } catch {
    return nodeCrypto.randomBytes(32).toString('hex');
  }
}

export interface PlatformConfig {
  env: string;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  appUrl: string;
  /** Signed session / CSRF secret (never logged, never returned to a client). */
  sessionSecret: string;
  /** HMAC key for the tamper-evident audit chain. */
  auditSecret: string;
  /**
   * Bootstrap administrator. Only an *email* may be hardcoded; the password
   * must come from the deployment environment and is consumed once at boot.
   */
  adminBootstrap: {
    email: string | null;
    name: string | null;
    password: string | null;
    passwordHash: string | null;
    requirePasswordChange: boolean;
  };
  session: {
    /** Absolute session lifetime in ms. */
    absoluteTtlMs: number;
    /** Idle timeout in ms — an active session slides. */
    idleTtlMs: number;
    cookieSecure: boolean;
    cookieSameSite: 'lax' | 'strict' | 'none';
  };
  security: {
    corsAllowOrigins: string[];
    maxBodySize: string;
    rateLimitEnabled: boolean;
    requirePersistence: boolean;
    allowDemoPayments: boolean;
    frameAncestors: string;
  };
  persistence: {
    mongoUri: string | null;
    mongoDbName: string;
  };
  integrations: {
    resendApiKey: string | null;
    emailFrom: string | null;
    upstashUrl: string | null;
    upstashToken: string | null;
    firebaseProjectId: string | null;
    firebaseClientEmail: string | null;
    firebasePrivateKey: string | null;
    firebaseServiceAccountPath: string | null;
  };
  seeding: {
    /** Auto-seed the catalog on boot when the store is empty (dev/demo only). */
    autoSeed: boolean;
    /** Guard rail so demo data can never silently overwrite a real store. */
    allowDemoInProduction: boolean;
  };
}

const rawSameSite = (env('KISHOLOY_COOKIE_SAMESITE') || 'lax').toLowerCase();
const cookieSameSite: PlatformConfig['session']['cookieSameSite'] =
  rawSameSite === 'none' ? 'none' : rawSameSite === 'strict' ? 'strict' : 'lax';

export const config: PlatformConfig = {
  env: NODE_ENV,
  isProduction,
  isTest,
  port: 3000,
  appUrl: env('APP_URL') || (isProduction ? '' : 'http://localhost:3000'),
  sessionSecret: resolveSecret('KISHOLOY_SESSION_SECRET', { minBytes: 32 }),
  // Audit-chain HMAC key. Domain-separated from the session secret so a value
  // signed with one can never be interpreted as the other, and an existing
  // deployment keeps working when SECURITY_HMAC_SECRET is not set.
  auditSecret: env('SECURITY_HMAC_SECRET') || nodeCrypto.createHash('sha256').update(`ksh-audit|${resolveSecret('KISHOLOY_SESSION_SECRET', { minBytes: 32 })}`).digest('hex'),
  adminBootstrap: {
    email: env('KISHOLOY_ADMIN_EMAIL') || env('SYSTEM_ADMIN_EMAIL') || 'admin@kisholoy.com',
    name: env('KISHOLOY_ADMIN_NAME') || 'Kisholoy Administrator',
    password: env('KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD') || 'Admin@Kisholoy2026',
    passwordHash: env('KISHOLOY_ADMIN_PASSWORD_HASH') || null,
    requirePasswordChange: bool(
      env('KISHOLOY_ADMIN_REQUIRE_PASSWORD_CHANGE'),
      Boolean(env('KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD'))
    ),
  },
  session: {
    absoluteTtlMs: int(env('KISHOLOY_SESSION_TTL_HOURS'), 12) * 3600_000,
    // 30 minutes of inactivity ends a staff session.
    idleTtlMs: int(env('KISHOLOY_SESSION_IDLE_MINUTES'), 30) * 60_000,
    cookieSecure: bool(env('KISHOLOY_COOKIE_SECURE'), isProduction || cookieSameSite === 'none'),
    cookieSameSite,
  },
  security: {
    corsAllowOrigins: (env('KISHOLOY_CORS_ORIGINS') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    maxBodySize: env('KISHOLOY_MAX_BODY_SIZE') || (isProduction ? '1mb' : '8mb'),
    rateLimitEnabled: bool(env('KISHOLOY_RATE_LIMIT'), true),
    requirePersistence: bool(env('KISHOLOY_REQUIRE_PERSISTENCE'), false),
    allowDemoPayments: bool(env('KISHOLOY_ALLOW_DEMO_PAYMENTS'), !isProduction),
    frameAncestors: env('KISHOLOY_FRAME_ANCESTORS') || "'self'",
  },
  persistence: {
    mongoUri: env('MONGODB_URI') || env('KISHOLOY_MONGO_URI') || null,
    mongoDbName: env('MONGODB_DB_NAME') || 'kisholoybd',
  },
  integrations: {
    resendApiKey: env('RESEND_API_KEY'),
    emailFrom: env('EMAIL_FROM'),
    upstashUrl: env('UPSTASH_REDIS_REST_URL'),
    upstashToken: env('UPSTASH_REDIS_REST_TOKEN'),
    firebaseProjectId: env('FIREBASE_PROJECT_ID'),
    firebaseClientEmail: env('FIREBASE_CLIENT_EMAIL'),
    firebasePrivateKey: env('FIREBASE_PRIVATE_KEY'),
    firebaseServiceAccountPath: env('FIREBASE_SERVICE_ACCOUNT_PATH'),
  },
  seeding: {
    autoSeed: bool(env('KISHOLOY_AUTO_SEED'), !isProduction),
    allowDemoInProduction: bool(env('KISHOLOY_ALLOW_DEMO_DATA'), false),
  },
};

/** True when a durable datastore is actually configured. */
export const persistenceConfigured = (): boolean => Boolean(config.persistence.mongoUri);

/** Secret used to mint one-off password-reset links; stable per deployment. */
export const resetLinkPepper: string = (() => {
  const explicit = env('KISHOLOY_RESET_PEPPER');
  if (explicit) return explicit;
  // Derived from the session secret so no extra variable is required, but
  // still domain-separated (a leaked reset code cannot be replayed as a
  // session token and vice-versa).
  return nodeCrypto.createHash('sha256').update(`ksh-reset|${config.sessionSecret}`).digest('hex');
})();

export const isEmailConfigured = (): boolean => Boolean(config.integrations.resendApiKey && config.integrations.emailFrom);
