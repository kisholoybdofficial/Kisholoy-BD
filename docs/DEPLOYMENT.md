# Kisholoy-BD — Production Deployment & Operations Runbook

Everything a first deploy needs: exact environment variables, the order to set
them in, how the first administrator is created, how to verify the result, and
how to roll back. Written for Vercel (the current target) with a
container/Process-Manager note at the end.

> Do not treat any step here as optional if it says **verify**. The failure mode
> this project is recovering from is "it worked on a dev machine".

---

## 0. Shape of the deployment

| Piece | What it is | Where it runs |
| --- | --- | --- |
| Storefront + admin + vendor panel | One React/Vite SPA (`dist/`) | Vercel static/edge CDN |
| API (≈270 routes: auth, catalogue, orders, payments, CMS, reports) | Express app bundled by esbuild to **CJS** at `api/server.bundle.cjs` | Vercel Serverless Function `api/index.js` (`NODE=22`) |
| Data | MongoDB (Atlas / self-hosted) — or the `file` driver for previews | outside the function |
| Sessions | `ksh1.<payload>.<hmac>` signed tokens in **httpOnly** cookies + a readable CSRF partner cookie | no server-side session store needed |
| Uploads | Static files under `public/` (product art) | CDN |

`vercel.json` rewrites `/api/(.*)` → `/api/index` and everything else →
`/index.html`. Because the API is bundled, no `require()` of an optional
dependency (firebase-admin, supabase, …) can explode at cold start: those are
lazy-loaded through `loadServices()` and their absence degrades a feature, not
the boot.

**The bundle must be built before deploy**: `npm run build` runs
`vite build && npm run build:server`, which writes `api/server.bundle.cjs`.
`api/index.js` is a 3-line shim (`require('./server.bundle.cjs').vercelHandler`).
If you deploy without the build step, every API route answers 404 — which is how
"checkout fails" got shipped in the first place.

---

## 1. Environment variables

`.env.example` is the annotated reference (names only, no values). `server/config.ts`
is the **only** module that reads `process.env`, and it treats any value starting
with `your_`/`MY_` or ending in `_HERE` as unset, so a copy-pasted template can
never masquerade as configuration.

### 1.1 Required in production (the app refuses to boot without them)

| Variable | Notes |
| --- | --- |
| `NODE_ENV` | `production`. Enables Secure cookies, strict CSP, fail-closed bootstrap, and disables every demo/seed surface. |
| `APP_URL` | Public origin, no trailing slash. Canonical URLs, gateway return URLs, email links. |
| `KISHOLOY_SESSION_SECRET` | ≥ 32 chars. Signs session cookies **and** checkout quote tokens. Missing → fatal at boot (deliberately: an ephemeral fallback silently logs everyone out on each cold start; a fixed fallback is a universal auth bypass). Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `MONGODB_URI` + `MONGODB_DB_NAME` | The durable store. With `KISHOLOY_REQUIRE_PERSISTENCE=true` (production default) order writes are refused rather than accepted-then-lost when Mongo is unreachable. |
| `KISHOLOY_ADMIN_EMAIL` | The single bootstrap super administrator. |
| one of `KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD` **or** `KISHOLOY_ADMIN_PASSWORD_HASH` | See §3. |

### 1.2 Strongly recommended

| Variable | Why |
| --- | --- |
| `KISHOLOY_CORS_ORIGINS` | Exact comma-separated origins. Never `*`. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Shared rate limiting. Without Redis every isolate counts separately, so the effective limit multiplies with concurrency. |
| `SECURITY_HMAC_SECRET` | Domain separation for audit/IPN signatures; lets you rotate the session secret without invalidating shared secrets and vice versa. |
| `KISHOLOY_CSP` | Set only if you need a documented relaxation. The default answers `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` and `frame-ancestors 'self'` (the `localhost:*` extra appears only outside production, so the Arena/IDE preview can frame the app). |
| `RESEND_API_KEY` + `EMAIL_FROM` | Password reset and receipt mail. Off → resets return a support instruction instead of silently dropping the mail. |

### 1.3 Payments & logistics (leave unset and the features stay honestly off)

`SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_IS_SANDBOX`,
`BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`,
`BKASH_IS_SANDBOX`, `KISHOLOY_IPN_SECRET`, `STEADFAST_API_KEY`,
`STEADFAST_SECRET_KEY`, `PATHAO_CLIENT_ID`, `PATHAO_CLIENT_SECRET`.

`GET /api/payments/capabilities` reports what is actually wired up; the
checkout UI reads it, so an unconfigured gateway shows as *unavailable* rather
than as a button that fakes success.

### 1.4 Payouts, backups & mirroring (all optional; unset means "off", never "pretend")

| Variable | Effect when unset |
| --- | --- |
| `KISHOLOY_PAYOUT_MFA_THRESHOLD_BDT` | Uses 50,000. A supplier payout at or above it requires a step-up TOTP code from the signed-in staff account; there is no value that disables the check. |
| `BACKUP_S3_BUCKET` / `BACKUP_COLD_VAULT` | The DR panel reports **local-only** and failover readiness `DEGRADED`/`STANDBY`. Snapshots exist on the app's own volume only — which is not a backup. |
| `BACKUP_RETENTION_DAYS` / `BACKUP_RTO_TARGET_MINUTES` / `BACKUP_RPO_TARGET_MINUTES` | 30 / 5 / 60. Targets the drill is measured against. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_DRIVE_FOLDER_ID` / `GOOGLE_DRIVE_FOLDER_NAME` | Drive/Sheets stay `connected: false`, and `POST /api/system/drive/connect` answers 409 naming the variable to set. The admin UI cannot declare a cloud connection. |
| `SYSTEM_ADMIN_EMAIL` | The "send a test email" button answers 422 instead of mailing an address baked into the bundle; transactional mail omits `reply_to` and the footer links to the site instead. |

There is no scheduler inside the process. To make "backups run daily" true, wire
Vercel Cron (or any external timer) to `POST /api/backups/snapshots` with a
service credential, and keep the file off-host.

### 1.5 Production must be off (and is checked by the audit script)

| Variable | Production value |
| --- | --- |
| `KISHOLOY_AUTO_SEED` | `false` |
| `KISHOLOY_ALLOW_DEMO_DATA` | `false` |
| `KISHOLOY_ALLOW_DEMO_PAYMENTS` | `false` |
| `KISHOLOY_REQUIRE_PERSISTENCE` | `true` |
| `KISHOLOY_PERSISTENCE_DRIVER` | `mongo` |
| `KISHOLOY_RATELIMIT_BYPASS_IPS` | unset (ignored in production anyway) |

---

## 2. Deploy procedure (Vercel)

1. **Import** the repository (branch `main`). Framework preset: Vite.
2. **Project Settings → Environment Variables**: add §1.1 and §1.2 for
   *Production, Preview and Development*. Mark the secrets **Sensitive** so they
   are not readable in the UI afterwards.
3. **Build & Development Settings**
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm ci`
   - Node.js Version: **22.x** (`package.json` declares `engines.node: >=22`)
4. **Domains**: attach the apex + `www`, then confirm both appear in
   `KISHOLOY_CORS_ORIGINS`/`APP_URL`.
5. **Deploy.** Then run §4 verification before announcing the URL to anyone.

Preview deploys inherit `NODE_ENV=production`, so they need
`KISHOLOY_SESSION_SECRET` too. If you want previews to be disposable, set
`KISHOLOY_PERSISTENCE_DRIVER=file` and `KISHOLOY_REQUIRE_PERSISTENCE=false` on
the *Preview* environment only — never on Production.

### Deploying from a shell (equivalent, for CI)

```bash
npm ci
npm run build          # vite + esbuild -> api/server.bundle.cjs
npx vercel deploy --prod --token "$VERCEL_TOKEN" --scope <team>
```

The build must succeed **before** the deploy: `api/index.js` requires a file
that only `npm run build:server` creates.

---

## 3. Administrator bootstrap (exact procedure)

There is no default, demo or backdoor admin credential in the source, the seed
files, or the database. The first administrator is created from the environment
on first boot:

**Option A — hash out of band (preferred, the plaintext never reaches Vercel)**

```bash
npx tsx scripts/hash-password.ts        # hidden prompt, prints the env line
```

```
KISHOLOY_ADMIN_EMAIL="owner@your-domain.example"
KISHOLOY_ADMIN_PASSWORD_HASH="scrypt$32768$<salt>$<key>"
KISHOLOY_ADMIN_REQUIRE_PASSWORD_CHANGE="true"
```

**Option B — bootstrap password (fine for a first run; rotate afterwards)**

```
KISHOLOY_ADMIN_EMAIL="owner@your-domain.example"
KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD="<≥10 chars, policy-checked>"
```

Then:

1. Deploy. On boot `staffAuth.bootstrap()` creates exactly **one** `SUPER_ADMIN`
   account (scrypt hash, `mustChangePassword=true` unless a hash was supplied).
   `GET /api/security/auth/bootstrap-state` answers
   `{ "adminReady": true }` and nothing else — no emails, no hashes.
2. Sign in at `/admin` (the login screen shows no credentials, only the form).
   5 failures per identifier lock the account for a while; failures per IP are
   rate limited separately.
3. The **forced password change** screen is the first thing you see. Choose a
   real password; this also clears `mustChangePassword` and revokes the session
   that performed the change.
4. Enrol 2FA (TOTP) from the admin security panel *before* inviting anyone else.
   Step-up verification is required for refunds, payouts and staff administration.
5. Invite staff with the least privilege that does the job
   (`SUPPORT`, `ORDER_MANAGER`, `INVENTORY_MANAGER`, `FINANCE_MANAGER`,
   `CONTENT_EDITOR`, `VENDOR_MANAGER`, `SUPER_ADMIN`). Roles are enforced on the
   server by `server/routePermissions.ts`, not by hiding menu items.

Rotating `KISHOLOY_SESSION_SECRET` invalidates every session — which is also the
one-command response to a stolen cookie or a leaked laptop.

---

## 4. Post-deploy verification

`scripts/audit/verify-live.sh` runs ~80 assertions against a live base URL:
auth surface, IDOR, order math, stock, coupons, headers, SEO, catalogue leaks.

```bash
BASE="https://your-domain.example" \
ADMIN_EMAIL="owner@your-domain.example" ADMIN_PASSWORD='<bootstrap password>' \
bash scripts/audit/verify-live.sh
```

Minimum manual spot-checks (all of these were real bugs at some point):

```bash
# 1. API is deployed at all (a 404 here means the build step was skipped)
curl -s "$BASE/api/health" | head -c 400

# 2. Nothing privileged is readable anonymously
for p in orders customers suppliers finance/admin/summary payments \
         security/audit security/users inventory/low-stock notifications integrations/status; do
  printf '%-28s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/$p")"
done   # every line must be 401 (403 is also a pass when a session exists)

# 3. The removed backdoors stay removed
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/security/auth/persona-session"   # 401/404
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/payments/test-ipn"                # 401/404
curl -s -o /dev/null -w '%{http_code}\n' -X POST "$BASE/api/seed"                              # 401/404

# 4. Session cookie hardening
curl -si -X POST "$BASE/api/security/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"owner@your-domain.example","password":"..."}' | grep -i '^set-cookie'
# ksh_admin=... HttpOnly ... SameSite=Lax   (and ksh_csrf WITHOUT HttpOnly)

# 5. Search engines are told the truth
curl -s "$BASE/robots.txt"; curl -sI "$BASE/admin" | grep -i 'x-robots'
curl -s "$BASE/sitemap.xml" | grep -c '<url>'
```

A real order end-to-end (catalogue → quote → order → track → stock decrement)
is exercised by the script in §"commerce"; if you only have time for one thing,
place one Cash-on-Delivery order and confirm the stock went down by exactly the
quantity ordered.

---

## 5. Seeding the catalogue

```bash
# once, deliberately, from a machine with MONGODB_URI configured:
KISHOLOY_ALLOW_DEMO_DATA=true npx tsx scripts/seed-cli.ts            # idempotent
KISHOLOY_ALLOW_DEMO_DATA=true npx tsx scripts/seed-cli.ts --force   # overwrite
```

- 22 products / 10 categories / 4 vendors / 3 coupons, all product-agnostic
  (variants, attributes, warranty, return policy, SEO, economics).
- Idempotent by `sku`/`slug`: a second run reports `0 created`.
- Demo *shoppers* are passwordless and only exist when
  `KISHOLOY_ALLOW_DEMO_DATA=true`; production never creates them, and there are
  no demo *staff* accounts in the seed at all.
- Never wire `KISHOLOY_AUTO_SEED=true` into production: a boot-time write storm
  is not a controlled migration.

---

## 6. Payments: what "honest" means here

| Path | Behaviour |
| --- | --- |
| Cash on Delivery | Order is created `UNPAID`; nothing is faked. |
| SSLCommerz / bKash redirect | Order holds stock, `paymentVerification.state = AWAITING_GATEWAY_CONFIRMATION`. It becomes PAID **only** after `POST /api/payments/ipn` is verified against the gateway (HMAC/shared secret, and a direct `validate` call where the gateway supports it). A browser arriving on the success URL changes nothing. |
| Gateway not configured | Checkout reports the capability gap in Bengali and English and offers COD/manual claim. `KISHOLOY_ALLOW_DEMO_PAYMENTS` is required for anything to be marked paid without a gateway, and it is refused in production. |
| Manual (bank/mobile transfer) | `POST /api/payments/manual-claim` creates a `PENDING` claim; a finance role verifies it. Never auto-approved. |

IPN handling is idempotent per gateway transaction id, so a retry from the
gateway cannot double-capture and cannot double-release stock.

---

## 7. Rollback & incident response

- **Rollback**: Vercel → Deployments → ⋯ → *Promote to Production* on the previous
  deployment. Data is additive: the order/inventory tables keep working with an
  older API because soft-deleted products and `isDeleted` flags are ignored by
  older code rather than corrupting it.
- **Leaked session/cookie or staff device**: rotate `KISHOLOY_SESSION_SECRET`
  (logs everyone out) — or revoke one account with
  `POST /api/security/sessions/revoke` (raises `sessionsInvalidBefore`).
- **Leaked admin password**: set a fresh `KISHOLOY_ADMIN_PASSWORD_HASH`, redeploy,
  then change it again inside the app; the old hash is useless without the new
  secret and revokes nothing by itself, so also revoke sessions.
- **Bad CMS publish**: Admin → Content Studio → *Publish History & Rollback*
  restores any previous revision (revisions are full snapshots).
- **Suspected oversell**: `GET /api/inventory/low-stock` and the inventory ledger
  (`stockTransactions`) show every reservation/release with actor and reason;
  stock changes are transactional, so a discrepancy is a bug to file, not a
  manual patch to apply.

---

## 8. Non-Vercel hosts (container / Render / Railway / a VPS)

`npm run build:local` produces `dist/` + `dist/server.cjs`; `npm start`
(`NODE_ENV=production node dist/server.cjs`) serves the SPA **and** the API on
`PORT`, so one process is enough. Requirements do not change: same env vars,
same build step. Put a TLS-terminating proxy in front (Secure cookies are
refused over plain http) and make sure it sets `X-Forwarded-For`: the rate
limiter and the audit trail take the **first** hop of that header as the client
identity, exactly as they do on Vercel. If your proxy appends rather than
prepends, or the app is reachable bypassing the proxy, fix the proxy (or bind
the app to a private interface) — do not add an IP bypass, which is ignored in
production by design.

---

## 9. Known gaps at the time of writing

Not hidden on purpose — see also the PR description.

- Automated coverage is `npm test` — 57 `node:test` cases in four files
  (`security`: password hashing, signed sessions, cookies, TOTP, step-up rules;
  `spreadsheet`: the dependency-free XLSX/CSV reader+writer; `api-surface`: the
  HTTP contract booted against a real server; `serverless-bundle`: the built
  Vercel artifact itself). Suites that need the bundle **skip** until
  `npm run build` has run, so run `npm run verify` (lint → test → build) before
  trusting a green `npm test`.
- Deeper behavioural evidence is `scripts/audit/verify-live.sh` (127 assertions,
  all passing against a local instance with the `file` driver): it needs
  `ADMIN_EMAIL`/`ADMIN_PASSWORD` explicitly — the repository carries no default
  credential, not even in a test script.
- `docs/DEPLOYMENT.md` §1 assumes MongoDB. The Mongo driver is unit-tested for
  URL/driver behaviour but has not been exercised against a live Atlas cluster
  from this environment (**NOT VERIFIED**).
- Real gateway credentials (SSLCommerz/bKash sandbox) are not available here, so
  IPN *verification* was proven with signature checks and fake-gateway harnesses
  rather than against the live sandbox (**NOT VERIFIED** end-to-end).
- Product imagery: the catalogue ships with locally generated art plus a
  placeholder fallback; some SKUs still fall back to the placeholder until a
  photographer's set is dropped into `public/products/`.
- Order tracking is deliberately two-factor: an order number alone no longer
  reveals a recipient's name, phone or address (`?phone=` is required, and a
  mismatch is answered with the same 404 as an unknown number so the endpoint
  cannot enumerate orders). Guests must therefore keep their order number *and*
  the mobile they checked out with; an authenticated customer can always open
  their own orders from their account page.
- `POST /api/suppliers/:id/payments` and `/api/suppliers/settlements/:id/pay`
  require a step-up TOTP code from the *signed-in* account at or above
  `KISHOLOY_PAYOUT_MFA_THRESHOLD_BDT` (default 50,000), and refuse large
  payouts outright for accounts with no authenticator enrolled. Smaller
  payments on an unenrolled account still work but are audited as unguarded.
- Backup/DR and Google Drive panels report configuration, not aspiration:
  `connected`, the cold-vault name and drill status are derived from
  `GOOGLE_SERVICE_ACCOUNT_JSON` / `GOOGLE_DRIVE_FOLDER_ID` /
  `BACKUP_S3_BUCKET` / `BACKUP_COLD_VAULT`, and start at `NOT_RUN`/`STANDBY`.
  There is **no in-process scheduler** — set up Vercel Cron or an external job
  calling `POST /api/backups/snapshots`, otherwise nothing is ever backed up.
- `POST /api/system/export` / `/api/system/import` still accept an
  `entity`/`records` payload shape inherited from the original app, and order
  `channelDetails.operatorName` remains caller-supplied channel metadata (not an
  audit actor). Both are worth a dedicated pass; audit attribution for every
  privileged write is now session-derived.
