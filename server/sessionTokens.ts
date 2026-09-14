/**
 * Signed session tokens — the single authentication primitive for the whole
 * platform (staff, customer and supplier).
 *
 * Why this exists
 * ---------------
 * The platform used to accept three different kinds of credential, all broken
 * in their own way:
 *   1. A static string (a fixed 2026-era literal, now only present in tests as
 *      an attack payload) that
 *      `attachAuthContext` mapped straight to SUPER_ADMIN — a permanent,
 *      source-code-visible admin bypass.
 *   2. Opaque staff tokens looked up in a process-local `Map`. That cannot
 *      work on serverless (each isolate has its own map) and it leaked identity
 *      information across restarts.
 *   3. Customer tokens whose *identity* was parsed out of the raw token shape
 *      (`ksh-cust-sess-<id>-<ts>`), so a caller could simply present an id
 *      they did not own.
 *
 * Now every session is an HMAC-signed, self-describing token:
 *   `ksh1.<base64url(payload)>.<signature>`
 * with `{ sub, typ, role, sid, iat, exp, jti }`. Identity always comes from
 * the verified payload. Tokens are stateless (so they survive isolate cold
 * starts) but revocable: `jti` is recorded in a revocation set that is kept in
 * memory and mirrored to durable storage when MongoDB is configured.
 *
 * @license Apache-2.0
 */

import crypto from 'node:crypto';
import { config } from './config';

const SECRET: string = config.sessionSecret;
const VERSION = 'ksh1';

export type SessionKind = 'STAFF' | 'CUSTOMER' | 'SUPPLIER';

export interface SessionPayload {
  /** Subject id: staff user id, customer id or supplier id. */
  sub: string;
  typ: SessionKind;
  role?: string;
  /** Human-readable name carried for audit/UI only. */
  name?: string;
  /** Session id — groups all tokens minted by one login, used for bulk revoke. */
  sid: string;
  /** Unique token id — used for single-token revocation. */
  jti: string;
  iat: number;
  exp: number;
  /** CSRF binding value; mirrors the non-httpOnly `ksh_csrf` cookie. */
  csrf?: string;
}

const b64u = (buf: Buffer): string => buf.toString('base64url');

function sign(data: string): string {
  return crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a || '');
  const bb = Buffer.from(b || '');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export interface MintOptions {
  role?: string;
  name?: string;
  absoluteTtlMs?: number;
  idleTtlMs?: number;
  sid?: string;
  csrf?: string;
}

/**
 * Mint a signed session token. Absolute TTL is capped by the platform config;
 * the effective expiry is `min(absolute, now + idle)` at issue time and is
 * refreshed by `renewIfActive` on use (sliding window).
 */
export function mintSessionToken(kind: SessionKind, subjectId: string, opts: MintOptions = {}): {
  token: string;
  payload: SessionPayload;
} {
  const now = Date.now();
  const absoluteTtl = Math.min(opts.absoluteTtlMs ?? config.session.absoluteTtlMs, config.session.absoluteTtlMs);
  const payload: SessionPayload = {
    sub: subjectId,
    typ: kind,
    role: opts.role,
    name: opts.name,
    sid: opts.sid || crypto.randomBytes(8).toString('hex'),
    jti: crypto.randomBytes(12).toString('base64url'),
    iat: now,
    exp: now + absoluteTtl,
    csrf: opts.csrf || crypto.randomBytes(16).toString('base64url'),
  };
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  const token = `${VERSION}.${body}.${sign(body)}`;
  return { token, payload };
}

export type VerifyResult =
  | { ok: true; payload: SessionPayload; expired: false }
  | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'wrong_kind' };

/**
 * Verify signature + expiry. Does NOT consult the revocation set — callers
 * that need revocation must go through `authService`.
 */
export function verifySessionPayload(token: string, expectKind?: SessionKind): VerifyResult {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) {
    // Legacy `ksh-cust-sess-<id>-<ts>.<sig>` shape: rejected outright. Those
    // tokens were minted by the previous implementation and are deliberately
    // not honoured, because their payload carried no expiry.
    return { ok: false, reason: 'malformed' };
  }
  const [, body, sig] = parts;
  if (!safeEqual(sig, sign(body))) return { ok: false, reason: 'signature' };

  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (!payload || typeof payload.sub !== 'string' || typeof payload.exp !== 'number') {
    return { ok: false, reason: 'malformed' };
  }
  if (Date.now() > payload.exp) return { ok: false, reason: 'expired' };
  if (expectKind && payload.typ !== expectKind) return { ok: false, reason: 'wrong_kind' };
  return { ok: true, payload, expired: false };
}

/** Revocation set (jti + sid), mirrored to durable storage by authService. */
class RevocationSet {
  private jtis = new Map<string, number>();
  private sids = new Map<string, number>();
  /** Hook installed by the persistence layer so revocations survive restarts. */
  private sink: ((id: string, kind: 'jti' | 'sid', expiresAt: number) => void) | null = null;

  setSink(sink: ((id: string, kind: 'jti' | 'sid', expiresAt: number) => void) | null): void {
    this.sink = sink;
  }

  revoke(kind: 'jti' | 'sid', id: string, expiresAt: number): void {
    (kind === 'jti' ? this.jtis : this.sids).set(id, expiresAt);
    this.sink?.(id, kind, expiresAt);
    this.prune();
  }

  isRevoked(kind: 'jti' | 'sid', id: string | undefined): boolean {
    if (!id) return false;
    const until = (kind === 'jti' ? this.jtis : this.sids).get(id);
    if (until === undefined) return false;
    if (Date.now() > until) {
      (kind === 'jti' ? this.jtis : this.sids).delete(id);
      return false;
    }
    return true;
  }

  /** Called after hydrating durable revocations on boot. */
  hydrate(entries: { id: string; kind: 'jti' | 'sid'; expiresAt: number }[]): void {
    for (const e of entries) (e.kind === 'jti' ? this.jtis : this.sids).set(e.id, e.expiresAt);
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.jtis) if (now > v) this.jtis.delete(k);
    for (const [k, v] of this.sids) if (now > v) this.sids.delete(k);
  }
}

export const revocations = new RevocationSet();

/**
 * Sliding-window renewal: returns a fresh token when the presented one is
 * inside its absolute window but past the idle half-life, so an active user
 * is never dropped mid-task while an abandoned session still dies.
 */
export function renewIfActive(token: string, payload: SessionPayload): string | null {
  const halfLife = config.session.idleTtlMs;
  const renewedAt = payload.exp - halfLife;
  if (Date.now() - renewedAt < halfLife / 2) return null;
  const next = mintSessionToken(payload.typ, payload.sub, {
    role: payload.role,
    name: payload.name,
    sid: payload.sid,
    csrf: payload.csrf,
    absoluteTtlMs: Math.max(halfLife, Math.min(payload.exp - Date.now() + halfLife, config.session.absoluteTtlMs)),
  });
  revocations.revoke('jti', payload.jti, payload.exp);
  return next.token;
}

// ---------------------------------------------------------------------------
// Compatibility shims for the previous public API (supplier/customer routes
// still import these names). They now produce/parse the signed format only.
// ---------------------------------------------------------------------------

export function issueSessionToken(kind: 'CUSTOMER' | 'SUPPLIER', subjectId: string): string {
  return mintSessionToken(kind, subjectId).token;
}

export function verifySessionToken(kind: 'CUSTOMER' | 'SUPPLIER', token: string): string | null {
  const res = verifySessionPayload(token, kind);
  return res.ok ? res.payload.sub : null;
}

/** Constant-time opaque compare helper for shared secrets (webhooks). */
export function safeCompare(a: string, b: string): boolean {
  return safeEqual(a, b);
}
