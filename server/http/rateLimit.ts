/**
 * Rate limiting for the platform's abuse-sensitive surfaces.
 *
 * Two problems fixed here:
 *  1. The old limiter kept a process-local `Map` and *whitelisted localhost*.
 *     Behind Vercel (or any same-host proxy) `req.socket.remoteAddress` is
 *     `::ffff:127.0.0.1`, so every request matched the whitelist and no limit
 *     was ever applied; and even when it worked, each serverless isolate had its
 *     own counter, so a distributed attacker was never counted together.
 *  2. The AUTH tier allowed 180 login attempts per minute per IP — useless
 *     against credential stuffing.
 *
 * Behaviour:
 *  - Upstash Redis is used when configured, so counters are shared globally;
 *  - otherwise a per-process sliding window (documented as best-effort);
 *  - in production, no implicit localhost exemption (set
 *    `KISHOLOY_RATELIMIT_BYPASS_IPS` to opt specific addresses in deliberately);
 *  - responses carry `Retry-After` so clients behave correctly.
 *
 * @license Apache-2.0
 */

import type { Request, Response, NextFunction } from 'express';
import { config } from '../config';
import { upstashRedisService } from '../upstashService';
import { log } from './errors';

export type LimitTier = 'STOREFRONT' | 'CHECKOUT' | 'AUTH' | 'ADMIN' | 'WEBHOOK' | 'PUBLIC_READ';

interface TierSpec {
  windowMs: number;
  max: number;
}

const TIERS: Record<LimitTier, TierSpec> = {
  STOREFRONT: { windowMs: 60_000, max: 600 },
  PUBLIC_READ: { windowMs: 60_000, max: 900 },
  CHECKOUT: { windowMs: 60_000, max: 20 },
  // Login/reset endpoints: brute force must be expensive.
  AUTH: { windowMs: 15 * 60_000, max: 12 },
  ADMIN: { windowMs: 60_000, max: 300 },
  WEBHOOK: { windowMs: 60_000, max: 240 },
};

const bypassIps = new Set(
  (process.env.KISHOLOY_RATELIMIT_BYPASS_IPS || (config.isProduction ? '' : '127.0.0.1,::1'))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

const redisAvailable = (): boolean => Boolean(config.integrations.upstashUrl && config.integrations.upstashToken);

// ---------------------------------------------------------------------------
// Fallback: per-process sliding window.
// ---------------------------------------------------------------------------
const buckets = new Map<string, number[]>();
const MAX_TRACKED_KEYS = 50_000;

function localAllow(key: string, spec: TierSpec): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  const cutoff = now - spec.windowMs;
  let hits = buckets.get(key);
  if (!hits) {
    if (buckets.size > MAX_TRACKED_KEYS) {
      for (const [k, v] of buckets) {
        if (!v.length || v[v.length - 1] < cutoff) buckets.delete(k);
      }
    }
    hits = [];
    buckets.set(key, hits);
  }
  while (hits.length && hits[0] < cutoff) hits.shift();
  hits.push(now);
  const allowed = hits.length <= spec.max;
  return { allowed, remaining: Math.max(0, spec.max - hits.length), resetMs: spec.windowMs - (now - hits[0]) };
}

async function redisAllow(key: string, spec: TierSpec): Promise<{ allowed: boolean; remaining: number; resetMs: number } | null> {
  if (!redisAvailable()) return null;
  const ttlSeconds = Math.ceil(spec.windowMs / 1000);
  try {
    const count = await upstashRedisService.incr(`rl:${key}`, ttlSeconds);
    if (count === null || count === undefined) return null;
    return { allowed: count <= spec.max, remaining: Math.max(0, spec.max - count), resetMs: ttlSeconds * 1000 };
  } catch (err) {
    log.warn('ratelimit', 'redis_unavailable', (err as Error).message);
    return null;
  }
}

export const tierForRequest = (path: string, method: string): LimitTier => {
  if (method === 'GET' || method === 'HEAD') {
    if (path.startsWith('/api/admin') || path.startsWith('/api/security') || path.startsWith('/api/reports') ||
        path.startsWith('/api/finance') || path.startsWith('/api/customers') || path.startsWith('/api/marketing')) {
      return 'ADMIN';
    }
    return 'PUBLIC_READ';
  }
  if (path.startsWith('/api/security/auth') || path.startsWith('/api/customer/auth') ||
      path === '/api/suppliers/portal/login' || /^\/api\/suppliers\/[^/]+\/(portal-token|set-portal-password)$/.test(path)) {
    return 'AUTH';
  }
  if (path.startsWith('/api/checkout') || path === '/api/orders/create') return 'CHECKOUT';
  if (path.startsWith('/api/webhooks') || path.startsWith('/api/courier/webhook') || path.startsWith('/api/payments/ipn')) return 'WEBHOOK';
  if (path.startsWith('/api/admin') || path.startsWith('/api/security') || path.startsWith('/api/marketing/command') ||
      path.startsWith('/api/system') || path.startsWith('/api/finance')) {
    return 'ADMIN';
  }
  return 'STOREFRONT';
};

/**
 * The limiter bucket IS the brute-force defence, so its key must not be
 * client-controlled. `x-forwarded-for` is a comma list an anonymous caller
 * can forge per attempt (`X-Forwarded-For: 1.2.3.4`, next request
 * `5.6.7.8`), which buys unlimited login/reset tries while the tier looks
 * busy.
 *
 * Express resolves `req.ip` through `app.set('trust proxy', 1)`: behind the
 * platform proxy it is the real client, and a spoofed extra entry is ignored
 * because only the hop our proxy appended is trusted.
 */
const clientIp = (req: Request): string => {
  const resolved = (req as unknown as { ip?: string }).ip;
  if (typeof resolved === 'string' && resolved.trim()) return resolved.trim();
  const socket = (req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return socket || 'unknown';
};

/**
 * A second, tighter limit keyed on the submitted identifier, so an attacker
 * rotating IPs cannot hammer one account (and rotating accounts cannot hammer
 * one IP either).
 */
const identifierOf = (req: Request): string | null => {
  const body = req.body as { identifier?: string; email?: string; emailOrPhone?: string } | undefined;
  const raw = body?.identifier || body?.email || body?.emailOrPhone;
  if (!raw || typeof raw !== 'string') return null;
  return raw.trim().toLowerCase().slice(0, 120);
};

export function rateLimitMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!config.security.rateLimitEnabled) return next();
    const path = req.path || (req.url || '').split('?')[0];
    if (!path.startsWith('/api/')) return next();

    const ip = clientIp(req);
    if (bypassIps.has(ip)) return next();

    const tier = tierForRequest(path, req.method);
    const spec = TIERS[tier];

    const check = (await redisAllow(`${tier}:${ip}`, spec)) || localAllow(`${tier}:${ip}`, spec);

    res.setHeader('X-RateLimit-Limit', String(spec.max));
    res.setHeader('X-RateLimit-Remaining', String(check.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(check.resetMs / 1000)));

    if (!check.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(check.resetMs / 1000))));
      return res.status(429).json({
        success: false,
        code: 'RATE_LIMITED',
        error: 'Too many requests from this connection. Please slow down and try again shortly.',
        errorBn: 'অনেক বেশি অনুরোধ এসেছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।',
        tier,
        retryAfterSeconds: Math.max(1, Math.ceil(check.resetMs / 1000)),
      });
    }

    if (tier === 'AUTH') {
      const identifier = identifierOf(req);
      if (identifier) {
        const accountSpec = { windowMs: 15 * 60_000, max: 8 };
        const accountCheck =
          (await redisAllow(`AUTH-ID:${identifier}`, accountSpec)) || localAllow(`AUTH-ID:${identifier}`, accountSpec);
        if (!accountCheck.allowed) {
          res.setHeader('Retry-After', String(Math.max(1, Math.ceil(accountCheck.resetMs / 1000))));
          return res.status(429).json({
            success: false,
            code: 'ACCOUNT_THROTTLED',
            error: 'Too many sign-in attempts for this account. Wait a few minutes, or reset your password.',
            errorBn: 'এই অ্যাকাউন্টে অনেক বেশি লগইন চেষ্টা হয়েছে। কয়েক মিনিট পর আবার চেষ্টা করুন, অথবা পাসওয়ার্ড রিসেট করুন।',
            retryAfterSeconds: Math.max(1, Math.ceil(accountCheck.resetMs / 1000)),
          });
        }
      }
    }

    next();
  };
}

export const rateLimitTierSpecs = TIERS;
