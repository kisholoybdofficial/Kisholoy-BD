/**
 * Real step-up authentication codes.
 *
 * The previous `verifyMfaForAction` accepted **any** 6-digit number
 * (`/^[0-9]{6}$/`), so the MFA gate in front of supplier payouts, role
 * changes and permission edits was satisfied by typing `000000`. Anything
 * that was ever called "2FA" here protected nothing.
 *
 * This module implements:
 *  - RFC 6238 TOTP (SHA-1, 30s window, ±1 skew) with base32 secrets, so any
 *    standard authenticator app works;
 *  - server-issued one-time codes for email/OTP flows, stored only as an
 *    HMAC digest, single-use, expiring, with per-code attempt limits.
 *
 * @license Apache-2.0
 */

import crypto from 'node:crypto';
import { config } from '../config';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/g, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secretBytes: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', secretBytes).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

export interface TotpVerifyOptions {
  /** Accepted clock skew in steps (default 1 = ±30s). */
  window?: number;
  now?: number;
}

export function verifyTotp(secretBase32: string, code: string, opts: TotpVerifyOptions = {}): boolean {
  const clean = (code || '').replace(/\s|-/g, '');
  if (!/^[0-9]{6}$/.test(clean)) return false;
  let secretBytes: Buffer;
  try {
    secretBytes = base32Decode(secretBase32 || '');
  } catch {
    return false;
  }
  if (secretBytes.length === 0) return false;

  const window = opts.window ?? 1;
  const counter = Math.floor((opts.now ?? Date.now()) / 1000 / STEP_SECONDS);
  for (let delta = -window; delta <= window; delta++) {
    // Constant-time-ish compare for every candidate window step.
    if (crypto.timingSafeEqual(Buffer.from(hotp(secretBytes, counter + delta)), Buffer.from(clean))) {
      return true;
    }
  }
  return false;
}

/** otpauth:// URI for QR enrolment in any authenticator app. */
export function totpUri(secretBase32: string, account: string, issuer = 'KISHOLOY'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// One-time codes (password reset / email verification)
// ---------------------------------------------------------------------------

export interface OneTimeCode {
  /** HMAC of the code — the code itself is never stored. */
  codeHash: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
}

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;

const hmacCode = (purpose: string, subject: string, code: string): string =>
  crypto
    .createHmac('sha256', config.sessionSecret)
    .update(`${purpose}|${subject.toLowerCase()}|${code}`)
    .digest('hex');

export function issueNumericCode(digits = 6): string {
  const max = 10 ** digits;
  // Rejection sampling keeps the distribution uniform (modulo bias on
  // randomBytes would make some codes slightly more likely than others).
  for (;;) {
    const n = crypto.randomBytes(4).readUInt32BE(0);
    if (n < Math.floor(0xffffffff / max) * max) return String(n % max).padStart(digits, '0');
  }
}

export function issueOpaqueToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Small, self-contained code store. Single-use, attempt-limited, and scoped by
 * `purpose|subject` so a reset code cannot be replayed as a login code.
 */
class OneTimeCodeStore {
  private store = new Map<string, OneTimeCode>();

  private key(purpose: string, subject: string): string {
    return `${purpose}|${subject.toLowerCase()}`;
  }

  create(purpose: string, subject: string, code: string, ttlMs = CODE_TTL_MS): { codeHash: string; expiresAtMs: number } {
    const k = this.key(purpose, subject);
    const expiresAt = Date.now() + ttlMs;
    const codeHash = hmacCode(purpose, subject, code);
    this.store.set(k, { codeHash, expiresAt, attempts: 0, createdAt: Date.now() });
    this.prune();
    return { codeHash, expiresAtMs: expiresAt };
  }

  verify(purpose: string, subject: string, code: string): { ok: boolean; error?: string } {
    const k = this.key(purpose, subject);
    const entry = this.store.get(k);
    if (!entry) return { ok: false, error: 'Verification code is invalid or has already been used.' };
    if (Date.now() > entry.expiresAt) {
      this.store.delete(k);
      return { ok: false, error: 'Verification code has expired. Please request a new one.' };
    }
    if (entry.attempts >= MAX_CODE_ATTEMPTS) {
      this.store.delete(k);
      return { ok: false, error: 'Too many incorrect attempts. Please request a new code.' };
    }

    entry.attempts += 1;
    const candidate = Buffer.from(hmacCode(purpose, subject, (code || '').trim()));
    const expected = Buffer.from(entry.codeHash);
    if (candidate.length !== expected.length || !crypto.timingSafeEqual(candidate, expected)) {
      const left = MAX_CODE_ATTEMPTS - entry.attempts;
      return {
        ok: false,
        error: left > 0
          ? `Incorrect verification code. ${left} attempt${left === 1 ? '' : 's'} remaining.`
          : 'Too many incorrect attempts. Please request a new code.',
      };
    }

    // Single use.
    this.store.delete(k);
    return { ok: true };
  }

  peek(purpose: string, subject: string): OneTimeCode | undefined {
    return this.store.get(this.key(purpose, subject));
  }

  clear(purpose: string, subject: string): void {
    this.store.delete(this.key(purpose, subject));
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.store) if (now > v.expiresAt) this.store.delete(k);
  }
}

export const oneTimeCodes = new OneTimeCodeStore();
export const ONE_TIME_CODE_TTL_MS = CODE_TTL_MS;
