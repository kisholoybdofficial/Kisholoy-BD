/**
 * Centralised error handling + structured logging.
 *
 * Problem it fixes: every one of the platform's ~289 route handlers used the
 * shape `res.status(500).json({ error: e.message })`. Driver failures, Mongo
 * topology strings, file paths and occasionally connection strings therefore
 * reached the browser, while nothing was recorded server-side.
 *
 * Rule: the client gets a stable code, a human message (English + Bengali) and
 * a correlation id. The correlation id is the *only* way to find the detail,
 * which stays in the server log.
 *
 * @license Apache-2.0
 */

import type { ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { config } from '../config';

export class AppError extends Error {
  status: number;
  code: string;
  messageBn: string;
  details?: Record<string, unknown>;
  expose: boolean;

  constructor(
    message: string,
    opts: { status?: number; code?: string; messageBn?: string; details?: Record<string, unknown> } = {}
  ) {
    super(message);
    this.name = 'AppError';
    this.status = opts.status ?? 400;
    this.code = opts.code ?? 'BAD_REQUEST';
    this.messageBn = opts.messageBn ?? 'আপনার অনুরোধটি প্রক্রিয়া করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।';
    this.details = opts.details;
    this.expose = true;
  }
}

export const badRequest = (message: string, messageBn?: string, details?: Record<string, unknown>) =>
  new AppError(message, { status: 400, code: 'BAD_REQUEST', messageBn, details });

export const unauthorized = (message = 'Authentication required.', messageBn = 'সাইন ইন করা প্রয়োজন।') =>
  new AppError(message, { status: 401, code: 'UNAUTHENTICATED', messageBn });

export const forbidden = (message = 'You do not have permission to perform this action.', messageBn = 'এই কাজটি করার অনুমতি আপনার নেই।') =>
  new AppError(message, { status: 403, code: 'FORBIDDEN', messageBn });

export const notFound = (message = 'Resource not found.', messageBn = 'রিসোর্সটি পাওয়া যায়নি।') =>
  new AppError(message, { status: 404, code: 'NOT_FOUND', messageBn });

export const tooManyRequests = (message: string, messageBn: string) =>
  new AppError(message, { status: 429, code: 'RATE_LIMITED', messageBn });

export const serviceUnavailable = (message: string, messageBn: string) =>
  new AppError(message, { status: 503, code: 'SERVICE_UNAVAILABLE', messageBn });

// ---------------------------------------------------------------------------
// Logging — single choke point, never prints secrets.
// ---------------------------------------------------------------------------

const SECRET_KEY_RE = /(password|passwd|secret|token|authorization|cookie|apikey|api_key|dsn|credential)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 400 ? `${value.slice(0, 400)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

const loggerEnabled = !config.isTest || process.env.KISHOLOY_TEST_LOG === '1';

export const log = {
  info: (scope: string, message: string, meta?: unknown) => {
    if (loggerEnabled) console.log(`[info ] ${scope}: ${message}${meta ? ` ${JSON.stringify(redact(meta))}` : ''}`);
  },
  warn: (scope: string, message: string, meta?: unknown) => {
    if (loggerEnabled) console.warn(`[warn ] ${scope}: ${message}${meta ? ` ${JSON.stringify(redact(meta))}` : ''}`);
  },
  error: (scope: string, message: string, err?: unknown) => {
    // Errors are always logged: a swallowed server error is worse than noise.
    const detail =
      err instanceof Error
        ? `${err.name}: ${err.message}`
        : typeof err === 'string'
          ? err
          : err
            ? JSON.stringify(redact(err))
            : '';
    console.error(`[error] ${scope}: ${message}${detail ? ` | ${detail}` : ''}`);
  },
};

/**
 * Log an unexpected internal failure and answer the client with something safe.
 *
 * `expected` covers failures that are genuinely informational for the user
 * (validation, stock exhaustion) — those keep their message. Anything else is
 * reported as a generic 500 with a correlation id.
 */
export function sendInternalError(
  res: ServerResponse,
  err: unknown,
  scope = 'api',
  opts: { fallback?: string; fallbackBn?: string; status?: number } = {}
): ServerResponse {
  const correlationId = randomUUID().slice(0, 8);

  if (err instanceof AppError) {
    return respondError(res, err.status, err.code, err.message, err.messageBn, err.details);
  }

  const message = err instanceof Error ? err.message : String(err ?? 'unknown error');
  log.error(scope, `unhandled_error [${correlationId}]`, message);

  // In development the real message is genuinely useful and there is no
  // external audience; in production it never leaves the process.
  /**
   * Internal detail never goes on the wire outside a test run. `!isProduction`
   * used to be the gate, but a development server binds 0.0.0.0 and is reachable
   * from the network in preview environments, so "dev mode" is not a security
   * boundary. The reason is logged with a correlation id; the caller gets that id
   * and nothing else, and tests opt in explicitly with `KISHOLOY_TESTS=1`.
   */
  const expose = process.env.KISHOLOY_TESTS === '1' && !config.isProduction;
  const devMessage = expose ? redactInternals(message) || message : null;
  return respondError(
    res,
    opts.status ?? 500,
    'INTERNAL_ERROR',
    opts.fallback ?? (devMessage ?? 'Something went wrong on our side. Please try again.'),
    opts.fallbackBn ?? (devMessage ?? 'আমাদের সার্ভারে কিছু একটা সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'),
    expose ? { ref: correlationId } : { ref: correlationId }
  );
}

/**
 * Keys that must never reach a browser, whatever an `AppError` subclass put in
 * `details`. A stack frame is a directory listing of the deployment; `sql`,
 * `command` and `config` are worse.
 */
const NON_CLIENT_KEYS =
  /^(stack|frames?|trace|inner|cause|sql|query|command|config|env|secrets?|password|authorization|token)$/i;

const isStackShaped = (value: string): boolean => {
  if (value.includes('node_modules')) return true;
  // Line scan on purpose: the previous form (a `\s+at` pattern with two `.*`
  // runs) was polynomial on crafted input, which is a worse DoS than the
  // disclosure it prevents. Frames always start their own line.
  for (const line of value.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('at ') && trimmed.includes(':')) return true;
  }
  return false;
};

/** Drops stack frames and absolute paths from a message before it can be shown. */
const redactInternals = (value: string): string =>
  value
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('at '))
    .join('\n')
    .replace(/\/(?:home|usr|opt|var|srv|Users)\/[^\s"']+/g, '[path redacted]')
    .trim();

function respondError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  messageBn: string,
  details?: Record<string, unknown>
): ServerResponse {
  if (details) {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
      if (NON_CLIENT_KEYS.test(key)) continue;
      if (typeof value === 'string' && isStackShaped(value)) continue;
      safe[key] = value;
    }
    details = safe;
  }
  const anyRes = res as unknown as ServerResponse & { finished?: boolean; writableEnded?: boolean; headersSent?: boolean };
  if (anyRes.headersSent || anyRes.writableEnded || anyRes.finished) return res;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ success: false, error: message, errorBn: messageBn, code, ...(details || {}) }));
  return res;
}

/** Express-style error middleware for the future router split. */
export function errorMiddleware() {
  return (err: unknown, req: { method?: string; url?: string }, res: ServerResponse, _next: unknown) => {
    const scope = `api ${(req.method || 'GET')} ${(req.url || '').split('?')[0]}`;
    if ((err as { type?: string; code?: string })?.type === 'entity.too.large' ||
        (err as { code?: string })?.code === 'entity.too.large') {
      return respondError(res, 413, 'PAYLOAD_TOO_LARGE',
        'This request is too large.',
        'এই অনুরোধটি আকারে অনেক বড়।');
    }
    const type = (err as { type?: string })?.type;
    const code = (err as { code?: string })?.code;
    // body-parser/express.json surfaces a SyntaxError carrying
    // `type: 'entity.parse.failed'` (and, depending on version, `code:
    // 'ENTITY_PARSE_FAILED'` or `status: 400` with `expose: true`). Matching
    // only the code string turned every malformed POST body into a 500 — which
    // is both a wrong status and a signal to retry.
    const isParseFailure =
      code === 'ENTITY_PARSE_FAILED' ||
      type === 'entity.parse.failed' ||
      (err instanceof SyntaxError && (err as { expose?: boolean; status?: number }).expose === true);
    if (isParseFailure) {
      return respondError(res, 400, 'MALFORMED_JSON',
        'The request body is not valid JSON.',
        'রিকোয়েস্ট বডি সঠিক JSON নয়।');
    }
    return sendInternalError(res, err, scope);
  };
}

export const ok = <T>(res: ServerResponse, data: T, status = 200): ServerResponse => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ success: true, ...(data as object) }));
  return res;
};
