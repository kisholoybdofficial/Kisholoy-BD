/**
 * Serverless entry-path test.
 *
 * On Vercel the API is not `server.ts`; it is `api/index.js` →
 * `require('./server.bundle.cjs').vercelHandler`, an esbuild CJS bundle whose
 * module-level side effects (config validation, cookie policy, the refuse-to-boot
 * guard) run in an isolate instead of a dev terminal. A missing `build` step in
 * `vercel.json` is exactly how "checkout fails only in production" happens, so
 * this file boots the *artifact* — not the source — over a real HTTP server.
 *
 * Skips cleanly when the bundle has not been built (`npm run build` first).
 *
 * Run: npm test
 *
 * @license Apache-2.0
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const bundlePath = path.join(here, '..', 'api', 'server.bundle.cjs');
const built = existsSync(bundlePath);

// Must be set before the bundle is required: its config module validates the
// environment at import time, and production is the mode being proven here.
const dataDir = built ? mkdtempSync(path.join(os.tmpdir(), 'kisholoy-serverless-')) : '';
process.env.NODE_ENV = 'production';
process.env.APP_URL = 'https://kisholoy.example';
process.env.KISHOLOY_PERSISTENCE_DRIVER = 'file';
process.env.KISHOLOY_DATA_DIR = dataDir;
// A preview isolate has no Mongo; the durable guard is asserted separately.
process.env.KISHOLOY_REQUIRE_PERSISTENCE = 'false';
process.env.KISHOLOY_SESSION_SECRET = 'serverless-smoke-secret-0123456789abcdef0123456789abcdef';
process.env.KISHOLOY_ADMIN_EMAIL = 'bundle-owner@kisholoy.test';
process.env.KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD = 'Bundle-Bootstrap-Pass-2026';
process.env.KISHOLOY_AUTO_SEED = 'false';

let server: http.Server | null = null;
let base = '';

async function boot(): Promise<string> {
  if (base) return base;
  const mod = require(bundlePath) as { vercelHandler?: (req: any, res: any) => void; default?: unknown };
  const handler = mod.vercelHandler;
  assert.equal(typeof handler, 'function', 'the bundle must export vercelHandler for api/index.js to call');
  server = http.createServer((req, res) => (handler as (req: any, res: any) => void)(req, res));
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  return base;
}

after(() => {
  server?.close();
});

test('the built serverless bundle is a clean production artifact', { skip: !built && 'run `npm run build` first' }, () => {
  const source = readFileSync(bundlePath, 'utf8');

  // `server.ts` reaches Vite through a split string literal so esbuild cannot
  // statically resolve it. If that ever leaks into the bundle, the serverless
  // function dies at cold start with "Cannot find module 'vite'".
  assert.equal(/require\(\s*['"]vite['"]\s*\)/.test(source), false, 'vite must not be bundled into the serverless function');
  assert.equal(/from ['"]vite['"]/.test(source), false);
  // Nothing in the artifact may carry a credential or a dev fallback secret.
  for (const banned of [
    'KisholoySuperAdmin@',
    'Kisholoy@2026!',
    'kisholoy_root_superadmin_session_token',
    'ksh-token-super-admin-root-session',
    'kisholoy_bd_salt_99812',
    'kisholoybd.official@gmail.com',
  ]) {
    assert.equal(source.includes(banned), false, `the deployed bundle contains "${banned}"`);
  }
  assert.ok(source.length > 100_000, 'the bundle looks truncated');
});

test('the handler answers /api/health with production persistence + bootstrap state', { skip: !built && 'run `npm run build` first' }, async () => {
  const origin = await boot();
  const res = await fetch(`${origin}/api/health`);
  assert.equal(res.status, 200);
  const body = await res.json();

  assert.equal(body.status, 'ok');
  assert.equal(body.environment, 'production', 'the bundle must see the real NODE_ENV, not development');
  assert.equal(body.persistence?.mode, 'file');
  assert.equal(body.persistence?.durable, true);
  assert.equal(body.bootstrap?.adminReady, true, 'KISHOLOY_ADMIN_* bootstrapped an administrator inside the isolate');
  assert.equal(body.payments?.demoModeAllowed, false, 'a production bundle must not allow simulated payments');
  assert.ok(!JSON.stringify(body).includes('SESSION_SECRET'), 'health must not echo configuration');
});

test('an anonymous caller of the privileged surface gets a fail-closed Bengali 401', { skip: !built && 'run `npm run build` first' }, async () => {
  const origin = await boot();
  for (const route of ['/api/orders', '/api/customers', '/api/security/audit', '/api/finance/admin/summary']) {
    const res = await fetch(`${origin}${route}`);
    assert.ok(res.status === 401 || res.status === 403, `${route} → ${res.status}`);
    if (res.status === 401) {
      const body = await res.json();
      assert.ok(/লগইন|প্রয়োজন|অনুমতি/.test(String(body.errorBn || '')), `${route} must answer in Bengali too`);
      assert.equal(/at .*:\d+:\d+/.test(JSON.stringify(body)), false, 'no stack trace in a production response');
    }
  }
});

test('the API function serves only /api/* — the SPA and static files are the CDN job', { skip: !built && 'run `npm run build` first' }, async () => {
  const origin = await boot();
  const root = await fetch(`${origin}/`);
  assert.ok(root.status === 404 || (await root.text()).includes('Cannot GET'), 'apiOnly must not pretend to host the SPA');
});

test('staff login in production mode issues HttpOnly+Secure cookies and a readable CSRF partner', { skip: !built && 'run `npm run build` first' }, async () => {
  const origin = await boot();
  const res = await fetch(`${origin}/api/security/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'bundle-owner@kisholoy.test', password: 'Bundle-Bootstrap-Pass-2026' }),
  });
  // Read the body once; `res.json()` cannot follow a consumed `res.text()`.
  const raw = await res.text();
  assert.equal(res.status, 200, raw);
  const payload = raw ? JSON.parse(raw) : {};
  const cookies = res.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith('ksh_admin=')) || '';
  const csrf = cookies.find((c) => c.startsWith('ksh_csrf=')) || '';

  assert.match(session, /HttpOnly/);
  assert.match(session, /Secure/, 'NODE_ENV=production must force Secure');
  assert.match(session, /SameSite=Lax/);
  assert.ok(csrf.length > 0, 'a CSRF partner cookie must be issued');
  assert.equal(/HttpOnly/.test(csrf), false, 'the CSRF partner must stay JS-readable by design');
  assert.ok(!JSON.stringify(payload).includes('passwordHash'), 'login response must not carry credential material');
  assert.equal(payload.mustChangePassword, true, 'the bootstrapped account is forced to rotate its password');
});
