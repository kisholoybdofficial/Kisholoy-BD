/**
 * Production HTTP response hardening: security headers + CORS.
 *
 * Replaces the previous single inline middleware in `server.ts`, which:
 *   - sent `Access-Control-Allow-Origin: *` together with `Authorization`
 *     (any website could issue credentialed reads of admin data if a browser
 *     ever had a session),
 *   - pinned `frame-ancestors` to a list of AI Studio preview hosts, and
 *   - set the deprecated `X-XSS-Protection` (it enables legacy auditor modes in
 *     some browsers and is a net negative).
 *
 * CSP is derived from what the app actually loads (Google Fonts, Unsplash
 * imagery, Firebase Auth/Firestore, Supabase, Resend) so it does not silently
 * break the storefront. Set `KISHOLOY_CSP=report-only` to collect violations
 * before enforcing.
 *
 * @license Apache-2.0
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { config } from '../config';

const CSP_DIRECTIVES_PROD = [
  "default-src 'self'",
  // Script: only same-origin bundles. No unsafe-inline: the theme bootstrap and
  // service-worker registration are shipped as files (see public/theme-init.js).
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https://images.unsplash.com https://*.unsplash.com https://picsum.photos",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://*.supabase.co https://api.resend.com",
  "frame-src 'self' https://*.sslcommerz.com https://sandbox.sslcommerz.com https://*.bkasl.com https://tokenized.pay.bka.sh https://api.pathao.com",
  "frame-ancestors " + (config.security.frameAncestors || "'self'"),
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
];

/** Development loosens script-src so Vite HMR can inject inline bootstraps. */
const CSP_DIRECTIVES_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'img-src * data: blob:',
  "font-src 'self' data: https://fonts.gstatic.com",
  'connect-src * ws: wss:',
  "frame-src 'self' https:",
  "frame-ancestors 'self' http://localhost:*",
  "base-uri 'self'",
  "object-src 'none'",
];

export const cspHeaderValue = (reportOnly: boolean): string => {
  const directives = config.isProduction ? CSP_DIRECTIVES_PROD : CSP_DIRECTIVES_DEV;
  const value = directives.join('; ');
  return reportOnly ? `${value}; report-uri /api/security/csp-report; report-to csp-endpoint` : value;
};

export interface SecurityHeaderOptions {
  /** When true the policy is reported, not enforced. */
  reportOnly?: boolean;
  /** Extra origins allowed for credentialed cross-origin API access. */
  corsAllowOrigins?: string[];
}

const isAllowedOrigin = (origin: string | undefined, allowlist: string[]): boolean => {
  if (!origin || origin === 'null') return false;
  if (allowlist.includes(origin)) return true;
  // Same-origin requests have no Origin header in some browsers — those are
  // allowed by simply not needing CORS at all.
  try {
    const host = new URL(origin).host;
    // Local tooling/preview hosts are explicitly permitted in development.
    if (!config.isProduction && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return true;
    if (/\.e2b\.app$/.test(new URL(origin).hostname)) return true;
  } catch {
    return false;
  }
  return false;
};

/**
 * Express middleware. Also usable as a plain function for the serverless
 * handler wrapper.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}) {
  const allowlist = options.corsAllowOrigins ?? config.security.corsAllowOrigins;
  const header = (res: ServerResponse, name: string, value: string) => {
    if (!res.getHeader(name)) res.setHeader(name, value);
  };

  return (req: IncomingMessage & { path?: string }, res: ServerResponse, next: () => void) => {
    const origin = (req.headers.origin as string) || undefined;

    header(res, 'X-Content-Type-Options', 'nosniff');
    header(res, 'X-Frame-Options', 'DENY');
    header(res, 'Referrer-Policy', 'strict-origin-when-cross-origin');
    header(res, 'Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetic-sensor=()');
    header(res, 'Cross-Origin-Opener-Policy', 'same-origin');
    // Deliberately NOT setting Cross-Origin-Embedder-Policy: the catalog embeds
    // third-party imagery (images.unsplash.com) that does not send CORP, so
    // `require-corp` would blank every product photo. COEP is only safe once
    // all media is self-hosted.
    header(res, 'X-DNS-Prefetch-Control', 'off');
    // Only the API is no-store; static assets keep their own cache headers.
    const path = req.path || (req.url || '').split('?')[0];
    if (path.startsWith('/api/')) header(res, 'Cache-Control', 'no-store');
    if (config.isProduction) {
      header(res, 'Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    }
    header(res, options.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', cspHeaderValue(options.reportOnly));

    // CORS: never a wildcard alongside credentials.
    if (origin) {
      if (isAllowedOrigin(origin, allowlist)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-CSRF-Token, X-Staff-Token, X-Requested-With, X-Supplier-Id, X-Order-Source'
        );
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '600');
      } else if (path.startsWith('/api/')) {
        // A cross-origin API call from an unlisted site is refused outright.
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: false, error: 'Origin not allowed.', errorBn: 'এই ওয়েবসাইট থেকে অনুরোধ অনুমোদিত নয়।', code: 'CORS_ORIGIN_DENIED' }));
        return;
      }
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(origin && isAllowedOrigin(origin, allowlist) ? 204 : 403);
      res.end();
      return;
    }

    next();
  };
}
