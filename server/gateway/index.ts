/**
 * Real payment-gateway client (SSLCOMMERZ + bKash tokenised checkout).
 *
 * Before this module existed, "verification" was theatre:
 *   - `validateTransaction()` accepted any `val_id` longer than 3 characters
 *     and set `order.paymentStatus = 'PAID'`;
 *   - `executeBkashPayment()` never called bKash, invented a `trxID`, and set
 *     `PAID`;
 *   - `verifyIpnSignature()` returned true when `tran_id` started with `KSH-`.
 *     So `curl -d '{"tran_id":"KSH-1","val_id":"x"}' /api/payments/ipn` turned
 *     an unpaid order into a paid one, which then flowed into revenue, courier
 *     dispatch and supplier settlement.
 *
 * Now the rule is absolute: **money is only "paid" when the gateway itself says
 * so over a server-to-server call.** When credentials are absent the platform
 * reports `PROVIDER_UNCONFIGURED`, records the claim as UNVERIFIED, and leaves
 * the order awaiting payment — except in an explicitly enabled demo mode.
 *
 * @license Apache-2.0
 */

import crypto from 'node:crypto';
import { config } from '../config';
import { log } from '../http/errors';

export type GatewayState = 'LIVE' | 'SANDBOX' | 'UNCONFIGURED';

export interface GatewayVerification {
  /** The gateway confirmed a successful capture of this exact amount. */
  verified: boolean;
  state: GatewayState;
  /** True when the platform faked a success because demo mode is enabled. */
  demo?: boolean;
  providerRef?: string;
  bankTranId?: string;
  amount?: number;
  currency?: string;
  cardType?: string;
  statusMessage?: string;
  rawStatus?: string;
  /** Machine-readable reason when `verified` is false. */
  reason?:
    | 'PROVIDER_UNCONFIGURED'
    | 'DEMO_MODE_DISABLED'
    | 'GATEWAY_REJECTED'
    | 'AMOUNT_MISMATCH'
    | 'ORDER_NOT_FOUND'
    | 'NETWORK_ERROR'
    | 'MALFORMED_REFERENCE';
}

export interface GatewayCapabilities {
  sslcommerz: GatewayState;
  bkash: GatewayState;
  nagad: GatewayState;
  demoPaymentsAllowed: boolean;
  ipnSharedSecretConfigured: boolean;
}

export const SSL_PATHS = {
  sandboxProcess: 'https://sandbox.sslcommerz.com/gwprocess/v5/api.php',
  liveProcess: 'https://securepay.sslcommerz.com/gwprocess/v5/api.php',
  sandboxValidate: 'https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php',
  liveValidate: 'https://securepay.sslcommerz.com/validator/api/validationserverAPI.php',
  sandboxRefund: 'https://sandbox.sslcommerz.com/validator/api/refund-API.php',
  liveRefund: 'https://securepay.sslcommerz.com/validator/api/refund-API.php',
};

const BKASH_PATHS = {
  sandboxToken: 'https://tokenized.sandbox.bka.sh/v1.2.0-beta/tokenized/checkout',
  liveToken: 'https://tokenized.pay.bka.sh/v1.2.0-beta/tokenized/checkout',
};

const env = (k: string): string => (process.env[k] || '').trim();
const timeoutFetch = async (url: string, init: RequestInit, ms = 12_000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export function sslcommerzState(): GatewayState {
  const id = env('SSLCOMMERZ_STORE_ID');
  const pass = env('SSLCOMMERZ_STORE_PASSWORD');
  if (!id || !pass) return 'UNCONFIGURED';
  return env('SSLCOMMERZ_IS_SANDBOX') === 'false' ? 'LIVE' : 'SANDBOX';
}

export function bkashState(): GatewayState {
  const ready = Boolean(env('BKASH_APP_KEY') && env('BKASH_APP_SECRET') && env('BKASH_USERNAME') && env('BKASH_PASSWORD'));
  if (!ready) return 'UNCONFIGURED';
  return env('BKASH_IS_SANDBOX') === 'false' ? 'LIVE' : 'SANDBOX';
}

export function gatewayCapabilities(): GatewayCapabilities {
  return {
    sslcommerz: sslcommerzState(),
    bkash: bkashState(),
    nagad: 'UNCONFIGURED',
    demoPaymentsAllowed: config.security.allowDemoPayments,
    ipnSharedSecretConfigured: Boolean(env('KISHOLOY_IPN_SECRET')),
  };
}

/**
 * Server-to-server validation of an SSLCOMMERZ transaction.
 *
 * Amount is compared against the value the gateway reports; a mismatch is
 * treated as a rejection (this is the classic "pay ৳10 for a ৳10,000 order"
 * attack on integrations that only check status).
 */
export async function verifySslcommerz(input: {
  valId: string;
  tranId: string;
  expectedAmount: number;
}): Promise<GatewayVerification> {
  const state = sslcommerzState();
  const valId = (input.valId || '').trim();
  const tranId = (input.tranId || '').trim();

  if (valId.length < 6 || tranId.length < 4) {
    return { verified: false, state, reason: 'MALFORMED_REFERENCE', statusMessage: 'Validation reference is malformed.' };
  }

  if (state === 'UNCONFIGURED') {
    if (!config.security.allowDemoPayments) {
      return { verified: false, state, reason: 'PROVIDER_UNCONFIGURED', statusMessage: 'Payment gateway credentials are not configured on this deployment.' };
    }
    // Explicit, flagged demo success (development/test only).
    return {
      verified: true,
      state,
      demo: true,
      providerRef: `DEMO-${crypto.createHash('sha1').update(`${valId}|${tranId}`).digest('hex').slice(0, 12).toUpperCase()}`,
      bankTranId: `DEMO-BNK-${Date.now()}`,
      amount: input.expectedAmount,
      currency: 'BDT',
      cardType: 'DEMO',
      rawStatus: 'VALIDATED',
      statusMessage: 'Demo mode: not a real payment. Do not ship against this.',
    };
  }

  const url = state === 'LIVE' ? SSL_PATHS.liveValidate : SSL_PATHS.sandboxValidate;
  const body = new URLSearchParams({ val_id: valId, store_id: env('SSLCOMMERZ_STORE_ID'), verify_key: env('SSLCOMMERZ_STORE_PASSWORD') });

  let payload: Record<string, unknown>;
  try {
    const response = await timeoutFetch(`${url}?${body.toString()}`, { method: 'GET', headers: { Accept: 'application/json' } });
    payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      return { verified: false, state, reason: 'NETWORK_ERROR', statusMessage: `Gateway responded ${response.status}.` };
    }
  } catch (err) {
    log.error('gateway', 'sslcommerz_validation_failed', err);
    return { verified: false, state, reason: 'NETWORK_ERROR', statusMessage: 'Could not reach the payment gateway.' };
  }

  const status = String(payload.status || payload.result_code || '').toUpperCase();
  const gatewayAmount = Number(payload.amount || payload.currency_amount || 0);
  const gwTranId = String(payload.tran_id || payload.gateway_tran_id || '');
  const verifiedStatuses = new Set(['VALID', 'VALIDATED']);

  if (!verifiedStatuses.has(status)) {
    return { verified: false, state, rawStatus: status, statusMessage: String(payload.status_message || 'Gateway reported a non-successful state.') };
  }
  if (gwTranId && gwTranId !== tranId && String(payload.val_id || '') !== valId) {
    return { verified: false, state, reason: 'GATEWAY_REJECTED', statusMessage: 'Gateway response does not match this order.' };
  }
  if (Number.isFinite(gatewayAmount) && gatewayAmount > 0 && Math.abs(gatewayAmount - input.expectedAmount) > 1) {
    return {
      verified: false,
      state,
      reason: 'AMOUNT_MISMATCH',
      amount: gatewayAmount,
      statusMessage: `Gateway captured ৳${gatewayAmount}, order total is ৳${input.expectedAmount}.`,
    };
  }

  return {
    verified: true,
    state,
    providerRef: String(payload.val_id || valId),
    bankTranId: String(payload.bank_tran_id || payload.gateway_tran_id || ''),
    amount: gatewayAmount || input.expectedAmount,
    currency: String(payload.currency || 'BDT'),
    cardType: String(payload.card_type || payload.card_name || ''),
    rawStatus: status,
    statusMessage: String(payload.status_message || 'Validated'),
  };
}

async function bkashGrantToken(state: GatewayState): Promise<string | null> {
  const base = state === 'LIVE' ? BKASH_PATHS.liveToken : BKASH_PATHS.sandboxToken;
  try {
    const response = await timeoutFetch(`${base}/token/grant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-APP-Key': env('BKASH_APP_KEY'),
      },
      body: JSON.stringify({
        app_key: env('BKASH_APP_KEY'),
        app_secret: env('BKASH_APP_SECRET'),
        username: env('BKASH_USERNAME'),
        password: env('BKASH_PASSWORD'),
        grant_type: 'client_credentials',
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { id_token?: string };
    return data.id_token || null;
  } catch (err) {
    log.error('gateway', 'bkash_token_grant_failed', err);
    return null;
  }
}

/**
 * Creates a bKash tokenised checkout session. When credentials are absent this
 * returns an explicit `NOT_CONFIGURED` result instead of inventing a payment id,
 * so the UI can offer Send Money / COD rather than a simulated success.
 */
export async function createBkashSession(input: {
  orderId: string;
  amount: number;
  invoiceNumber: string;
  callbackUrl: string;
}): Promise<
  | { ok: true; state: GatewayState; paymentId: string; bkashUrl: string }
  | { ok: false; state: GatewayState; reason: 'PROVIDER_UNCONFIGURED' | 'NETWORK_ERROR' | 'GATEWAY_REJECTED'; message: string }
> {
  const state = bkashState();
  if (state === 'UNCONFIGURED') {
    return { ok: false, state, reason: 'PROVIDER_UNCONFIGURED', message: 'bKash credentials are not configured on this deployment.' };
  }
  const token = await bkashGrantToken(state);
  if (!token) return { ok: false, state, reason: 'NETWORK_ERROR', message: 'bKash authentication failed.' };

  const base = state === 'LIVE' ? BKASH_PATHS.liveToken : BKASH_PATHS.sandboxToken;
  try {
    const response = await timeoutFetch(`${base}/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-APP-Key': env('BKASH_APP_KEY'),
      },
      body: JSON.stringify({
        mode: '001',
        payerReference: input.orderId,
        callbackURL: input.callbackUrl,
        amount: input.amount.toFixed(2),
        currency: 'BDT',
        intent: 'sale',
        merchantInvoiceNumber: input.invoiceNumber,
      }),
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok || !data.paymentID) {
      return { ok: false, state, reason: 'GATEWAY_REJECTED', message: String(data.statusMessage || `bKash responded ${response.status}.`) };
    }
    return {
      ok: true,
      state,
      paymentId: String(data.paymentID),
      bkashUrl: String(data.bkashURL || `${base}/checkout.html?paymentID=${String(data.paymentID)}`),
    };
  } catch (err) {
    log.error('gateway', 'bkash_create_failed', err);
    return { ok: false, state, reason: 'NETWORK_ERROR', message: 'Could not reach bKash.' };
  }
}

/** Executes (captures) a bKash payment and returns the gateway's own verdict. */
export async function executeBkash(input: { paymentId: string; expectedAmount: number }): Promise<GatewayVerification> {
  const state = bkashState();
  const paymentId = (input.paymentId || '').trim();
  if (!paymentId) return { verified: false, state, reason: 'MALFORMED_REFERENCE', statusMessage: 'Missing bKash payment id.' };

  if (state === 'UNCONFIGURED') {
    if (!config.security.allowDemoPayments) {
      return { verified: false, state, reason: 'PROVIDER_UNCONFIGURED', statusMessage: 'bKash credentials are not configured on this deployment.' };
    }
    return {
      verified: true,
      state,
      demo: true,
      providerRef: `DEMO-${crypto.createHash('sha1').update(paymentId).digest('hex').slice(0, 10).toUpperCase()}`,
      amount: input.expectedAmount,
      currency: 'BDT',
      cardType: 'BKASH-WALLET-DEMO',
      rawStatus: '0000',
      statusMessage: 'Demo mode: not a real payment. Do not ship against this.',
    };
  }

  const token = await bkashGrantToken(state);
  if (!token) return { verified: false, state, reason: 'NETWORK_ERROR', statusMessage: 'bKash authentication failed.' };

  const base = state === 'LIVE' ? BKASH_PATHS.liveToken : BKASH_PATHS.sandboxToken;
  let payload: Record<string, unknown>;
  try {
    const response = await timeoutFetch(`${base}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-APP-Key': env('BKASH_APP_KEY'),
      },
      body: JSON.stringify({ paymentID: paymentId }),
    });
    payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) return { verified: false, state, reason: 'NETWORK_ERROR', statusMessage: `bKash responded ${response.status}.` };
  } catch (err) {
    log.error('gateway', 'bkash_execute_failed', err);
    return { verified: false, state, reason: 'NETWORK_ERROR', statusMessage: 'Could not reach bKash.' };
  }

  const statusCode = String(payload.statusCode || '');
  const invoice = String(payload.merchantInvoiceNumber || '');
  const trxAmount = Number(payload.amount || 0);

  if (statusCode !== '0000' || !payload.trxID) {
    return { verified: false, state, rawStatus: statusCode, statusMessage: String(payload.statusMessage || 'Payment not completed.') };
  }
  if (Number.isFinite(trxAmount) && trxAmount > 0 && Math.abs(trxAmount - input.expectedAmount) > 1) {
    return {
      verified: false,
      state,
      reason: 'AMOUNT_MISMATCH',
      amount: trxAmount,
      statusMessage: `bKash captured ৳${trxAmount}, order total is ৳${input.expectedAmount}.`,
    };
  }

  return {
    verified: true,
    state,
    providerRef: String(payload.trxID),
    bankTranId: String(payload.trxID),
    amount: trxAmount || input.expectedAmount,
    currency: String(payload.currencyCode || 'BDT'),
    cardType: 'BKASH-WALLET',
    rawStatus: statusCode,
    statusMessage: String(payload.statusMessage || 'Successful'),
  };
}

/**
 * HMAC proof for courier/gateway webhooks that do not carry their own
 * signature. When `KISHOLOY_IPN_SECRET` is set, a request must present
 * `x-kisholoy-signature`; otherwise the callback is only logged, never applied.
 */
export function verifySharedSecretSignature(payload: unknown, presented: string | undefined): boolean {
  const secret = env('KISHOLOY_IPN_SECRET');
  if (!secret) return false;
  if (!presented) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload ?? {}))
    .digest('hex');
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const gatewayConstants = { SSL_PATHS, BKASH_PATHS };
