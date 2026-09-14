/**
 * Step-up verification for irreversible, money-moving actions.
 *
 * Background (why this module exists at all): supplier payouts used to be
 * authorised by `securityEngine.verifyMfaForAction()`, which accepted **any**
 * six digits, and the routes wrapped the call in `if (amount >= 50000 &&
 * mfaCode)` — i.e. simply omitting the field skipped the check entirely, while
 * the `operator` recorded in the ledger came from the request body and could be
 * anyone's name. Money could leave the business with no second factor and a
 * forged audit attribution.
 *
 * The rules here are deliberately fail-closed:
 *
 * | account state                       | amount        | outcome                       |
 * | ----------------------------------- | ------------- | ----------------------------- |
 * | not signed in                       | any           | 401 STAFF_AUTH_REQUIRED       |
 * | 2FA enrolled, code valid            | any           | allowed (audited)             |
 * | 2FA enrolled, code wrong or missing  | any           | 401 STEP_UP_*                 |
 * | 2FA not enrolled                    | ≥ threshold   | 409 MFA_NOT_ENROLLED          |
 * | 2FA not enrolled                    | < threshold   | allowed, audited as unguarded |
 *
 * A large payout can never proceed on an account that has no authenticator, so
 * "just leave the field out" is not an option; and small operational actions do
 * not become unavailable on a deployment where nobody has enrolled yet.
 *
 * @license Apache-2.0
 */

import { verifyTotp } from './totp';
import type { StaffAccount } from './staffStore';

export const DEFAULT_PAYOUT_THRESHOLD_BDT = 50000;

/** Configurable so a finance team can lower it, never so it can be skipped. */
export function payoutStepUpThreshold(): number {
  const raw = Number.parseInt(String(process.env.KISHOLOY_PAYOUT_MFA_THRESHOLD_BDT ?? '').trim(), 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_PAYOUT_THRESHOLD_BDT;
}

export interface StepUpInput {
  /** The authenticated staff account from the request, never from the body. */
  account: StaffAccount | undefined | null;
  code: unknown;
  /** Machine name of the protected action, e.g. `SUPPLIER_PAYOUT`. */
  action: string;
  /** Amount moving, in BDT. `0`/undefined is treated as below threshold. */
  amount?: number;
  ip?: string;
  /** Optional hook so callers can reuse the engine's audit sink. */
  audit?: (entry: {
    operator: string;
    role: string;
    action: string;
    severity: 'INFO' | 'WARNING' | 'SECURITY_ALERT';
    resource: string;
    resourceId: string;
    details: string;
    ipAddress?: string;
  }) => void;
}

export interface StepUpResult {
  ok: boolean;
  status: number;
  code: string;
  error?: string;
  errorBn?: string;
  /** True when the action was allowed *without* a second factor (small amount). */
  unguarded?: boolean;
}

const cleanCode = (raw: unknown): string => String(raw ?? '').replace(/[\s-]/g, '').trim();

export function requireStepUp(input: StepUpInput): StepUpResult {
  const { account, action, ip, audit } = input;

  if (!account || !account.id) {
    return {
      ok: false,
      status: 401,
      code: 'STAFF_AUTH_REQUIRED',
      error: 'A signed-in staff session is required for this action.',
      errorBn: 'এই কাজটির জন্য লগইন করা স্টাফ সেশন প্রয়োজন।',
    };
  }

  const amount = Number.isFinite(Number(input.amount)) ? Math.max(0, Number(input.amount)) : 0;
  const threshold = payoutStepUpThreshold();
  const enrolled = Boolean(account.twoFactorEnabled && account.totpSecret);
  const code = cleanCode(input.code);

  const record = (action_: string, severity: 'INFO' | 'WARNING' | 'SECURITY_ALERT', details: string) => {
    try {
      audit?.({
        operator: account.name || account.id,
        role: account.role,
        action: action_,
        severity,
        resource: 'StaffAccount',
        resourceId: account.id,
        details,
        ipAddress: ip,
      });
    } catch {
      /* auditing must never block a decision it is describing */
    }
  };

  if (!enrolled) {
    if (amount >= threshold) {
      record('STEP_UP_DENIED_NO_MFA', 'SECURITY_ALERT', `${action} of BDT ${amount} refused: no authenticator enrolled.`);
      return {
        ok: false,
        status: 409,
        code: 'MFA_NOT_ENROLLED',
        error: `A payout of BDT ${amount.toLocaleString('en-IN')} or more requires two-factor authentication. Enrol an authenticator on your account, then confirm with the six-digit code.`,
        errorBn: `৳${amount.toLocaleString('bn-BD')} বা তার বেশি পেমেন্ট দিতে হলে টু-ফ্যাক্টর (2FA) চালু থাকতে হবে। আগে অ্যাকাউন্টে অথেনটিকেটর যুক্ত করে ছয় সংখ্যার কোড দিন।`,
      };
    }
    record('SENSITIVE_ACTION_UNGUARDED', 'WARNING', `${action} of BDT ${amount} allowed without step-up (below threshold, no 2FA).`);
    return { ok: true, status: 200, code: 'ALLOWED', unguarded: true };
  }

  if (!code) {
    record('STEP_UP_REQUIRED', 'WARNING', `${action} of BDT ${amount} blocked: no step-up code supplied.`);
    return {
      ok: false,
      status: 401,
      code: 'STEP_UP_REQUIRED',
      error: 'Enter the six-digit code from your authenticator to authorise this payment.',
      errorBn: 'এই পেমেন্ট অনুমোদন করতে অ্যাকাউন্টরেটরের ছয় সংখ্যার কোডটি দিন।',
    };
  }

  if (!verifyTotp(account.totpSecret!, code)) {
    record('STEP_UP_MFA_FAILED', 'SECURITY_ALERT', `Invalid step-up code presented for ${action} (BDT ${amount}).`);
    return {
      ok: false,
      status: 401,
      code: 'STEP_UP_FAILED',
      error: 'The verification code is incorrect or has expired. Generate a fresh code and try again.',
      errorBn: 'কোডটি ভুল বা মেয়াদোত্তীর্ণ। নতুন কোড তৈরি করে আবার চেষ্টা করুন।',
    };
  }

  record('STEP_UP_MFA_VERIFIED', 'INFO', `Step-up verification passed for ${action} (BDT ${amount}).`);
  return { ok: true, status: 200, code: 'VERIFIED' };
}

/**
 * The operator recorded in money ledgers must be whoever the session belongs
 * to. Reading `req.body.operator` instead let a caller attribute an action to a
 * colleague, which destroys the evidential value of the audit trail.
 */
export function sessionOperatorOf(auth: { userName?: string; userId?: string } | undefined): string {
  return auth?.userName || auth?.userId || 'UNKNOWN_STAFF';
}
