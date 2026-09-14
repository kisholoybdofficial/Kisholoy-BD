/**
 * Cookie sessions + CSRF binding.
 *
 * Sessions live in httpOnly cookies rather than `localStorage`: a stored XSS in
 * a 140-file React app would otherwise be a full account takeover (including
 * the staff token that unlocks the entire admin API). SameSite=Lax plus a
 * session-bound CSRF token blocks cross-site mutation, while same-origin
 * `fetch()` keeps working without touching ~200 admin call sites — the browser
 * sends the cookie itself, and the single global fetch interceptor attaches the
 * CSRF header.
 *
 * Bearer tokens remain supported for first-party API tooling (no CSRF needed,
 * since a cross-origin attacker cannot set an Authorization header without a
 * CORS preflight grant).
 *
 * @license Apache-2.0
 */

import nodeCrypto from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config';

export const ADMIN_COOKIE = 'ksh_admin';
export const CUSTOMER_COOKIE = 'ksh_customer';
export const SUPPLIER_COOKIE = 'ksh_supplier';
export const CSRF_COOKIE = 'ksh_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | 'none';
  path?: string;
  maxAgeSeconds?: number;
  expires?: Date;
  domain?: string;
}

const splitCookies = (header: string | string[] | undefined): string[] => {
  if (!header) return [];
  return Array.isArray(header) ? header : [header];
};

/** Minimal, dependency-free Cookie header parser (RFC 6265 subset). */
export function parseCookies(req: IncomingMessage | { headers: IncomingMessage['headers'] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of splitCookies(req.headers.cookie)) {
    for (const pair of raw.split(';')) {
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      const name = pair.slice(0, idx).trim();
      if (out[name] !== undefined) continue;
      const value = pair.slice(idx + 1).trim();
      try {
        out[name] = decodeURIComponent(value.replace(/%2C/g, ','));
      } catch {
        out[name] = value;
      }
    }
  }
  return out;
}

export function readSessionCookie(
  req: { headers: IncomingMessage['headers'] },
  name: string
): { token: string | null; csrf: string | null } {
  const jar = parseCookies(req as IncomingMessage);
  return { token: jar[name] || null, csrf: jar[CSRF_COOKIE] || null };
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${opts.path || '/'}`);
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${Math.floor(opts.maxAgeSeconds)}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly !== false) parts.push('HttpOnly');
  const sameSite = opts.sameSite ?? config.session.cookieSameSite;
  const secure = opts.secure ?? config.session.cookieSecure;
  parts.push(`SameSite=${sameSite === 'lax' ? 'Lax' : sameSite === 'strict' ? 'Strict' : 'None'}`);
  // Browsers refuse SameSite=None without Secure; force the pair.
  if (sameSite === 'none' || secure) parts.push('Secure');
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  return parts.join('; ');
}

/**
 * Issue the session cookie pair. The CSRF value is *also* embedded in the
 * signed session payload, so the header must match the session that the cookie
 * belongs to — a stolen CSRF value alone authenticates nothing.
 */
export function setSessionCookies(
  res: ServerResponse,
  kind: 'staff' | 'customer' | 'supplier',
  token: string,
  csrf: string
): void {
  const maxAge = Math.floor(config.session.absoluteTtlMs / 1000);
  const name = kind === 'staff' ? ADMIN_COOKIE : kind === 'customer' ? CUSTOMER_COOKIE : SUPPLIER_COOKIE;
  const cookies = [serializeCookie(name, token, { maxAgeSeconds: maxAge, httpOnly: true })];
  // The CSRF cookie is deliberately readable by JS — that is the whole design.
  cookies.push(
    `ksh_csrf=${encodeURIComponent(csrf)}; Path=/; Max-Age=${maxAge}; SameSite=${
      config.session.cookieSameSite === 'none' ? 'None' : 'Lax'
    }${config.session.cookieSecure ? '; Secure' : ''}`
  );
  res.setHeader('Set-Cookie', cookies);
}

export function clearSessionCookies(res: ServerResponse, kind: 'staff' | 'customer' | 'supplier' | 'all' = 'all'): void {
  const past = new Date(0);
  const names =
    kind === 'all'
      ? [ADMIN_COOKIE, CUSTOMER_COOKIE, SUPPLIER_COOKIE, CSRF_COOKIE]
      : [
          ...[kind === 'staff' ? ADMIN_COOKIE : kind === 'customer' ? CUSTOMER_COOKIE : SUPPLIER_COOKIE],
          CSRF_COOKIE,
        ];
  const existing = res.getHeader('Set-Cookie');
  const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : [];
  res.setHeader(
    'Set-Cookie',
    [...list, ...names.map((n) => serializeCookie(n, '', { expires: past, maxAgeSeconds: 0 }))]
  );
}

/** Request methods that mutate state and therefore need CSRF binding. */
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isUnsafeMethod(method: string | undefined): boolean {
  return UNSAFE.has((method || 'GET').toUpperCase());
}

export function csrfHeaderMatches(req: { headers: IncomingMessage['headers'] }, expected: string | undefined): boolean {
  if (!expected) return false;
  const raw = req.headers[CSRF_HEADER];
  const sent = Array.isArray(raw) ? raw[0] : raw;
  if (!sent) return false;
  if (sent.length !== expected.length) return false;
  // Both values come from our own base64url payloads; a plain compare would be
  // fine, but constant time costs nothing.
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return nodeCrypto.timingSafeEqual(a, b);
}
