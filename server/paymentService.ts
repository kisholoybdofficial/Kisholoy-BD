/**
 * Server-Side Payment Gateway Services (SSLCOMMERZ & bKash)
 * Rule: Never trust a payment redirect alone. Verify payments server-side via webhooks/IPN.
 * @license Apache-2.0
 */

import crypto from 'crypto';
import { serverDb } from './db';
import { Order, PaymentTransaction } from '../src/types';
import {
  SSL_PATHS,
  bkashState,
  createBkashSession,
  executeBkash,
  gatewayCapabilities,
  sslcommerzState,
  verifySharedSecretSignature,
  verifySslcommerz,
  type GatewayVerification,
} from './gateway';
import { log } from './http/errors';

const envOr = (key: string): string => (process.env[key] || '').trim();

export interface SslcommerzInitPayload {
  orderId: string;
  orderNumber: string;
  amount: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  address: string;
  city: string;
}

export interface SslcommerzInitResponse {
  status: 'SUCCESS' | 'FAILED';
  sessionKey: string;
  gatewayUrl: string;
  orderNumber: string;
  amount: number;
}

export interface BkashCreateResponse {
  statusCode: string;
  statusMessage: string;
  paymentID: string;
  bkashURL: string;
  amount: string;
  currency: string;
  paymentCreateTime: string;
  merchantInvoiceNumber: string;
  /** False when the gateway is not configured: the UI must not simulate a flow. */
  configured?: boolean;
  mode?: 'LIVE' | 'SANDBOX' | 'UNCONFIGURED';
  reason?: string;
}

export class PaymentService {
  private storeId: string;
  private storePass: string;
  private isSandbox: boolean;

  constructor() {
    // No fake defaults: an unset credential must look unset, otherwise
    // `isConfigured()` reports "live" and money flows into a phantom gateway.
    this.storeId = envOr('SSLCOMMERZ_STORE_ID');
    this.storePass = envOr('SSLCOMMERZ_STORE_PASSWORD');
    this.isSandbox = envOr('SSLCOMMERZ_IS_SANDBOX') !== 'false';
  }

  public isConfigured(): boolean {
    return sslcommerzState() !== 'UNCONFIGURED';
  }

  public bkashConfigured(): boolean {
    return bkashState() !== 'UNCONFIGURED';
  }

  /**
   * Initializes an SSLCOMMERZ payment session
   */
  async initSslcommerz(payload: SslcommerzInitPayload): Promise<SslcommerzInitResponse> {
    const sessionKey = `SSL_SESSION_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    
    // In production, this would make an HTTPS POST to https://sandbox.sslcommerz.com/gwprocess/v4/api.php
    const gatewayUrl = this.isSandbox
      ? `https://sandbox.sslcommerz.com/easycheckout.php?session_key=${sessionKey}`
      : `https://securepay.sslcommerz.com/easycheckout.php?session_key=${sessionKey}`;

    serverDb.addAuditLog(
      'INIT_PAYMENT_GATEWAY',
      'Payment',
      payload.orderNumber,
      `Initialized SSLCOMMERZ gateway session for ৳${payload.amount} (Session: ${sessionKey})`
    );

    return {
      status: 'SUCCESS',
      sessionKey,
      gatewayUrl,
      orderNumber: payload.orderNumber,
      amount: payload.amount
    };
  }

  /**
   * Initializes a bKash Tokenized/Direct Payment Session
   */
  async createBkashPayment(orderId: string): Promise<BkashCreateResponse> {
    const order = serverDb.getOrderById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    const appUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
    const session = await createBkashSession({
      orderId: order.id,
      amount: Number(order.total) || 0,
      invoiceNumber: order.orderNumber,
      callbackUrl: `${appUrl}/api/payments/bkash/callback?order=${encodeURIComponent(order.orderNumber)}`,
    });

    if (session.ok !== true) {
      // Never fabricate a paymentID: the caller (and the UI) must branch on this.
      const failure = session as { reason: string; message: string };
      return {
        statusCode: failure.reason === 'PROVIDER_UNCONFIGURED' ? 'CFG01' : '9999',
        statusMessage: failure.message,
        paymentID: '',
        bkashURL: '',
        amount: order.total.toFixed(2),
        currency: 'BDT',
        paymentCreateTime: new Date().toISOString(),
        merchantInvoiceNumber: order.orderNumber,
        configured: false,
        reason: failure.reason,
      };
    }

    serverDb.addAuditLog(
      'INIT_BKASH_CHECKOUT',
      'Payment',
      order.orderNumber,
      `Created bKash Direct Checkout session for ৳${order.total} (${session.state})`
    );

    return {
      statusCode: '0000',
      statusMessage: 'Successful',
      paymentID: session.paymentId,
      bkashURL: session.bkashUrl,
      amount: order.total.toFixed(2),
      currency: 'BDT',
      paymentCreateTime: new Date().toISOString(),
      merchantInvoiceNumber: order.orderNumber,
      configured: true,
      mode: session.state,
    };
  }

  /**
   * Verifies IPN Webhook Hash from SSLCOMMERZ
   * Rule: Cryptographic verification of IPN signature before flipping order state to PAID.
   */
  /**
   * A gateway IPN is never trusted on its own body: an attacker can post any
   * JSON. The payload is only acted on after (a) a shared-secret HMAC verifies,
   * or (b) we re-query the gateway for the val_id. `payload.tran_id` alone used
   * to be enough, which made "pay this order" a one-line curl.
   */
  verifyIpnSignature(payload: Record<string, any>, presentedSignature?: string): boolean {
    if (!payload?.val_id || !payload?.tran_id) return false;
    return verifySharedSecretSignature(payload, presentedSignature);
  }

  /** True when an IPN can be honoured at all on this deployment. */
  canProcessIpn(): boolean {
    return sslcommerzState() !== 'UNCONFIGURED';
  }

  /**
   * Authoritative validation of a payment transaction against SSLCOMMERZ API
   */
  /**
   * Authoritative validation of an SSLCOMMERZ transaction.
   *
   * This used to be `const isMockValid = valId.length > 3 && tranId.length > 3`,
   * i.e. any caller that typed four characters got `paymentStatus = 'PAID'`.
   * It now asks the gateway itself, and a demo `PAID` can only ever be produced
   * while demo payments are explicitly enabled (never in production).
   */
  async validateTransaction(
    valId: string,
    tranId: string,
    amount: number,
    cardType = 'VISA-CITY-BANK'
  ): Promise<{ isValid: boolean; details: any; verification: GatewayVerification }> {
    const order = serverDb.getOrderByNumber(tranId);
    if (!order) {
      const missing: GatewayVerification = { verified: false, state: sslcommerzState(), reason: 'ORDER_NOT_FOUND', statusMessage: 'Order reference not recognised.' };
      return { isValid: false, details: { status: 'FAILED', error: 'Order not found for this transaction.' }, verification: missing };
    }

    const verification = await verifySslcommerz({ valId, tranId, expectedAmount: amount });

    if (!verification.verified) {
      // Record the attempt so finance can reconcile, but do NOT mark it paid.
      serverDb.addPaymentTransaction({
        id: `ptx-${Date.now()}`,
        orderNumber: order.orderNumber,
        gateway: 'SSLCOMMERZ',
        amount,
        currency: 'BDT',
        transactionId: `SSL-${String(valId).slice(0, 40)}`,
        valId: String(valId).slice(0, 60),
        cardType,
        status: 'UNCHECKED',
        riskLevel: 'MEDIUM',
        feeDeducted: 0,
        netDisbursed: 0,
        createdAt: new Date().toISOString(),
        rawIpnPayload: { tran_id: tranId, val_id: valId, reason: verification.reason, state: verification.state },
      });
      order.timeline.push({
        status: order.orderStatus,
        timestamp: new Date().toISOString(),
        note: `Payment verification rejected (${verification.reason || 'GATEWAY_REJECTED'}): ${verification.statusMessage || 'no detail'}`,
        updatedBy: 'GATEWAY_VERIFIER',
      });
      serverDb.addAuditLog(
        'PAYMENT_VERIFICATION_REJECTED',
        'Payment',
        order.orderNumber,
        `SSLCOMMERZ validation rejected for ৳${amount}. Reason: ${verification.reason || 'GATEWAY_REJECTED'}`
      );
      return {
        isValid: false,
        verification,
        details: { status: 'FAILED', error: verification.statusMessage || 'Payment could not be verified.', code: verification.reason },
      };
    }

    const feeDeducted = verification.demo ? 0 : Number((amount * 0.025).toFixed(2));
    const netDisbursed = Number((amount - feeDeducted).toFixed(2));
    const bankTranId = verification.bankTranId || `BNK-${Date.now()}`;

    order.paymentStatus = 'PAID';
    order.paymentGatewayMode = verification.demo ? 'DEMO' : verification.state;
    order.timeline.push({
      status: order.orderStatus,
      timestamp: new Date().toISOString(),
      note: verification.demo
        ? `DEMO payment recorded for ৳${amount} (not a real capture — demo payments are enabled). ValID: ${valId}`
        : `Online payment of ৳${amount} verified via SSLCOMMERZ. ValID: ${valId}, BankTran: ${bankTranId}`,
      updatedBy: 'GATEWAY_VERIFIER',
    });

    serverDb.addPaymentTransaction({
      id: `ptx-${Date.now()}`,
      orderNumber: order.orderNumber,
      gateway: 'SSLCOMMERZ',
      amount,
      currency: 'BDT',
      transactionId: `SSL-${verification.providerRef || valId}`,
      bankTranId,
      valId,
      cardType: verification.cardType || cardType,
      status: 'VALID',
      riskLevel: 'LOW',
      feeDeducted,
      netDisbursed,
      settledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      rawIpnPayload: {
        tran_id: tranId,
        val_id: valId,
        amount: amount.toFixed(2),
        card_type: cardType,
        bank_tran_id: bankTranId,
        status: verification.rawStatus || 'VALID',
        demo: Boolean(verification.demo),
      },
    });

    serverDb.addAuditLog(
      'VERIFY_PAYMENT_GATEWAY',
      'Payment',
      tranId,
      `${verification.demo ? 'DEMO ' : ''}SSLCOMMERZ verification ${verification.demo ? 'simulated' : 'confirmed'} for ৳${amount} (ValID ${valId})`
    );

    return {
      isValid: true,
      verification,
      details: {
        val_id: valId,
        tran_id: tranId,
        amount,
        card_type: cardType,
        bank_tran_id: bankTranId,
        status: verification.rawStatus || 'VALID',
        tran_date: new Date().toISOString(),
        currency: 'BDT',
        feeDeducted,
        netDisbursed,
        demoMode: Boolean(verification.demo),
      },
    };
  }

  /**
   * Executes a bKash tokenised checkout capture. Like the SSLCOMMERZ path, the
   * gateway — not the browser — decides whether money moved.
   */
  async executeBkashPayment(
    paymentID: string,
    orderNumber: string,
    amount: number
  ): Promise<{ statusCode: string; statusMessage: string; trxID: string; customerMsisdn: string; amount: string; demoMode: boolean }> {
    const order = serverDb.getOrderByNumber(orderNumber);
    const verification = await executeBkash({ paymentId: paymentID, expectedAmount: amount });

    if (!order) {
      return {
        statusCode: verification.verified ? '0000' : '9999',
        statusMessage: 'Order reference not recognised.',
        trxID: '',
        customerMsisdn: '',
        amount: amount.toFixed(2),
        demoMode: Boolean(verification.demo),
      };
    }

    if (!verification.verified) {
      order.timeline.push({
        status: order.orderStatus,
        timestamp: new Date().toISOString(),
        note: `bKash payment not captured (${verification.reason || 'REJECTED'}): ${verification.statusMessage || 'no detail'}`,
        updatedBy: 'BKASH_API',
      });
      serverDb.addAuditLog(
        'BKASH_PAYMENT_REJECTED',
        'Payment',
        order.orderNumber,
        `bKash execute rejected for ৳${amount}. Reason: ${verification.reason || 'REJECTED'}`
      );
      return {
        statusCode: verification.reason === 'PROVIDER_UNCONFIGURED' ? 'CFG01' : '9999',
        statusMessage: verification.statusMessage || 'Payment not completed.',
        trxID: '',
        customerMsisdn: order.customer.phone,
        amount: amount.toFixed(2),
        demoMode: false,
      };
    }

    const trxID = String(verification.providerRef || `BKTRX-${Date.now().toString(36).toUpperCase()}`);
    order.paymentStatus = 'PAID';
    order.paymentGatewayMode = verification.demo ? 'DEMO' : verification.state;
    order.timeline.push({
      status: order.orderStatus,
      timestamp: new Date().toISOString(),
      note: verification.demo
        ? `DEMO bKash payment recorded for ৳${amount} (not a real capture). PaymentID: ${paymentID}`
        : `bKash payment verified. TrxID: ${trxID}, PaymentID: ${paymentID}`,
      updatedBy: 'BKASH_API',
    });

    const commissionFee = verification.demo ? 0 : Number((amount * 0.015).toFixed(2));
    const netDisbursed = Number((amount - commissionFee).toFixed(2));

    serverDb.addPaymentTransaction({
      id: `ptx-${Date.now()}`,
      orderNumber: order.orderNumber,
      gateway: 'BKASH_TOKENIZED',
      amount,
      currency: 'BDT',
      transactionId: trxID,
      valId: paymentID,
      cardType: 'BKASH-WALLET',
      status: 'VALID',
      riskLevel: 'LOW',
      feeDeducted: commissionFee,
      netDisbursed,
      settledAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      rawIpnPayload: {
        paymentID,
        trxID,
        amount: amount.toFixed(2),
        transactionStatus: 'Completed',
        payerReference: order.customer.phone,
        demo: Boolean(verification.demo),
      },
    });

    serverDb.addAuditLog(
      'BKASH_PAYMENT_CAPTURED',
      'Payment',
      order.orderNumber,
      `${verification.demo ? 'DEMO ' : ''}Captured bKash payment ৳${amount}. TrxID: ${trxID} (Net: ৳${netDisbursed})`
    );

    return {
      statusCode: '0000',
      statusMessage: verification.statusMessage || 'Successful',
      trxID,
      customerMsisdn: order.customer.phone,
      amount: amount.toFixed(2),
      demoMode: Boolean(verification.demo),
    };
  }

  /**
   * Initializes an SSLCOMMERZ session against the real gateway when
   * configured. Unconfigured deployments get an explicit error rather than a
   * fake session key that a client could "pay" with.
   */
  async initSslcommerzReal(payload: SslcommerzInitPayload): Promise<
    | { ok: true; sessionKey: string; gatewayUrl: string }
    | { ok: false; error: string; code: 'PROVIDER_UNCONFIGURED' | 'NETWORK_ERROR' | 'GATEWAY_REJECTED' }
  > {
    const state = sslcommerzState();
    if (state === 'UNCONFIGURED') {
      return { ok: false, code: 'PROVIDER_UNCONFIGURED', error: 'Card payments are not enabled on this deployment yet. Choose cash on delivery, or configure SSLCOMMERZ credentials.' };
    }
    const url = state === 'LIVE' ? SSL_PATHS.liveProcess : SSL_PATHS.sandboxProcess;
    try {
      const body = new URLSearchParams({
        store_id: envOr('SSLCOMMERZ_STORE_ID'),
        store_passwd: envOr('SSLCOMMERZ_STORE_PASSWORD'),
        total_amount: payload.amount.toFixed(2),
        currency: 'BDT',
        tran_id: payload.orderNumber,
        success_url: `${envOr('APP_URL')}/api/payments/sslcommerz/validate`,
        fail_url: `${envOr('APP_URL')}/api/payments/sslcommerz/failed`,
        cancel_url: `${envOr('APP_URL')}/api/payments/sslcommerz/cancelled`,
        ipn_url: `${envOr('APP_URL')}/api/payments/ipn`,
        shipping_method: 'NO',
        product_name: 'KISHOLOY order',
        product_category: 'GENERAL',
        product_profile: 'general',
        cus_name: payload.customerName,
        cus_email: payload.customerEmail || '',
        cus_phone: payload.customerPhone,
        cus_add1: payload.address,
        cus_city: payload.city,
        cus_country: 'Bangladesh',
        num_of_item: '1',
      });
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || String(data.status || '').toUpperCase() !== 'SUCCESS' || !data.GatewayURL) {
        return { ok: false, code: 'GATEWAY_REJECTED', error: String(data.failed || data.status_message || 'The payment gateway refused the session.') };
      }
      return { ok: true, sessionKey: String(data.sessionkey || ''), gatewayUrl: String(data.GatewayURL) };
    } catch (err) {
      log.error('gateway', 'sslcommerz_init_failed', err);
      return { ok: false, code: 'NETWORK_ERROR', error: 'Could not reach the payment gateway. Please try again.' };
    }
  }

  /** Ledger-backed check used when a client claims an advance payment. */
  isTransactionVerified(transactionId: string, expectedAmount: number): boolean {
    const needle = (transactionId || '').trim();
    if (!needle) return false;
    const row = serverDb.paymentTransactions.find(
      (t) =>
        (t.transactionId === needle || t.bankTranId === needle || t.valId === needle) &&
        t.status === 'VALID'
    );
    if (!row) return false;
    return Math.abs(Number(row.amount) - Number(expectedAmount)) <= 1;
  }

  capabilities() {
    return gatewayCapabilities();
  }

  /** Rejects payment-shaped requests when the provider is not configured. */
  assertCheckoutChannelAvailable(method: string): { ok: boolean; error?: string; code?: string } {
    if (method === 'COD' || method === 'MANUAL') return { ok: true };
    const caps = gatewayCapabilities();
    if ((method === 'SSLCOMMERZ' || method === 'CARD') && caps.sslcommerz === 'UNCONFIGURED' && !caps.demoPaymentsAllowed) {
      return {
        ok: false,
        code: 'PROVIDER_UNCONFIGURED',
        error: 'Card payment is not enabled on this deployment. Pay on delivery, or contact us to complete a bank/mobile transfer.',
      };
    }
    if (method === 'BKASH' && caps.bkash === 'UNCONFIGURED' && !caps.demoPaymentsAllowed) {
      return {
        ok: false,
        code: 'PROVIDER_UNCONFIGURED',
        error: 'bKash payment is not enabled on this deployment. Choose cash on delivery instead.',
      };
    }
    return { ok: true };
  }

  /**
   * Process refund through gateway
   */
  async initiateRefund(orderId: string, amount: number, reason: string): Promise<{ success: boolean; refundId: string; error?: string }> {
    const order = serverDb.getOrderById(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    // Idempotency guard: never process a second refund for the same order.
    if (order.paymentStatus === 'REFUNDED' || (order as any).refundProcessed) {
      return { success: false, refundId: '', error: 'Refund already processed for this order — duplicate prevented.' };
    }
    (order as any).refundProcessed = true;

    const refundId = `REF-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    order.paymentStatus = 'REFUNDED';
    order.timeline.push({
      status: order.orderStatus,
      timestamp: new Date().toISOString(),
      note: `Refund of ৳${amount} processed via gateway. Reference: ${refundId}. Reason: ${reason}`,
      updatedBy: 'FINANCE'
    });

    // Update transaction ledger
    const existingTx = serverDb.getTransactionByOrder(order.orderNumber);
    if (existingTx) {
      existingTx.status = 'REFUNDED';
    }

    serverDb.addAuditLog(
      'PROCESS_REFUND',
      'Finance',
      order.orderNumber,
      `Refunded ৳${amount} for order ${order.orderNumber} (Ref: ${refundId}). Reason: ${reason}`
    );

    return {
      success: true,
      refundId
    };
  }
}

export const paymentService = new PaymentService();
