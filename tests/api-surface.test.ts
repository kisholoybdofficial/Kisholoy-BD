/**
 * Live API-surface tests.
 *
 * These boot the real Express app (`createApp`) in-process on an ephemeral port
 * and drive it over HTTP, because the bugs this branch fixed were not unit-level:
 * an order that was never created, a client-supplied price that was trusted, a
 * `persona-session` route that minted a SUPER_ADMIN without a password, an admin
 * panel that decided "am I logged in?" from localStorage. Only a running stack
 * proves those are gone.
 *
 * Isolation: memory persistence in a temp dir, a fresh idempotency key per run,
 * no network egress (gateways are unconfigured, which is itself asserted).
 *
 * Run: npm test
 *
 * @license Apache-2.0
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.KISHOLOY_TESTS = '1';
process.env.KISHOLOY_PERSISTENCE_DRIVER = 'file'; // temp dir below: durable within the run, so the
// seeder behaves exactly as it does on a real first boot
process.env.KISHOLOY_DATA_DIR = mkdtempSync(path.join(os.tmpdir(), 'kisholoy-api-test-'));
process.env.KISHOLOY_SESSION_SECRET = 'api-surface-test-secret-0123456789abcdef0123456789abcdef';
process.env.KISHOLOY_AUTO_SEED = 'true';
process.env.KISHOLOY_ALLOW_DEMO_DATA = 'false';
process.env.KISHOLOY_ALLOW_DEMO_PAYMENTS = 'false';
process.env.KISHOLOY_REQUIRE_PERSISTENCE = 'false';
process.env.KISHOLOY_ADMIN_EMAIL = 'bootstrap-owner@kisholoy.test';
process.env.KISHOLOY_ADMIN_NAME = 'Bootstrap Owner';
process.env.KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD = 'Bootstrap-Password-2026';
process.env.KISHOLOY_ADMIN_REQUIRE_PASSWORD_CHANGE = 'true';

const { createApp } = await import('../server.ts');

const app = await createApp({ apiOnly: true });
const server = http.createServer(app as never);
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

after(() => {
  server.close();
});

interface Call {
  status: number;
  body: any;
  setCookie: string[];
  headers: Headers;
}

const jar = { cookies: new Map<string, string>() };

const cookieHeader = (): string =>
  Array.from(jar.cookies.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

async function call(
  method: string,
  route: string,
  options: { body?: unknown; raw?: string; cookieOverride?: string | null; csrf?: string | null } = {}
): Promise<Call> {
  const headers: Record<string, string> = {};
  const cookie = options.cookieOverride === undefined ? cookieHeader() : options.cookieOverride;
  if (cookie) headers.cookie = cookie;
  if (options.csrf !== null) {
    const csrf = jar.cookies.get('ksh_csrf');
    if (csrf) headers['x-csrf-token'] = csrf;
  }
  if (options.csrf) headers['x-csrf-token'] = options.csrf;

  let payload: string | undefined;
  if (options.raw !== undefined) {
    payload = options.raw;
    headers['content-type'] = 'application/json';
  } else if (options.body !== undefined) {
    payload = JSON.stringify(options.body);
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(`${base}${route}`, { method, headers, body: payload });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  const setCookie = typeof (res.headers as any).getSetCookie === 'function' ? (res.headers as any).getSetCookie() : [];
  for (const raw of setCookie) {
    const [pair] = String(raw).split(';');
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(String(raw))) jar.cookies.delete(name);
    else jar.cookies.set(name, value);
  }

  return { status: res.status, body, setCookie: setCookie.map(String), headers: res.headers };
}

const unique = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ── 1. Boot & transport ─────────────────────────────────────────────────────

test('the API boots, reports its persistence mode and never leaks a stack', async () => {
  const health = await call('GET', '/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok', JSON.stringify(health.body));
  assert.equal(health.body.persistence?.mode, 'file', 'the test run must exercise the real driver');
  assert.equal(health.body.persistence?.durable, true);
  assert.equal(health.body.bootstrap?.adminReady, true, 'bootstrap must have created the administrator');
  assert.equal(health.body.payments?.demoModeAllowed, false, 'no fake payment mode in a test/production boot');

  const broken = await call('POST', '/api/orders/create', { raw: 'this is not json' });
  assert.equal(broken.status, 400, `malformed JSON must be 400, got ${broken.status}`);
  const dump = JSON.stringify(broken.body);
  assert.ok(!/at .*:\d+:\d+/.test(dump), 'no stack frames in a client error');
  assert.ok(!/\/(home|Users|workspace|var\/folders)\//.test(dump), 'no filesystem paths');
  assert.ok(!/process\.env|KISHOLOY_SESSION_SECRET|MongoClient/.test(dump), 'no env or driver internals');
});

test('security headers are on without breaking the app', async () => {
  const res = await call('GET', '/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.match(String(res.headers.get('content-security-policy')), /default-src 'self'/);
  assert.equal(
    res.headers.get('cross-origin-embedder-policy'),
    null,
    'COEP stays off: it would break every cross-origin image and the gateway iframe'
  );
  assert.equal(res.headers.get('server'), null, 'x-powered-by / server banner disabled');
});

// ── 2. The anonymous attack surface ─────────────────────────────────────────

test('every privileged read is refused to anonymous callers, in Bengali', async () => {
  const routes = [
    '/api/orders',
    '/api/customers',
    '/api/suppliers',
    '/api/finance/admin/summary',
    '/api/payments',
    '/api/security/audit',
    '/api/security/users',
    '/api/inventory/low-stock',
    '/api/notifications',
    '/api/integrations/status',
    '/api/reports',
  ];
  for (const route of routes) {
    const res = await call('GET', route, { cookieOverride: null });
    assert.ok(
      res.status === 401 || res.status === 403,
      `${route} answered ${res.status} to an anonymous caller — expected 401/403`
    );
    if (res.status === 401) {
      assert.ok(
        /লগইন|প্রয়োজন|অনুমতি/.test(String(res.body?.errorBn || '')),
        `${route} must explain the denial in Bengali: ${JSON.stringify(res.body)}`
      );
    }
  }
});

test('the removed backdoors stay removed', async () => {
  const probes: Array<[string, string, unknown?]> = [
    ['POST', '/api/security/auth/persona-session', { role: 'SUPER_ADMIN' }],
    ['POST', '/api/security/auth/ensure-super-admin', {}],
    ['POST', '/api/payments/test-ipn', { orderNumber: 'KSH-1', status: 'PAID' }],
    ['POST', '/api/seed', {}],
    ['POST', '/api/seed-demo', {}],
    ['GET', '/api/debug', undefined],
    ['GET', '/api/security/auth/persona-session', undefined],
  ];
  for (const [method, route, body] of probes) {
    const res = await call(method, route, { body, cookieOverride: null });
    assert.ok(
      res.status === 401 || res.status === 403 || res.status === 404,
      `${method} ${route} is reachable (${res.status}) — a debug/seed/mint route must not exist in production`
    );
  }

  // The gateway validation route legitimately exists (the app itself calls it),
  // but a made-up reference must never confirm a payment.
  const forgedValidate = await call('POST', '/api/payments/sslcommerz/validate', {
    body: { orderNumber: 'KSH-0001', valdn_id: 'fake', currency: 'BDT', amount: 1 },
    cookieOverride: null,
  });
  assert.notEqual(forgedValidate.body?.success, true, 'a forged validation reference cannot confirm payment');
  assert.ok(
    forgedValidate.status >= 400 || forgedValidate.body?.verified === false,
    JSON.stringify(forgedValidate.body)
  );
});

test('the old static root token authenticates nothing', async () => {
  const res = await fetch(`${base}/api/security/users`, {
    headers: { authorization: 'Bearer kisholoy_root_superadmin_session_token_2026' },
  });
  assert.equal(res.status, 401, 'a guessable constant must never map to SUPER_ADMIN');
});

test('the public catalogue is readable but economically silent', async () => {
  const res = await call('GET', '/api/products', { cookieOverride: null });
  assert.equal(res.status, 200);
  const items: any[] = res.body.products || res.body.data || res.body;
  assert.ok(Array.isArray(items) && items.length >= 20, `expected the seeded catalogue, got ${items?.length}`);

  const serialized = JSON.stringify(items[0]);
  for (const forbidden of ['costPrice', 'marginPercent', 'economics', 'passwordHash', 'totpSecret']) {
    assert.ok(!serialized.includes(`"${forbidden}"`), `public product view must not carry ${forbidden}`);
  }
  assert.ok(items.every((p) => !p.status || p.status === 'ACTIVE'), 'draft/archived products are not public');
});

// ── 3. Staff authentication ─────────────────────────────────────────────────

const OWNER_PASSWORD = 'Bootstrap-Password-2026';
const OWNER_NEW_PASSWORD = 'Rotated-Owner-Passphrase-77';

test('staff login sets an HttpOnly session cookie plus a readable CSRF partner', async () => {
  const bad = await call('POST', '/api/security/auth/login', {
    body: { email: 'bootstrap-owner@kisholoy.test', password: 'wrong-password-123' },
    cookieOverride: null,
  });
  assert.equal(bad.status, 401, 'a wrong password is a 401, not a 200-with-flag');
  assert.ok(!/stack|at Object|errno/.test(JSON.stringify(bad.body)));

  const shape = await call('POST', '/api/security/auth/login', {
    body: { email: 'bootstrap-owner@kisholoy.test' },
    cookieOverride: null,
  });
  assert.equal(shape.status, 422, 'a missing password is a validation error, never a crash');

  const res = await call('POST', '/api/security/auth/login', {
    body: { email: 'bootstrap-owner@kisholoy.test', password: OWNER_PASSWORD },
    cookieOverride: null,
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const session = res.setCookie.find((c) => c.startsWith('ksh_admin=')) || '';
  const csrf = res.setCookie.find((c) => c.startsWith('ksh_csrf=')) || '';
  assert.match(session, /HttpOnly/, 'the session cookie must be unreadable to JavaScript');
  assert.match(session, /SameSite=Lax/);
  assert.ok(/ksh_csrf=[^;]+/.test(csrf) && !/HttpOnly/i.test(csrf), 'the CSRF partner must be JS-readable');
  assert.ok(!JSON.stringify(res.body).includes('passwordHash'), 'no credential material in the payload');
  assert.equal(res.body.user.email, 'bootstrap-owner@kisholoy.test');
  assert.equal(res.body.role, 'SUPER_ADMIN');
});

test('the bootstrap account must rotate its password before it is usable', async () => {
  // Even "is an administrator set up yet?" is staff-scoped: for an anonymous
  // caller it is a 401 rather than a free oracle about the deployment.
  const anonymousState = await call('GET', '/api/security/auth/bootstrap-state', { cookieOverride: null });
  assert.ok(anonymousState.status === 401 || anonymousState.status === 403, `got ${anonymousState.status}`);

  const login = await call('POST', '/api/security/auth/login', {
    body: { email: 'bootstrap-owner@kisholoy.test', password: OWNER_PASSWORD },
    cookieOverride: null,
  });
  assert.equal(login.body.mustChangePassword, true, 'first login is forced to change the password');

  const state = await call('GET', '/api/security/auth/bootstrap-state');
  assert.equal(state.status, 200, JSON.stringify(state.body));
  assert.equal(state.body.adminReady, true);
  assert.ok(
    !JSON.stringify(state.body).toLowerCase().includes('hash'),
    `bootstrap-state must not echo credential material: ${JSON.stringify(state.body)}`
  );

  // No CSRF partner header on a cookie-authenticated write: refused first.
  const noCsrf = await call('POST', '/api/security/auth/change-password', {
    body: { currentPassword: OWNER_PASSWORD, newPassword: OWNER_NEW_PASSWORD },
    csrf: null,
  });
  assert.equal(noCsrf.status, 403, 'a cookie-authenticated mutation must echo the CSRF partner');
  assert.equal(noCsrf.body.code, 'CSRF_TOKEN_INVALID', JSON.stringify(noCsrf.body));

  const weak = await call('POST', '/api/security/auth/change-password', {
    body: { currentPassword: OWNER_PASSWORD, newPassword: 'short1' },
  });
  assert.equal(weak.status, 422, 'the same policy guards the change as guards the bootstrap');

  const changed = await call('POST', '/api/security/auth/change-password', {
    body: { currentPassword: OWNER_PASSWORD, newPassword: OWNER_NEW_PASSWORD },
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));

  const after = await call('POST', '/api/security/auth/login', {
    body: { email: 'bootstrap-owner@kisholoy.test', password: OWNER_NEW_PASSWORD },
    cookieOverride: null,
  });
  assert.equal(after.status, 200);
  assert.equal(after.body.mustChangePassword, false);

  const retired = await call('POST', '/api/security/auth/login', {
    body: { email: 'bootstrap-owner@kisholoy.test', password: OWNER_PASSWORD },
    cookieOverride: null,
  });
  assert.equal(retired.status, 401, 'the bootstrap password stops working after the rotation');
});

test('mutations without the CSRF partner are refused, with it they work', async () => {
  await call('POST', '/api/security/auth/login', {
    body: { email: 'bootstrap-owner@kisholoy.test', password: OWNER_NEW_PASSWORD },
    cookieOverride: null,
  });

  const listing = await call('GET', '/api/products?limit=1&status=ACTIVE');
  assert.equal(listing.status, 200);
  const product = (listing.body.products || listing.body.data || listing.body)[0];
  assert.ok(product?.id, 'need a product to exercise an admin write');

  const noCsrf = await call('PUT', `/api/products/${product.id}`, { body: { stock: 44 }, csrf: null });
  assert.equal(noCsrf.status, 403, 'a cookie-authenticated write must carry the partner header');

  const withCsrf = await call('PUT', `/api/products/${product.id}`, { body: { stock: 44 } });
  assert.equal(withCsrf.status, 200, JSON.stringify(withCsrf.body));
  assert.equal(withCsrf.body.product?.stock ?? withCsrf.body.data?.stock, 44);

  const directory = await call('GET', '/api/security/users');
  assert.equal(directory.status, 200);
  assert.ok(!/passwordHash|totpSecret|\.hash/.test(JSON.stringify(directory.body)));
});

// ── 4. Customer authentication ──────────────────────────────────────────────

/** The API resolves one identity per request (staff first); so does the jar. */
const resetJar = (): void => {
  jar.cookies.clear();
};

test('a customer can register, and the session cookie is enough to be recognised', async () => {
  resetJar();
  const email = `buyer-${unique()}@kisholoy.test`;
  const phone = `017${Math.floor(10000000 + Math.random() * 89999999)}`;
  const password = 'Kisholoy-Buyer-2026';

  const weak = await call('POST', '/api/customer/auth/register', {
    body: { name: 'Weak Pass', phone, email, password: '12345' },
    cookieOverride: null,
  });
  assert.equal(weak.status, 422, 'a 5-character password is rejected at the API, not only in the form');

  const noPassword = await call('POST', '/api/customer/auth/login', {
    body: { identifier: email },
    cookieOverride: null,
  });
  assert.equal(noPassword.status, 422);

  const first = await call('POST', '/api/customer/auth/register', {
    body: { name: 'First Buyer', phone, email, password },
    cookieOverride: null,
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));

  const again = await call('POST', '/api/customer/auth/register', {
    body: { name: 'Second Buyer', phone, email, password },
    cookieOverride: null,
  });
  assert.equal(again.status, 409, 'a duplicate email/phone is a conflict, not a second account');
  assert.match(String(again.body.errorBn || again.body.error || ''), /।|already|বিদ্যমান|নথিভুক্ত/i);

  const whoami = await call('GET', '/api/customer/auth/me');
  assert.equal(whoami.status, 200, 'the cookie set by register authenticates /me');
  assert.equal(whoami.body.customer?.email || whoami.body.email, email);

  const wrong = await call('POST', '/api/customer/auth/login', {
    body: { identifier: email, password: 'Not-The-Password-1' },
    cookieOverride: null,
  });
  assert.equal(wrong.status, 401, 'the customer path verifies the password (it used to verify nothing)');

  const right = await call('POST', '/api/customer/auth/login', {
    body: { identifier: email, password },
    cookieOverride: null,
  });
  assert.equal(right.status, 200);
  assert.ok(!JSON.stringify(right.body).includes('"hash"'), 'no hash material in a login response');
});

// ── 5. Order engine ─────────────────────────────────────────────────────────

test('an order is priced by the server, idempotent, and decrements stock exactly', async () => {
  const listing = await call('GET', '/api/products?limit=60&status=ACTIVE', { cookieOverride: null });
  const products = (listing.body.products || listing.body.data || listing.body) as any[];
  const product = products.find((p) => (p.stock ?? 0) >= 6);
  assert.ok(product, 'the seeded catalogue must contain a product with stock to order');

  const stockBefore = product.stock;
  const price = product.price;
  const body = {
    customer: { name: 'Verify Buyer', phone: '01712345678' },
    shippingAddress: { address: 'House 1, Road 2, Banani', district: 'Dhaka', division: 'Dhaka' },
    items: [{ productId: product.id, quantity: 2 }],
    paymentMethod: 'COD',
    idempotencyKey: `test-${unique()}`,
  };

  const created = await call('POST', '/api/orders/create', { body, cookieOverride: null });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const order = created.body.order;
  assert.equal(order.subtotal, price * 2, 'subtotal is server-priced');
  assert.equal(order.total, order.subtotal + (order.shippingFee || 0), 'total is subtotal + server delivery fee');
  assert.equal(order.paymentStatus, 'UNPAID', 'Cash on Delivery is never "paid"');
  assert.equal(
    created.body.paymentVerification?.state,
    'AWAITING_GATEWAY_CONFIRMATION',
    'payment truth is deferred to a verified gateway signal'
  );
  assert.match(String(created.body.paymentVerification?.message || ''), /webhook|gateway/i);
  assert.match(String(order.orderNumber || ''), /KSH|\d/, 'orders get a real order number');

  const replay = await call('POST', '/api/orders/create', { body, cookieOverride: null });
  assert.equal(replay.status, 200, 'the same idempotency key replays instead of double-ordering');
  assert.equal(replay.body.duplicate, true);
  assert.equal(replay.body.order?.id || replay.body.orderId, order.id, 'replay returns the first order');

  const after = await call('GET', `/api/products/${product.id || product.slug}`, { cookieOverride: null });
  const stockAfter = after.body.product?.stock ?? after.body.stock;
  assert.equal(stockAfter, stockBefore - 2, 'stock moves by exactly the quantity ordered');

  const track = await call('GET', `/api/orders/track?orderNumber=${order.orderNumber}&phone=01712345678`, {
    cookieOverride: null,
  });
  assert.equal(track.status, 200, 'the buyer can track with order number + their phone');
  const wrongPhone = await call('GET', `/api/orders/track?orderNumber=${order.orderNumber}&phone=01799999999`, {
    cookieOverride: null,
  });
  assert.equal(wrongPhone.status, 404, 'tracking must not leak an order to any phone number');
});

test('client-side money is ignored, and impossible carts are refused', async () => {
  const listing = await call('GET', '/api/products?limit=60&status=ACTIVE', { cookieOverride: null });
  const products = (listing.body.products || listing.body.data || listing.body) as any[];
  const product = products.find((p) => (p.stock ?? 0) >= 6) || products[0];

  // (a) A tampered *unit price* inside a line is accepted-but-ignored: the
  // field is optional so older clients keep working, and the server re-prices
  // from the catalogue.
  const cheap = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Tamper Two', phone: '01712345679' },
      shippingAddress: { address: 'House 9, Road 9, Uttara', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: 1, price: 1 }],
      paymentMethod: 'SSLCOMMERZ',
      idempotencyKey: `tamper-${unique()}`,
    },
  });
  assert.equal(cheap.status, 201, JSON.stringify(cheap.body));
  assert.equal(cheap.body.order.subtotal, product.price, 'the client-claimed ৳1 is ignored; the catalogue price wins');
  assert.notEqual(cheap.body.order.paymentStatus, 'PAID', 'a claimed gateway payment stays pending');

  // (b) Invented *top-level* money fields are refused by the schema outright.
  const forged = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Forged Total', phone: '01712345695' },
      shippingAddress: { address: 'House 5, Road 5, Bashundhara', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: 1 }],
      total: 1,
      subtotal: 1,
      discount: 9999,
      idempotencyKey: `forged-${unique()}`,
    },
  });
  assert.equal(forged.status, 422, 'unknown money fields in an order body are refused, not trusted');
  assert.match(String(forged.body?.errorBn || ''), /।/, 'the refusal is bilingual and human');

  const negative = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Neg One', phone: '01712345680' },
      shippingAddress: { address: 'x y z road', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: -3 }],
    },
  });
  assert.equal(negative.status, 422, 'negative quantity is a validation error');

  const oversell = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Over One', phone: '01712345681' },
      shippingAddress: { address: 'x y z road', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: Math.max(2, (product.stock ?? 1) + 500) }],
    },
  });
  assert.ok(oversell.status === 409 || oversell.status === 422, `oversell must not create an order (got ${oversell.status})`);

  const ghost = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Ghost Cart', phone: '01712345682' },
      shippingAddress: { address: 'some street here', district: 'Dhaka' },
      items: [
        { productId: product.id, quantity: 1 },
        { productId: 'ghost-product-does-not-exist', quantity: 1 },
      ],
    },
  });
  assert.ok(ghost.status === 409 || ghost.status === 422, `unknown product must be a clean refusal (got ${ghost.status})`);
  assert.ok(ghost.status < 500, 'a missing product is never a 500');

  const badPhone = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Bad Phone', phone: '12345' },
      shippingAddress: { address: '12 Some Road', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: 1 }],
    },
  });
  assert.equal(badPhone.status, 422, 'BD mobile format is enforced server-side');

  const markup = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: '<script>alert(1)</script>', phone: '01712345684' },
      shippingAddress: { address: '<img src=x onerror=alert(1)> House 3', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: 1 }],
      idempotencyKey: `markup-${unique()}`,
    },
  });
  assert.equal(markup.status, 201, 'markup in free text is inert data, not a rejected order');
  const stored = JSON.stringify(markup.body.order);
  assert.ok(!stored.includes('<script'), 'angle brackets are stripped before storage');
});

test('coupons are validated by the server, not trusted from the client', async () => {
  const listing = await call('GET', '/api/products?limit=60&status=ACTIVE', { cookieOverride: null });
  const products = (listing.body.products || listing.body.data || listing.body) as any[];
  const product = products[0];

  const bogus = await call('POST', '/api/promotions/validate', {
    cookieOverride: null,
    body: {
      couponCode: 'NOT-A-REAL-CODE',
      items: [{ productId: product.id, quantity: 1, price: product.price }],
      subtotal: product.price,
    },
  });
  assert.equal(bogus.status, 200, 'validation answers a verdict, not an error');
  assert.equal(bogus.body.evaluation?.valid, false, 'an unknown code never discounts anything');

  // A `discount` number is not even an accepted field.
  const forgedDiscount = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Discount Forge', phone: '01712345688' },
      shippingAddress: { address: 'House 4, Road 1, Mirpur', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: 1 }],
      discount: 5000,
      idempotencyKey: `coupon-${unique()}`,
    },
  });
  assert.equal(forgedDiscount.status, 422, 'a client-supplied discount amount is refused outright');

  // A code the store never issued cannot discount anything.
  const bogusCode = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Coupon Forge', phone: '01712345689' },
      shippingAddress: { address: 'House 4, Road 1, Mirpur', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: 1 }],
      couponCode: 'HALFOFF',
      idempotencyKey: `coupon2-${unique()}`,
    },
  });
  assert.ok(
    bogusCode.status === 409 ||
      bogusCode.status === 422 ||
      (bogusCode.status === 201 && (bogusCode.body.order.discount || 0) === 0),
    `an unknown coupon must not discount the order (got ${bogusCode.status}: ${JSON.stringify(bogusCode.body).slice(0, 200)})`
  );
});

test('payments report their real capability instead of faking success', async () => {
  // Public on purpose: a guest at checkout has to know which rails exist before
  // the UI offers a button that cannot take money.
  const caps = await call('GET', '/api/payments/capabilities', { cookieOverride: null });
  assert.equal(caps.status, 200, `capabilities must be readable (got ${caps.status})`);
  const body = JSON.stringify(caps.body).toLowerCase();
  assert.equal(caps.body.success, true);
  assert.equal(caps.body.capabilities?.sslcommerz, 'UNCONFIGURED', 'this environment holds no gateway credentials');
  assert.equal(caps.body.capabilities?.demoPaymentsAllowed, false, 'demo payments must never be advertised as available');
  assert.ok(/send money|trxid/i.test(JSON.stringify(caps.body.manualPayment)), 'manual claims must state the verification step');
  assert.ok(!/store_password|app_secret|apikey|private_key/.test(body), 'gateway credentials are never returned');
});

test('an anonymous user cannot read or mutate somebody else’s order', async () => {
  const listing = await call('GET', '/api/products?limit=60&status=ACTIVE', { cookieOverride: null });
  const product = (listing.body.products || listing.body.data || listing.body)[0];
  const created = await call('POST', '/api/orders/create', {
    cookieOverride: null,
    body: {
      customer: { name: 'Private Buyer', phone: '01712345690' },
      shippingAddress: { address: 'House 7, Road 3, Dhanmondi', district: 'Dhaka' },
      items: [{ productId: product.id, quantity: 1 }],
      idempotencyKey: `idor-${unique()}`,
    },
  });
  assert.equal(created.status, 201);
  const id = created.body.order?.id;
  const number = created.body.order?.orderNumber;

  const list = await call('GET', '/api/orders', { cookieOverride: null });
  assert.ok(list.status === 401 || list.status === 403, 'the order list is not an anonymous endpoint');

  const byId = await call('GET', `/api/orders/${id}`, { cookieOverride: null });
  assert.ok(byId.status === 401 || byId.status === 403 || byId.status === 404, `order detail leaked (${byId.status})`);

  const cancel = await call('PUT', `/api/orders/${id}/status`, {
    body: { orderStatus: 'DELIVERED' },
    cookieOverride: null,
  });
  assert.ok(cancel.status === 401 || cancel.status === 403 || cancel.status === 404, 'anonymous status change refused');

  const tracked = await call('GET', `/api/orders/track?orderNumber=${number}&phone=01712345690`, { cookieOverride: null });
  assert.equal(tracked.status, 200, 'the owner who knows number + phone can still see it');
});
