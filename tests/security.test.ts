/**
 * Security-primitive tests: password hashing, signed sessions, CSRF pairing,
 * cookie attributes and TOTP. These are the pieces an authentication bypass
 * would hide in, so they are asserted directly rather than only through HTTP.
 *
 * Context: this branch replaced a hardcoded super-admin password, a static
 * root bearer token accepted for every staff route, a "verify any 6 digits"
 * step-up check and a customer login that never checked a password at all.
 *
 * Run: npm test
 *
 * @license Apache-2.0
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.KISHOLOY_TESTS = '1';
// Deterministic, long enough for the production minimum, never reused outside tests.
process.env.KISHOLOY_SESSION_SECRET = process.env.KISHOLOY_SESSION_SECRET || 'unit-test-secret-0123456789abcdef0123456789abcdef';

const {
  hashPassword,
  verifyPassword,
  hashIsLegacy,
  makePasswordRecord,
  passwordPolicyError,
  generateTemporaryPassword,
  PASSWORD_MIN_LENGTH,
  legacyPbkdf2,
} = await import('../server/security/passwords');

const { mintSessionToken, verifySessionPayload, revocations, safeCompare } = await import(
  '../server/sessionTokens'
);
const { generateTotpSecret, verifyTotp, totpUri, base32Decode } = await import('../server/security/totp');
const { parseCookies, serializeCookie, csrfHeaderMatches, isUnsafeMethod, ADMIN_COOKIE, CSRF_COOKIE, CSRF_HEADER } =
  await import('../server/http/cookies');

// ── Password hashing ────────────────────────────────────────────────────────

test('passwords are stored as salted scrypt, never plaintext', () => {
  const stored = hashPassword('Correct-Horse-Battery-97');
  const [scheme, cost, salt, key] = stored.split('$');

  assert.equal(scheme, 'scrypt', 'the shipped algorithm must be scrypt');
  assert.ok(Number(cost) >= 16384, `cost factor too low: ${cost}`);
  assert.equal(salt.length, 32, '16-byte random salt, hex encoded');
  assert.ok(key.length >= 64);
  assert.ok(!stored.includes('Correct-Horse-Battery-97'), 'the plaintext must never appear in the record');
  assert.notEqual(hashPassword('a'), hashPassword('a'), 'per-password salt');
});

test('verification accepts the right secret and rejects everything else', () => {
  const stored = hashPassword('Correct-Horse-Battery-97');

  assert.deepEqual(verifyPassword('Correct-Horse-Battery-97', stored), { ok: true, needsUpgrade: false });
  assert.equal(verifyPassword('correct-horse-battery-97', stored).ok, false, 'case matters');
  assert.equal(verifyPassword('Correct-Horse-Battery-98', stored).ok, false);
  assert.equal(verifyPassword('', stored).ok, false);
  assert.equal(verifyPassword('whatever', null).ok, false, 'missing hash is a denial, not a crash');
  assert.equal(verifyPassword('whatever', 'bcrypt$2b$10$notourscheme').ok, false, 'foreign formats are refused');
});

test('legacy pbkdf2 records still log in and are flagged for upgrade', () => {
  const plain = 'Legacy-Password-2026';
  const saltHex = crypto.randomBytes(16).toString('hex');
  const legacy = `pbkdf2$100000$${saltHex}$${legacyPbkdf2(plain, saltHex)}`;

  const result = verifyPassword(plain, legacy);
  assert.equal(result.ok, true, 'existing users must not be locked out by the migration');
  assert.equal(result.needsUpgrade, true, 'a successful legacy login triggers a re-hash');
  assert.equal(hashIsLegacy(legacy), true);
  assert.equal(hashIsLegacy(hashPassword(plain)), false);
});

test('policy rejects the passwords that actually get guessed', () => {
  assert.match(String(passwordPolicyError(undefined)), /required/i);
  assert.match(String(passwordPolicyError('short9')), /at least 10/i);
  assert.match(String(passwordPolicyError('abcdefghijk')), /letters and numbers/i);
  assert.match(String(passwordPolicyError('1111111111')), /letters and numbers/i, 'all-digits is refused even though it passes a naive repeat check');
  assert.match(String(passwordPolicyError('Password123')), /too common/i);
  assert.equal(passwordPolicyError('qwertyuiop123'), null, 'policy is length-first, not complexity theatre');
  assert.equal(passwordPolicyError('A-decent-long-passphrase-42'), null);
  assert.match(String(passwordPolicyError('x'.repeat(500) + '1')), /shorter/i);
});

test('the policy boundary is exactly PASSWORD_MIN_LENGTH characters', () => {
  assert.equal(PASSWORD_MIN_LENGTH, 10);
  const tooShort = 'a'.repeat(PASSWORD_MIN_LENGTH - 2) + '1'; // 9 chars
  assert.equal(tooShort.length, PASSWORD_MIN_LENGTH - 1);
  assert.match(String(passwordPolicyError(tooShort)), /at least 10/);
  // 10 characters with a letter and a digit is the weakest accepted value.
  const justEnough = 'a'.repeat(PASSWORD_MIN_LENGTH - 1) + '2';
  assert.equal(justEnough.length, PASSWORD_MIN_LENGTH);
  assert.equal(passwordPolicyError(justEnough), null);
});

test('password records carry the forced-change flag', () => {
  const record = makePasswordRecord('Bootstrap-Password-2026', { mustChange: true });
  assert.equal(record.mustChange, true);
  assert.ok(record.hash.startsWith('scrypt$'));
  assert.equal(makePasswordRecord('Bootstrap-Password-2026').mustChange, false);
});

test('generated temporary passwords avoid ambiguous glyphs and satisfy policy', () => {
  for (let i = 0; i < 50; i += 1) {
    const value = generateTemporaryPassword(16);
    assert.equal(value.length, 16);
    assert.equal(/[O0Il1]/.test(value), false, 'no characters that need read out over the phone');
    assert.equal(passwordPolicyError(value), null, 'every generated value must be usable as-is');
  }
});

// ── Signed session tokens ───────────────────────────────────────────────────

test('session tokens are signed, self-describing and kind-bound', () => {
  const { token, payload } = mintSessionToken('STAFF', 'staff-1', { role: 'SUPPORT', name: 'Rina' });

  assert.equal(token.split('.').length, 3);
  assert.ok(token.startsWith('ksh1.'), 'versioned prefix so an old format cannot be replayed');

  const verified = verifySessionPayload(token, 'STAFF');
  assert.equal(verified.ok, true);
  if (verified.ok) {
    assert.equal(verified.payload.sub, 'staff-1');
    assert.equal(verified.payload.role, 'SUPPORT');
    assert.equal(verified.payload.exp > Date.now(), true, 'tokens must expire');
  }

  const wrongKind = verifySessionPayload(token, 'CUSTOMER');
  assert.equal(wrongKind.ok, false);
  assert.equal(wrongKind.ok ? '' : wrongKind.reason, 'wrong_kind', 'a customer token must not open the admin surface');
});

test('tampering, forgery and truncation are all rejected', () => {
  const { token } = mintSessionToken('STAFF', 'staff-1', { role: 'SUPPORT' });

  const [version, body, sig] = token.split('.');
  const forged = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  forged.role = 'SUPER_ADMIN';
  const tampered = `${version}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
  assert.equal(verifySessionPayload(tampered, 'STAFF').ok, false, 'privilege escalation through the payload fails');

  const otherBody = Buffer.from(JSON.stringify({ sub: 'x', typ: 'STAFF', exp: Date.now() + 6e5 })).toString('base64url');
  assert.equal(verifySessionPayload(`${version}.${otherBody}.${sig}`, 'STAFF').ok, false);

  assert.equal(verifySessionPayload(`${version}.${body}.${sig.slice(0, -4)}AAAA`, 'STAFF').ok, false);
  assert.equal(verifySessionPayload('garbage', 'STAFF').ok, false);
  assert.equal(verifySessionPayload('', 'STAFF').ok, false);
  assert.equal(verifySessionPayload(undefined as unknown as string, 'STAFF').ok, false);

  // The pre-rewrite static token must never authenticate again.
  assert.equal(verifySessionPayload('kisholoy_root_superadmin_session_token_2026', 'STAFF').ok, false);
});

test('expired tokens are rejected with an explicit reason', () => {
  const { token } = mintSessionToken('CUSTOMER', 'cust-1', { absoluteTtlMs: -1000 });
  const result = verifySessionPayload(token, 'CUSTOMER');
  assert.equal(result.ok, false);
  assert.equal(result.ok ? '' : result.reason, 'expired');
});

test('revocation by jti is honoured by callers that check it', () => {
  const { token, payload } = mintSessionToken('STAFF', 'staff-2');
  assert.equal(revocations.isRevoked('jti', payload.jti), false);
  revocations.revoke('jti', payload.jti, payload.exp);
  assert.equal(revocations.isRevoked('jti', payload.jti), true, 'logout / password change must kill the old token');
});

test('safeCompare never throws on unequal or empty input', () => {
  assert.equal(safeCompare('abc', 'abc'), true);
  assert.equal(safeCompare('abc', 'abd'), false);
  assert.equal(safeCompare('abc', 'abcd'), false, 'length mismatch is a denial, not a timingSafeEqual crash');
  assert.equal(safeCompare('', 'a'), false);
  assert.equal(safeCompare(undefined as unknown as string, 'a'), false);
});

// ── Cookies and CSRF ────────────────────────────────────────────────────────

test('cookie parsing is first-wins, percent-decoding and crash-proof', () => {
  const jar = parseCookies({
    headers: { cookie: `a=1; ${ADMIN_COOKIE}=ksh1.abc.def; b=2; a=duplicate; weird=%20; =novalue; =` },
  } as never);

  assert.equal(jar.a, '1', 'a repeated name keeps the first value, like the browser');
  assert.equal(jar[ADMIN_COOKIE], 'ksh1.abc.def');
  assert.equal(jar.weird, ' ');
  assert.equal(jar.novalue, undefined, 'a pair without a name is dropped, not a prototype key');
  assert.equal(Object.prototype.hasOwnProperty.call(jar, '__proto__'), false);
  assert.deepEqual(parseCookies({ headers: {} } as never), {}, 'no cookie header is not an error');

  // What we serialize must parse back identically — that pair is the auth path.
  const token = 'ksh1.eyJzdWIiOiJzdGFmZi0xIn0.c2lnbmF0dXJl';
  const roundTrip = parseCookies({ headers: { cookie: serializeCookie(ADMIN_COOKIE, token, {}) } } as never);
  assert.equal(roundTrip[ADMIN_COOKIE], token);
});

test('session cookies are HttpOnly+SameSite=Lax; the CSRF partner is readable', () => {
  const session = serializeCookie(ADMIN_COOKIE, 'ksh1.payload.sig', {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAgeSeconds: 3600,
  });
  assert.match(session, /^ksh_admin=ksh1\.payload\.sig/);
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/, 'Lax, not Strict: the gateway returns the browser with a top-level GET');
  assert.match(session, /Secure/);
  assert.match(session, /Path=\//);
  assert.match(session, /Max-Age=3600/);

  const csrf = serializeCookie(CSRF_COOKIE, 'token', { httpOnly: false, sameSite: 'lax', secure: true, path: '/' });
  assert.equal(/HttpOnly/.test(csrf), false, 'JS has to read the CSRF partner to echo it back');
});

test('CSRF enforcement: header must match the session-bound value on writes only', () => {
  const expected = 'csrf-value-123';
  const req = (header?: string) => ({ headers: header === undefined ? {} : { [CSRF_HEADER]: header } });

  assert.equal(csrfHeaderMatches(req(expected), expected), true);
  assert.equal(csrfHeaderMatches(req('other-value-!!'), expected), false, 'equal length, wrong bytes');
  assert.equal(csrfHeaderMatches(req('short'), expected), false, 'length is compared first');
  assert.equal(csrfHeaderMatches(req(), expected), false, 'missing header');
  assert.equal(csrfHeaderMatches(req(expected), undefined), false, 'no session CSRF material means deny');

  assert.equal(isUnsafeMethod('GET'), false);
  assert.equal(isUnsafeMethod('post'), true, 'method comparison is case-insensitive');
  assert.equal(isUnsafeMethod('DELETE'), true);
});

// ── TOTP (2FA) ───────────────────────────────────────────────────────────────

test('TOTP matches the RFC 6238 reference vectors', () => {
  // RFC 6238 Appendix B, SHA-1, 6-digit truncation of the 8-digit value.
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // ASCII "12345678901234567890"
  const vectors: Array<[number, string]> = [
    [59_000, '287082'],
    [1_111_111_109_000, '081804'],
    [1_234_567_890_000, '005924'],
  ];

  for (const [now, code] of vectors) {
    assert.equal(verifyTotp(rfcSecret, code, { now }), true, `RFC vector t=${now / 1000}`);
  }
  assert.equal(verifyTotp(rfcSecret, '000000', { now: 59_000 }), false);
});

test('TOTP accepts one step of skew and rejects a stale code', () => {
  const secret = generateTotpSecret();
  const now = Date.now();
  const stepMs = 30_000;

  // Derive the current code from the implementation itself (RFC vectors above
  // prove the algorithm; this half proves the window policy).
  const { code } = mintCodeForTest(secret, now);
  assert.equal(verifyTotp(secret, code, { now }), true);
  assert.equal(verifyTotp(secret, code, { now: now + stepMs }), true, 'one step of clock skew is allowed');
  assert.equal(verifyTotp(secret, code, { now: now + 2 * stepMs }), false, 'two steps is a replay window');
});

test('TOTP input is normalised and never trusts malformed codes', () => {
  const secret = generateTotpSecret();
  const { code } = mintCodeForTest(secret, Date.now());

  assert.equal(verifyTotp(secret, `  ${code}  `), true, 'spaces from a paste are harmless');
  assert.equal(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`), true, 'authenticator grouping');
  assert.equal(verifyTotp(secret, code.slice(0, 5)), false, 'five digits is not a code');
  assert.equal(verifyTotp(secret, `${code}1`), false, 'seven digits is not a code');
  assert.equal(verifyTotp(secret, 'abcdef'), false, 'letters are not a code (and the old "any 6 digits" bypass is gone)');
  assert.equal(verifyTotp('', code), false, 'un-enrolled users cannot be "verified"');
  assert.equal(verifyTotp('!!!not base32!!!', code), false);
});

test('base32 decoding is RFC 4648, padding/case-insensitive and never throws', () => {
  // RFC 6238 secret "12345678901234567890" -> base32 (first 16 chars = first 10 bytes).
  assert.equal(base32Decode('GEZDGNBVGY3TQOJQ').toString('utf8'), '1234567890');
  assert.deepEqual(base32Decode('m4zx===='), base32Decode('M4ZX'), 'padding and case are cosmetic');
  // Lenient by design: out-of-alphabet characters are skipped rather than
  // throwing, so a mistyped enrolment key produces a *different* secret (which
  // then fails verification) instead of a 500 on the security screen.
  assert.deepEqual(Array.from(base32Decode('1234')), Array.from(base32Decode('234')));
  assert.equal(base32Decode('').length, 0);
  assert.equal(verifyTotp('', '123456'), false, 'an empty secret can never verify');
});

test('otpauth URI carries the issuer and is quote-safe', () => {
  const uri = totpUri(generateTotpSecret(), 'owner@example.com', 'KISHOLOY');
  assert.ok(uri.startsWith('otpauth://totp/'), uri);
  assert.equal(/[?&]algorithm=/.test(uri), true, 'explicit SHA1 so an app cannot silently pick another');
  assert.match(uri, /KISHOLOY%3Aowner%40example\.com/, 'the label is percent-encoded, so it cannot inject params');
  assert.match(uri, /[?&]issuer=KISHOLOY/);
  assert.match(uri, /[?&]period=30/);
  assert.match(uri, /[?&]digits=6/);
});

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * Recomputes a code for a given instant with the reference construction, so the
 * assertions above test `verifyTotp` rather than agreeing with its own bugs.
 */
function mintCodeForTest(base32Secret: string, atMs: number): { code: string } {
  const key = base32Decode(base32Secret);
  const counter = Math.floor(atMs / 1000 / 30);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter % 0x100000000, 4);
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const value =
    ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return { code: String(value % 10 ** 6).padStart(6, '0') };
}

// ---------------------------------------------------------------------------
// Step-up verification for money-moving actions (server/security/stepUp.ts).
//
// Supplier payouts used to be "authorized" by securityEngine.verifyMfaForAction,
// which accepted any six digits, and the routes called it only when the client
// volunteered an `mfaCode` — so omitting the field skipped the check entirely,
// while `operator` came from the request body. These tests pin the replacement.
// ---------------------------------------------------------------------------

/** Independent RFC 6238 implementation, so "a real authenticator code works" is proven, not assumed. */
function currentTotp(secretBase32: string, stepSeconds = 30, digits = 6): string {
  const createHmac = (key: crypto.BinaryLike) => crypto.createHmac('sha1', key);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secretBase32.toUpperCase().replace(/=+$/, '')) {
    const v = alphabet.indexOf(ch);
    if (v >= 0) bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? []);
  const counter = Math.floor(Date.now() / 1000 / stepSeconds);
  const digest = createHmac(key).update(Buffer.from([counter / 2 ** 56 % 256, counter / 2 ** 48 % 256, counter / 2 ** 40 % 256, counter / 2 ** 32 % 256, counter / 2 ** 24 % 256, counter / 2 ** 16 % 256, counter / 2 ** 8 % 256, counter % 256].map((n) => Math.floor(n) & 0xff))).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | (digest[offset + 1] << 16) | (digest[offset + 2] << 8) | digest[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

const staffWithMfa = {
  id: 'adm-1', name: 'Farhana Yasmin (Accounts)', email: 'finance@kisholoy.test', role: 'FINANCE',
  status: 'ACTIVE', twoFactorEnabled: true, totpSecret: 'JBSWY3DPEHPK3PXP',
  failedLoginAttempts: 0, createdAt: '', updatedAt: '',
} as any;

const staffWithoutMfa = {
  id: 'adm-2', name: 'No Second Factor', email: 'plain@kisholoy.test', role: 'FINANCE',
  status: 'ACTIVE', twoFactorEnabled: false, failedLoginAttempts: 0, createdAt: '', updatedAt: '',
} as any;

const { requireStepUp, sessionOperatorOf, payoutStepUpThreshold } = await import('../server/security/stepUp');

test('a money-moving action without a signed-in staff session is refused', () => {
  const gate = requireStepUp({ account: null, code: '123456', action: 'SUPPLIER_PAYOUT', amount: 500000 });
  assert.equal(gate.ok, false);
  assert.equal(gate.status, 401);
  assert.equal(gate.code, 'STAFF_AUTH_REQUIRED');
  assert.match(String(gate.errorBn), /[\u0980-\u09FF]/, 'the refusal must be readable in Bengali too');
});

test('an absent, wrong or malformed step-up code never authorizes a payout', () => {
  const audit: string[] = [];
  const common = { account: staffWithMfa, action: 'SUPPLIER_PAYOUT', amount: 90000, audit: (e: any) => audit.push(e.action) };

  const missing = requireStepUp({ ...common, code: undefined });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'STEP_UP_REQUIRED', 'omitting the field must not skip the check');

  const wrong = requireStepUp({ ...common, code: '000000' });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.code, 'STEP_UP_FAILED');

  const letters = requireStepUp({ ...common, code: 'abcdef' });
  assert.equal(letters.ok, false);

  const right = currentTotp('JBSWY3DPEHPK3PXP');
  const good = requireStepUp({ ...common, code: ` ${right} ` });
  assert.equal(good.ok, true, `the live code ${right} should verify`);
  assert.equal(good.code, 'VERIFIED');

  assert.deepEqual(audit, ['STEP_UP_REQUIRED', 'STEP_UP_MFA_FAILED', 'STEP_UP_MFA_FAILED', 'STEP_UP_MFA_VERIFIED']);
});

test('a payout at or above the threshold is impossible without an enrolled authenticator', () => {
  const threshold = payoutStepUpThreshold();
  assert.equal(threshold, 50000, 'default threshold is 50,000 BDT');

  const big = requireStepUp({ account: staffWithoutMfa, code: undefined, action: 'SUPPLIER_PAYOUT', amount: threshold });
  assert.equal(big.ok, false);
  assert.equal(big.status, 409);
  assert.equal(big.code, 'MFA_NOT_ENROLLED');
  assert.match(String(big.errorBn), /[\u0980-\u09FF]/);

  const small = requireStepUp({ account: staffWithoutMfa, code: undefined, action: 'SUPPLIER_PAYOUT', amount: threshold - 1 });
  assert.equal(small.ok, true, 'small operational payments still work where nobody has enrolled yet');
  assert.equal(small.unguarded, true, 'and the answer admits it was unguarded');
});

test('the ledger operator is taken from the session, never from the request body', () => {
  assert.equal(sessionOperatorOf({ userName: 'Farhana Yasmin', userId: 'adm-9' }), 'Farhana Yasmin');
  assert.equal(sessionOperatorOf({ userId: 'adm-9' }), 'adm-9');
  assert.equal(sessionOperatorOf(undefined), 'UNKNOWN_STAFF');
  assert.equal(sessionOperatorOf({ userName: '' }), 'UNKNOWN_STAFF', 'an empty body field cannot impersonate a person');
});
