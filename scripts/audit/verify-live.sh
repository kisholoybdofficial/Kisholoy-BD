#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Live end-to-end verification against a running KISHOLOY server.
#
#   BASE=http://localhost:3000 \
#   ADMIN_EMAIL=<your local bootstrap account> ADMIN_PASSWORD=<its password> \
#   bash scripts/audit/verify-live.sh
#
# Every assertion checks an observable behaviour (status code, response body,
# or stored data), never the presence of source code. Sections 2, 3 and 5 are
# explicit regressions for the vulnerabilities found in the audit.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
BASE="${BASE:-http://localhost:3000}"
# No default credential: this harness must be told which account to use, so the
# repository never carries a string that reads like "the admin password". Point it
# at the account you bootstrapped locally, e.g.
#   ADMIN_EMAIL=dev@kisholoy.test ADMIN_PASSWORD="$(cat ./dev-admin-password)" \
#   bash scripts/audit/verify-live.sh
if [ -z "${ADMIN_EMAIL:-}" ] || [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "ADMIN_EMAIL and ADMIN_PASSWORD must be supplied (they are the local bootstrap" >&2
  echo "account, not a repo default). Example:" >&2
  echo "  KISHOLOY_ADMIN_EMAIL=dev@kisholoy.test KISHOLOY_ADMIN_BOOTSTRAP_PASSWORD='…' npm run dev" >&2
  echo "  ADMIN_EMAIL=dev@kisholoy.test ADMIN_PASSWORD='…' BASE=http://localhost:3000 bash scripts/audit/verify-live.sh" >&2
  exit 2
fi
JAR=$(mktemp); HDRS=$(mktemp); LAST=/tmp/vlast.json; CSRF=""; PASS=0; FAIL=0

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()  { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31mFAIL\033[0m %s\n' "$1"; if [ -n "${VERBOSE:-}" ]; then printf '       %s\n' "${2:-}"; fi; return 0; }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (got [$1], want [$2])" "${4:-}"; fi; }
# True when $1 equals any of the space-separated acceptable values in $2.
inset(){ for _w in $2; do [ "$1" = "$_w" ] && return 0; done; return 1; }
code() { curl -s -o "$LAST" -w '%{http_code}' "$@"; }
body() { head -c 400 "$LAST" | tr -d '\n'; }

# ── helpers that read the last JSON response without jq ──────────────────────
jqpy() { python3 -c "
import json,sys
try: d=json.load(open('$LAST'))
except Exception: print('parse-error'); sys.exit(0)
for part in '$1'.split('.'):
    if d is None: break
    d = d.get(part) if isinstance(d, dict) else (d[int(part)] if part.isdigit() and isinstance(d, list) else None)
print(d if d is not None else 'null')
"; }

say "0. Environment"
printf '  target=%s\n' "$BASE"
if [ "$(curl -s -o /dev/null -w '%{http_code}' -m 5 "$BASE/api/health")" != "200" ]; then
  printf '  \033[31mserver unreachable\033[0m — start it with: npm run dev\n'; exit 2
fi

say "1. Storefront stays public and leaks nothing commercial"
check "$(code "$BASE/api/health")" 200 "GET /api/health"
check "$(code "$BASE/api/products")" 200 "GET /api/products (anonymous)"
curl -s "$BASE/api/products?limit=200" > /tmp/vprod.json
COUNT=$(python3 -c "import json;print(len(json.load(open('/tmp/vprod.json'))['products']))")
if [ "${COUNT:-0}" -ge 20 ]; then ok "catalogue serves $COUNT products (>=20 demo products)"; else bad "only $COUNT products visible"; fi
HAS_COST=$(python3 -c "import json;d=json.load(open('/tmp/vprod.json'));print(any('costPrice' in p for p in d['products']))")
[ "$HAS_COST" = "False" ] && ok "no costPrice leaked to shoppers" || bad "costPrice leaked to shoppers"
HAS_ECON=$(python3 -c "import json;d=json.load(open('/tmp/vprod.json'));print(any('economics' in p for p in d['products']))")
[ "$HAS_ECON" = "False" ] && ok "no supplier economics leaked" || bad "supplier economics leaked"
INACTIVE=$(python3 -c "import json;d=json.load(open('/tmp/vprod.json'));print(sum(1 for p in d['products'] if p.get('status','ACTIVE')!='ACTIVE'))")
check "$INACTIVE" 0 "no draft/archived product visible anonymously"
CHECKOUT=$(code "$BASE/api/checkout/calculate" -X POST -H 'Content-Type: application/json' -d "{\"items\":[{\"productId\":\"$(python3 -c "import json;print(json.load(open('/tmp/vprod.json'))['products'][0]['id'])")\",\"quantity\":1}],\"district\":\"Dhaka\"}")
check "$CHECKOUT" 200 "POST /api/checkout/calculate"
QT=$(jqpy quoteToken); [ "$QT" != "null" ] && [ -n "$QT" ] && ok "quote is signed (quoteToken issued)" || bad "no signed quote token"

say "2. Privileged reads must reject anonymous callers (fail closed)"
for ep in /api/orders /api/customers /api/security/users /api/finance/summary /api/reports/overview /api/system/backups /api/security/sessions /api/payments/transactions /api/fraud/blacklist /api/inventory/transactions /api/suppliers /api/audit/logs; do
  check "$(code "$BASE$ep")" 401 "GET $ep"
done

say "3. Audit findings: backdoors and dev shortcuts must be gone"
check "$(code -X POST -H 'Content-Type: application/json' -d '{"role":"SUPER_ADMIN"}' "$BASE/api/security/auth/persona-session")" 401 "passwordless persona-session grants nothing"
check "$(code -H 'Authorization: Bearer kisholoy_root_superadmin_session_token_2026' "$BASE/api/orders")" 401 "static root super-admin token rejected"
check "$(code -H 'Authorization: Bearer ksh-token-super-admin-root-session-2026' "$BASE/api/security/users")" 401 "legacy root staff token rejected"
check "$(code -H 'Authorization: Bearer ksh-persona-SUPER_ADMIN-0000000000-abcdef' "$BASE/api/security/users")" 401 "guessed persona-shaped token rejected"
C=$(code -X POST -H 'Content-Type: application/json' -d '{}' "$BASE/api/security/auth/ensure-super-admin")
{ inset "$C" "401 404" && ok "ensure-super-admin removed ($C)"; } || bad "ensure-super-admin reachable ($C)"
C=$(code -X POST -H 'Content-Type: application/json' -d '{"orderNumber":"KSH-2026-0891","status":"VALID"}' "$BASE/api/payments/test-ipn")
{ inset "$C" "401 404" && ok "test-ipn payment simulator removed ($C)"; } || bad "test-ipn reachable ($C)"
C=$(code -X POST -H 'Content-Type: application/json' -d '{"tran_id":"KSH-FAKE","val_id":"abcd","status":"VALID"}' "$BASE/api/payments/ipn")
{ inset "$C" "400 401 404" && ok "unsigned IPN cannot mark an order paid ($C)"; } || bad "IPN accepted an unsigned payload ($C)"
C=$(code "$BASE/api/seed"); D=$(code -X POST "$BASE/api/seed")
{ inset "$C" "401 404" && inset "$D" "401 404" && ok "no exposed seed route ($C/$D)"; } || bad "a seed route is exposed ($C/$D)"
C=$(code "$BASE/api/integrations/status")
{ inset "$C" "401 404" && ok "integration status not world-readable ($C)"; } || bad "integration status public ($C)"
BODY=$(body); case "$BODY" in *KisholoySuperAdmin*|*'@2026'*) bad "a default password is still discoverable";; *) ok "no default credential in responses";; esac

say "4. Customer authentication actually verifies passwords"
PHONE="01$(shuf -i 3-9 -n 1)$(shuf -i 10000000-99999999 -n 1)"
check "$(code -X POST -H 'Content-Type: application/json' -d '{"identifier":"01711002211","password":""}' "$BASE/api/customer/auth/login")" 422 "empty password rejected"
check "$(code -X POST -H 'Content-Type: application/json' -d '{"identifier":"01711002211","password":"wrongpassword1"}' "$BASE/api/customer/auth/login")" 401 "wrong password rejected"
check "$(code -X POST -H 'Content-Type: application/json' -d '{"identifier":"01711002211"}' "$BASE/api/customer/auth/login")" 422 "no more password-free login"
check "$(code -c $JAR -X POST -H 'Content-Type: application/json' -d "{\"name\":\"Verify Shopper\",\"phone\":\"$PHONE\",\"email\":\"verify-$PHONE@example.com\",\"password\":\"StrongPass2026x\",\"address\":\"12 Test Road, Banani\",\"district\":\"Dhaka\"}" "$BASE/api/customer/auth/register")" 201 "registration succeeds"
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"name\":\"Dup Person\",\"phone\":\"$PHONE\",\"password\":\"StrongPass2026x\"}" "$BASE/api/customer/auth/register")" 409 "duplicate phone rejected"
check "$(code -X POST -H 'Content-Type: application/json' -d '{"name":"Weak Person","phone":"01812345678","password":"abc"}' "$BASE/api/customer/auth/register")" 422 "weak password rejected"
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"identifier\":\"$PHONE\",\"password\":\"StrongPass2026x\"}" -c $JAR "$BASE/api/customer/auth/login")" 200 "login by phone works"
check "$(code -b $JAR "$BASE/api/customer/auth/me")" 200 "httpOnly cookie restores the session"
ME_ID=$(jqpy customer.id)
[ "$ME_ID" != "null" ] && [ "$ME_ID" != "None" ] && ok "authenticated as $ME_ID" || bad "no customer id returned" "$(body)"
LEAK=$(python3 -c "import json;print('passwordHash' in json.dumps(json.load(open('$LAST'))))")
[ "$LEAK" = "False" ] && ok "no credential material in the customer payload" || bad "credential material exposed"

say "5. Customer scoping (IDOR guards)"
C=$(code -b $JAR "$BASE/api/customers"); { inset "$C" "401 403" && ok "shopper cannot read the customer directory ($C)"; } || bad "shopper reached the directory ($C)"
check "$(code -b $JAR "$BASE/api/orders")" 200 "customer may list their own orders"
LEAK=$(python3 -c "
import json
d=json.load(open('$LAST'))
print(any(o.get('customer',{}).get('id') != '$ME_ID' and o.get('customer',{}).get('id') for o in d.get('orders',[])))")
[ "$LEAK" = "False" ] && ok "order list contains only this shopper's rows" || bad "order list not scoped"
check "$(code "$BASE/api/customer/profile/cust-1")" 401 "profile read needs a session"
C=$(code -b $JAR "$BASE/api/customer/profile/cust-1"); { inset "$C" "403 404" && ok "cannot read another shopper's profile ($C)"; } || bad "foreign profile readable ($C)"
C=$(code -b $JAR "$BASE/api/customer/addresses/cust-1"); { inset "$C" "403 404" && ok "cannot read another shopper's addresses ($C)"; } || bad "foreign addresses readable ($C)"
C=$(code -b $JAR "$BASE/api/customer/notifications/cust-1"); { inset "$C" "403 404" && ok "cannot read another shopper's notifications ($C)"; } || bad "foreign notifications readable ($C)"

say "6. Staff login, cookies, CSRF binding and RBAC"
LOGIN=$(code -c $JAR -D $HDRS -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}" "$BASE/api/security/auth/login")
{ [ "$LOGIN" = "200" ] || [ "$LOGIN" = "202" ]; } && ok "staff login issues a session ($LOGIN)" || { bad "staff login failed ($LOGIN)" "$(body)"; }
grep -q 'ksh_admin=' $HDRS && ok "session cookie set" || bad "no session cookie"
grep 'ksh_admin=' $HDRS | grep -q 'HttpOnly' && ok "admin cookie is HttpOnly" || bad "admin cookie is JS-readable"
grep 'ksh_admin=' $HDRS | grep -q 'SameSite=Lax' && ok "admin cookie sets SameSite=Lax" || bad "admin cookie lacks SameSite"
grep -q 'ksh_csrf=' $HDRS && ok "CSRF partner cookie issued" || bad "no CSRF cookie issued"
grep 'ksh_csrf=' $HDRS | grep -q 'HttpOnly' && bad "CSRF cookie must stay app-readable" || ok "CSRF cookie intentionally readable by the app"
CSRF=$(grep -o 'ksh_csrf=[^;[:space:]]*' $HDRS | head -1 | cut -d= -f2)
LEAK=$(python3 -c "
import json;s=json.dumps(json.load(open('$LAST')));print('passwordHash' in s or '\"salt\"' in s or 'totpSecret' in s)")
[ "$LEAK" = "False" ] && ok "login response carries no hash, salt or TOTP secret" || bad "credential material in login response"
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"definitely-wrong-1\"}" "$BASE/api/security/auth/login")" 401 "wrong admin password rejected"

check "$(code -b $JAR -X POST -H 'Content-Type: application/json' -d '{"title":"CSRF Probe","price":100,"category":"Test","categorySlug":"test","stock":1,"description":"probe text","descriptionBn":"প্রোব"}' "$BASE/api/products")" 403 "cookie mutation WITHOUT CSRF header refused"
check "$(code -b $JAR -H "X-CSRF-Token: $CSRF" -X POST -H 'Content-Type: application/json' -d '{"title":"CSRF Probe","price":100,"category":"Test","categorySlug":"test","stock":1,"description":"probe text","descriptionBn":"প্রোব"}' "$BASE/api/products")" 201 "same mutation succeeds with CSRF header"
PROD_ID=$(jqpy product.id)
check "$(code -b $JAR -X DELETE "$BASE/api/products/$PROD_ID")" 403 "DELETE needs the CSRF partner too"
check "$(code -b $JAR -H "X-CSRF-Token: $CSRF" -X PUT -H 'Content-Type: application/json' -d '{"stock":44}' "$BASE/api/products/$PROD_ID")" 200 "admin product update works (stock=44)"
check "$(code -b $JAR "$BASE/api/security/users")" 200 "admin can read the staff directory"
LEAK=$(python3 -c "
import json;d=json.load(open('$LAST'));print(any('passwordHash' in json.dumps(u) or 'totpSecret' in json.dumps(u) for u in d.get('data',[])))")
[ "$LEAK" = "False" ] && ok "staff directory never carries hashes or TOTP secrets" || bad "credential material in staff directory"
check "$(code -b $JAR -H "X-CSRF-Token: $CSRF" -X POST -H 'Content-Type: application/json' -d "{\"email\":\"escalate-$(date +%s)@example.com\",\"name\":\"Escalation Probe\",\"role\":\"SUPER_ADMIN\"}" "$BASE/api/security/users/create")" 200 "superadmin may create staff (role grant allowed for SUPER_ADMIN)"
NEW_ID=$(jqpy account.id)
check "$(code -b $JAR -X POST -H 'Content-Type: application/json' -d "{\"email\":\"another-$(date +%s)@example.com\",\"name\":\"No CSRF\",\"role\":\"SUPPORT\"}" "$BASE/api/security/users/create")" 403 "staff creation without CSRF refused"
check "$(code "$BASE/api/security/users/create" -X POST -H 'Content-Type: application/json' -d '{"email":"anon@example.com","name":"Anon","role":"SUPER_ADMIN"}')" 401 "anonymous staff creation refused"

say "7. Order engine integrity"
PID=$(python3 -c "
import json
d=json.load(open('/tmp/vprod.json'))
ps=[p for p in d['products'] if (p.get('stock') or 0) >= 6]
print(ps[0]['id'] if ps else '')")
read -r STOCK PRICE <<< "$(python3 -c "
import json
d=json.load(open('/tmp/vprod.json'))
p=[x for x in d['products'] if x['id']=='$PID'][0]
print(p['stock'], p['price'])")"
IDEM="verify-$(date +%s%N)"
ORDER_BODY="{\"customer\":{\"name\":\"Verify Buyer\",\"phone\":\"01712345678\"},\"shippingAddress\":{\"address\":\"House 1, Road 2, Banani\",\"district\":\"Dhaka\",\"division\":\"Dhaka\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":2}],\"paymentMethod\":\"COD\",\"idempotencyKey\":\"$IDEM\"}"
check "$(code -X POST -H 'Content-Type: application/json' -d "$ORDER_BODY" "$BASE/api/orders/create")" 201 "order created (2 x $PID)"
ORDER_NO=$(jqpy order.orderNumber)
read -r SUB FEE TOTAL <<< "$(python3 -c "
import json
o=json.load(open('$LAST'))['order']
print(o['subtotal'], o['shippingFee'], o['total'])")"
check "$(python3 -c "print(1 if abs($SUB - 2*$PRICE) < 0.01 else 0)")" 1 "subtotal = 2 x catalogue price ৳$PRICE (server-priced)"
check "$(python3 -c "print(1 if abs($TOTAL - ($SUB + $FEE)) < 0.01 else 0)")" 1 "total = subtotal + delivery ৳$FEE (server-computed)"
check "$(jqpy order.paymentStatus)" "UNPAID" "COD order is UNPAID, never fake-confirmed"
check "$(jqpy paymentVerification.state)" "AWAITING_GATEWAY_CONFIRMATION" "payment truth deferred to the gateway"
check "$(code -X POST -H 'Content-Type: application/json' -d "$ORDER_BODY" "$BASE/api/orders/create")" 200 "replaying the idempotency key returns the first order"
check "$(jqpy duplicate)" "True" "duplicate submission is flagged"
check "$(code "$BASE/api/orders/track?orderNumber=$ORDER_NO&phone=01712345678")" 200 "customer can track by order number + phone"
check "$(code "$BASE/api/orders/track?orderNumber=$ORDER_NO&phone=01799999999")" 404 "tracking requires the matching phone (no enumeration)"

TAMPER="{\"customer\":{\"name\":\"Tamper Two\",\"phone\":\"01712345679\"},\"shippingAddress\":{\"address\":\"House 9, Road 9, Uttara\",\"district\":\"Dhaka\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":1,\"price\":1}],\"paymentMethod\":\"SSLCOMMERZ\"}"
check "$(code -X POST -H 'Content-Type: application/json' -d "$TAMPER" "$BASE/api/orders/create")" 201 "order with a tampered client price is accepted at the SERVER price"
check "$(jqpy order.subtotal)" "$PRICE" "client-claimed ৳1 ignored (subtotal ৳$PRICE)"
check "$(jqpy order.paymentStatus)" "PENDING" "claimed gateway payment stays PENDING until verified"
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"customer\":{\"name\":\"Neg One\",\"phone\":\"01712345680\"},\"shippingAddress\":{\"address\":\"x y z road\",\"district\":\"Dhaka\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":-3}]}" "$BASE/api/orders/create")" 422 "negative quantity rejected"
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"customer\":{\"name\":\"Big One\",\"phone\":\"01712345681\"},\"shippingAddress\":{\"address\":\"x y z road\",\"district\":\"Dhaka\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":999999}]}" "$BASE/api/orders/create")" 422 "quantity over the per-line cap rejected"
OVERQTY=$((STOCK + 3)); [ "$OVERQTY" -gt 200 ] && OVERQTY=200
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"customer\":{\"name\":\"Over One\",\"phone\":\"01712345681\"},\"shippingAddress\":{\"address\":\"x y z road\",\"district\":\"Dhaka\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":$OVERQTY}]}" "$BASE/api/orders/create")" 409 "quantity above available stock rejected ($OVERQTY > $STOCK)"
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"customer\":{\"name\":\"Ghost Cart\",\"phone\":\"01712345682\"},\"shippingAddress\":{\"address\":\"some street here\",\"district\":\"Dhaka\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":1},{\"productId\":\"ghost-product\",\"quantity\":1}]}" "$BASE/api/orders/create")" 409 "cart with one unknown product is rejected (not a 500)"
BADPHONE="{\"customer\":{\"name\":\"Bad Phone\",\"phone\":\"12345\"},\"shippingAddress\":{\"address\":\"12 Some Road\",\"district\":\"Dhaka\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":1}]}"
check "$(code -X POST -H 'Content-Type: application/json' -d "$BADPHONE" "$BASE/api/orders/create")" 422 "invalid phone number rejected"
SHORTADDR="{\"customer\":{\"name\":\"Short Addr\",\"phone\":\"01712345683\"},\"shippingAddress\":{\"address\":\"ab\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":1}]}"
check "$(code -X POST -H 'Content-Type: application/json' -d "$SHORTADDR" "$BASE/api/orders/create")" 422 "too-short address rejected"
INJECT="{\"customer\":{\"name\":\"<script>alert(1)</script>\",\"phone\":\"01712345684\"},\"shippingAddress\":{\"address\":\"<img src=x onerror=alert(1)> House 3\",\"district\":\"Dhaka\"},\"items\":[{\"productId\":\"$PID\",\"quantity\":1}]}"
check "$(code -X POST -H 'Content-Type: application/json' -d "$INJECT" "$BASE/api/orders/create")" 201 "markup in name/address is accepted as inert text"
SAN=$(python3 -c "
import json
o=json.load(open('$LAST'))['order']
name=o['customer']['name']; addr=o['shippingAddress']['address']
print('stripped' if ('<' not in name and '<' not in addr) else 'raw:'+repr(name)[:40])")
[ "${SAN%%:*}" = "stripped" ] && ok "stored values are sanitised (angle brackets removed)" || bad "raw markup stored: $SAN"
check "$(code -X POST -H 'Content-Type: application/json' -d 'not json' -H 'Content-Type: application/json' "$BASE/api/orders/create")" 400 "malformed JSON returns 400, not a stack trace"
check "$(jqpy code)" "MALFORMED_JSON" "malformed JSON gets a stable error code"

say "8. Stock ledger consistency"
NEWSTOCK=$(curl -s "$BASE/api/products?limit=200" | python3 -c "
import json,sys
d=json.load(sys.stdin)
p=[x for x in d['products'] if x['id']=='$PID'][0]
print(p['stock'])")
EXPECTED=$((STOCK - 4))   # 2 (main) + 1 (tamper) + 1 (sanitised) orders succeeded
check "$NEWSTOCK" "$EXPECTED" "stock moved exactly by what sold ($STOCK → $NEWSTOCK)"
check "$(code -b $JAR -H "X-CSRF-Token: $CSRF" "$BASE/api/inventory/transactions")" 200 "inventory ledger readable"
ROWS=$(python3 -c "
import json;d=json.load(open('$LAST'));print(len(d.get('transactions') or d.get('data') or []))")
[ "${ROWS:-0}" -ge 1 ] && ok "sale allocations recorded in the inventory ledger ($ROWS rows)" || bad "inventory ledger empty"
check "$(code -b $JAR -H "X-CSRF-Token: $CSRF" "$BASE/api/products/$PROD_ID" -o "$LAST")" 200 "the CSRF probe product is visible to staff"
# The partner header was just *supplied* above, so the honest probe is the one
# that withholds it: a cookie-authenticated DELETE must not be honored.
check "$(code -b $JAR -X DELETE "$BASE/api/products/$PROD_ID")" 403 "DELETE without the CSRF partner is refused"

check "$(code -b $JAR -H "X-CSRF-Token: $CSRF" -X DELETE "$BASE/api/products/$PROD_ID")" 200 "admin can archive a product"
check "$(code "$BASE/api/products/$PROD_ID")" 404 "archived product disappears from the public catalogue (soft delete)"

say "9. Coupon engine"
check "$(code -X POST -H 'Content-Type: application/json' -d '{"couponCode":"NOT_A_COUPON","items":[{"productId":"x","quantity":1,"price":100}],"subtotal":100,"shippingFee":60}' "$BASE/api/promotions/validate")" 200 "unknown coupon answered"
check "$(jqpy evaluation.valid)" "False" "unknown coupon marked invalid"
check "$(code -X POST -H 'Content-Type: application/json' -d '{"couponCode":"DROP TABLE orders;--","items":[{"productId":"x","quantity":1,"price":100}],"subtotal":100,"shippingFee":60}' "$BASE/api/promotions/validate")" 200 "malicious coupon string handled safely"
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"couponCode\":\"UTSHOB10\",\"items\":[{\"productId\":\"$PID\",\"quantity\":1,\"price\":100}],\"subtotal\":100,\"shippingFee\":60}" "$BASE/api/promotions/validate")" 200 "coupon below min order answered"
check "$(jqpy evaluation.valid)" "False" "minimum-order rule enforced server-side"
check "$(code -X POST -H 'Content-Type: application/json' -d "{\"couponCode\":\"../etc/passwd\",\"items\":[{\"productId\":\"$PID\",\"quantity\":1,\"price\":5000}],\"subtotal\":5000,\"shippingFee\":60}" "$BASE/api/promotions/validate")" 200 "path-traversal coupon string is inert"

say "10. Error hygiene and response headers"
check "$(code "$BASE/api/products/no-such-product-anywhere")" 404 "unknown product answers 404"
check "$(jqpy error)" "Product not found." "404 body is a plain user-facing message"
grep -qi 'x-content-type-options: nosniff' $HDRS && ok "X-Content-Type-Options: nosniff" || bad "nosniff missing"
grep -qi 'content-security-policy' $HDRS && ok "Content-Security-Policy present" || bad "CSP missing"
grep -qi 'x-frame-options: deny' $HDRS && ok "X-Frame-Options: DENY" || bad "frame protection missing"
grep -qi 'referrer-policy' $HDRS && ok "Referrer-Policy present" || bad "Referrer-Policy missing"
grep -qi 'permissions-policy' $HDRS && ok "Permissions-Policy present" || bad "Permissions-Policy missing"
grep -qi 'access-control-allow-origin: \*' $HDRS && bad "wildcard CORS still present" || ok "no wildcard CORS"
LEAK=$(grep -icE 'stack|node_modules|at .*\.ts:[0-9]+|MongoNetwork|ECONNREFUSED' "$LAST" || true)
check "$LEAK" 0 "no internals in the last error body"
printf '       CSP frame-ancestors: %s\n' "$(grep -io "frame-ancestors [^;\\r]*" $HDRS | head -1)"

say "11. Durability"
PERSIST=$(code "$BASE/api/health")
MODE=$(curl -s "$BASE/api/health" | python3 -c "import json,sys;print(json.load(sys.stdin)['persistence']['mode'])")
DURABLE=$(curl -s "$BASE/api/health" | python3 -c "import json,sys;print(json.load(sys.stdin)['persistence']['durable'])")
ok "persistence mode=$MODE durable=$DURABLE"
[ "$DURABLE" = "True" ] && ok "orders/admin edits are written durably" || bad "store is VOLATILE (data lost on restart)"
check "$(code "$BASE/sitemap.xml")" 200 "sitemap.xml served"
check "$(code "$BASE/robots.txt")" 200 "robots.txt served"

say "12. Money-out controls & operational honesty"
# Payouts are the one place where a missing second factor moves real money, and
# the panels below used to report connections and drills that never happened.
SUP=$(curl -s -b $JAR "$BASE/api/suppliers" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
rows=d.get('suppliers') or d.get('data') or d.get('vendorSuppliers') or []
print(rows[0]['id'] if rows else '')" 2>/dev/null)
if [ -n "$SUP" ]; then
  check "$(code -X POST -H 'Content-Type: application/json' -d "{\"amount\":250000,\"paymentMethod\":\"BANK\",\"referenceNumber\":\"AUDIT-NOSTORE\"}" "$BASE/api/suppliers/$SUP/payments")" 401 "payout attempt without any session is refused"
  C=$(code -b $JAR -H "X-CSRF-Token: $CSRF" -X POST -H 'Content-Type: application/json' -d '{"amount":250000,"paymentMethod":"BANK","referenceNumber":"AUDIT-NOMFA","notes":"probe"}' "$BASE/api/suppliers/$SUP/payments")
  check "$C" 409 "large payout refused for an account with no authenticator"
  check "$(jqpy code)" "MFA_NOT_ENROLLED" "the refusal names the missing control"
  grep -qi 'টু-ফ্যাক্টর\|2FA' "$LAST" && ok "payout refusal is readable in Bangla" || bad "payout refusal has no Bangla text"
  C=$(code -b $JAR -H "X-CSRF-Token: $CSRF" -X POST -H 'Content-Type: application/json' -d '{"amount":1500,"paymentMethod":"BANK","referenceNumber":"AUDIT-OPERATOR","notes":"probe","operator":"Somebody Else"}' "$BASE/api/suppliers/$SUP/payments")
  check "$C" 200 "a small operational payment still proceeds"
  grep -q 'Somebody Else' "$LAST" && bad "the body-supplied operator name was echoed into the ledger" || ok "ledger attribution comes from the session, not the body"
else
  bad "no supplier available to probe payouts"
fi

check "$(code -b $JAR -H "X-CSRF-Token: $CSRF" -X POST -H 'Content-Type: application/json' -d '{"userEmail":"whoever@example.com","folderName":"X"}' "$BASE/api/system/drive/connect")" 409 "Google Drive cannot be 'connected' without service-account credentials"
grep -q 'GOOGLE_SERVICE_ACCOUNT_JSON' "$LAST" && ok "the refusal says what to configure" || bad "drive refusal does not name the env var"
CONNECTED=$(curl -s -b $JAR -H "X-CSRF-Token: $CSRF" "$BASE/api/system/drive/config" | python3 -c "import json,sys;print(json.load(sys.stdin).get('config',{}).get('connected'))" 2>/dev/null)
check "$CONNECTED" "False" "drive config reports the real disconnected state"
DR=$(curl -s -b $JAR -H "X-CSRF-Token: $CSRF" "$BASE/api/system/dr-metrics")
echo "$DR" | grep -q '"drillStatus":"NOT_RUN"' && ok "DR panel starts at NOT_RUN instead of a fabricated passed drill" || bad "drill status looks invented: $DR"
echo "$DR" | grep -q '"totalRestoresExecuted":0' && ok "no invented restore count" || bad "restore count is not derived from real restores"
echo "$DR" | grep -q '"activeColdStorageVault":null' && ok "cold-vault claim omitted when unconfigured" || bad "a cold vault is claimed without configuration"
USERS=$(curl -s -b $JAR -H "X-CSRF-Token: $CSRF" "$BASE/api/security/users")
UCOUNT=$(echo "$USERS" | python3 -c "import json,sys;print(len(json.load(sys.stdin).get('data',[])))" 2>/dev/null)
# With KISHOLOY_ALLOW_DEMO_DATA=true the seeder creates a small staff roster for
# the demo; the invariant that matters is that the *hardcoded legacy* accounts are
# gone and the roster is bounded, asserted by the grep below.
[ "${UCOUNT:-0}" -ge 1 ] && [ "${UCOUNT:-0}" -le 8 ] && ok "staff directory returns a bounded roster ($UCOUNT accounts)" || bad "unexpected staff roster ($UCOUNT)"
echo "$USERS" | grep -q 'admin@kisholoy.com\|KisholoySuperAdmin' && bad "seeded demo administrator still present" || ok "no seeded demo administrator in the directory"
check "$(code -b $JAR -H "X-CSRF-Token: $CSRF" -X POST -H 'Content-Type: application/json' -d '{"email":"not-an-email"}' "$BASE/api/integrations/test-email")" 422 "test email refuses an invalid recipient instead of mailing a hardcoded address"

printf '\n\033[1m%s\033[0m\n' "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
