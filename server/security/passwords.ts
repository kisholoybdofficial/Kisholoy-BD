/**
 * Password hashing and policy.
 *
 * Replaces the previous scheme (PBKDF2-SHA512, 10k iterations, and — worse —
 * a single hard-coded salt shared by every seeded staff account, which made
 * rainbow tables across all accounts equivalent).
 *
 * - New hashes use scrypt (memory-hard, RFC 7914) with a per-hash random salt.
 * - Legacy `pbkdf2$...` hashes still verify so existing records keep working,
 *   and callers upgrade them transparently on successful login.
 * - Comparison is constant time.
 * - Nothing here ever logs or returns a plaintext password or a hash.
 *
 * @license Apache-2.0
 */

import crypto from 'node:crypto';

const KEYLEN = 64;
/** scrypt cost parameter (N). 2^15 keeps a login under ~150ms server-side. */
const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

export type HashFormat = 'scrypt' | 'pbkdf2';

export interface PasswordRecord {
  hash: string;
  updatedAt: string;
  /** True until the user replaces a bootstrap/temporary password. */
  mustChange?: boolean;
}

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;

const COMMON_PASSWORDS = new Set([
  'kisholoy2026', 'kisholoy@2026', 'kisholoy@2026!', 'kisholoybd', 'admin123', 'password123',
  'password1234', 'qwerty123', '1234567890', '1111111111', 'iloveyou12', 'administrator',
]);

function scryptHash(plain: string, salt: Buffer, keylen: number, cost: number): Buffer {
  return crypto.scryptSync(plain.normalize('NFKC'), salt, keylen, {
    N: cost,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 256 * 1024 * 1024,
  });
}

/** `scrypt$<N>$<saltHex>$<keyHex>` */
export function hashPassword(plain: string): string {
  const salt = crypto.randomBytes(16);
  const key = scryptHash(plain, salt, KEYLEN, SCRYPT_N);
  return `scrypt$${SCRYPT_N}$${salt.toString('hex')}$${key.toString('hex')}`;
}

/** Verification for legacy records: `pbkdf2$<iterations>$<saltHex>$<keyHex>` (sha512, 64B). */
function pbkdf2Verify(plain: string, parts: string[]): boolean {
  const iterations = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  if (!Number.isFinite(iterations) || iterations <= 0 || expected.length === 0) return false;
  let actual: Buffer;
  try {
    actual = crypto.pbkdf2Sync(plain.normalize('NFKC'), salt, iterations, expected.length, 'sha512');
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/**
 * Constant-time verification. Returns `needsUpgrade` so callers can migrate a
 * legacy hash to scrypt right after a successful login.
 */
export function verifyPassword(
  plain: string,
  stored: string | undefined | null
): { ok: boolean; needsUpgrade: boolean } {
  if (!stored || !plain) return { ok: false, needsUpgrade: false };

  const parts = stored.split('$');
  if (parts.length !== 4) return { ok: false, needsUpgrade: false };

  if (parts[0] === 'pbkdf2') {
    const ok = pbkdf2Verify(plain, parts);
    return { ok, needsUpgrade: ok };
  }

  if (parts[0] !== 'scrypt') return { ok: false, needsUpgrade: false };

  const cost = Number(parts[1]);
  if (!Number.isFinite(cost) || cost <= 0) return { ok: false, needsUpgrade: false };

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = Buffer.from(parts[3], 'hex');
    actual = scryptHash(plain, Buffer.from(parts[2], 'hex'), expected.length, cost);
  } catch {
    return { ok: false, needsUpgrade: false };
  }

  if (expected.length !== actual.length) return { ok: false, needsUpgrade: false };
  return { ok: crypto.timingSafeEqual(expected, actual), needsUpgrade: cost < SCRYPT_N };
}

/** True when a stored hash is not the current recommended shape/cost. */
export function hashIsLegacy(stored: string | undefined | null): boolean {
  if (!stored) return true;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return true;
  return Number(parts[1]) < SCRYPT_N;
}

/**
 * `pbkdf2Sync` compatible helper kept for the pre-existing seed migration
 * path only — new code must use `hashPassword`.
 */
export function legacyPbkdf2(plain: string, saltHex: string, iterations = 100000): string {
  return crypto
    .pbkdf2Sync(plain.normalize('NFKC'), Buffer.from(saltHex, 'hex'), iterations, 64, 'sha512')
    .toString('hex');
}

export function makePasswordRecord(plain: string, opts: { mustChange?: boolean } = {}): PasswordRecord {
  return {
    hash: hashPassword(plain),
    updatedAt: new Date().toISOString(),
    mustChange: Boolean(opts.mustChange),
  };
}

/**
 * Composition policy. Deliberately not "complexity theatre": length carries
 * most of the entropy, and a breached-password check beats both.
 */
export function passwordPolicyError(plain: string | undefined | null, label = 'Password'): string | null {
  if (!plain || typeof plain !== 'string') return `${label} is required.`;
  if (plain.length < PASSWORD_MIN_LENGTH) {
    return `${label} must be at least ${PASSWORD_MIN_LENGTH} characters long.`;
  }
  if (plain.length > PASSWORD_MAX_LENGTH) {
    return `${label} must be shorter than ${PASSWORD_MAX_LENGTH} characters.`;
  }
  if (!/[A-Za-z]/.test(plain) || !/[0-9]/.test(plain)) {
    return `${label} must contain both letters and numbers.`;
  }
  if (/^(.)\1+$/.test(plain)) {
    return `${label} cannot be a single repeated character.`;
  }
  if (COMMON_PASSWORDS.has(plain.toLowerCase())) {
    return `${label} is too common. Choose a unique passphrase.`;
  }
  return null;
}

/**
 * Cryptographically random user-facing secret (no ambiguous characters).
 *
 * Two guarantees beyond randomness:
 *   - it is at least `PASSWORD_MIN_LENGTH` long and always contains a letter
 *     *and* a digit, because a temporary password the platform itself refuses
 *     (the old version could return letters-only) forces a reset loop;
 *   - characters are drawn with `crypto.randomInt`, not `byte % alphabet`, so
 *     the distribution is unbiased.
 */
export function generateTemporaryPassword(length = 16): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const alphabet = letters + digits;
  const size = Math.max(length, PASSWORD_MIN_LENGTH);

  const pick = (source: string): string => source[crypto.randomInt(source.length)];
  const chars: string[] = [pick(letters), pick(letters), pick(digits)];
  while (chars.length < size) chars.push(pick(alphabet));

  // Fisher–Yates: otherwise the guaranteed digit always sits at position 3.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
