/**
 * Customer (shopper) authentication.
 *
 * What this replaces: `POST /api/customer/auth/login` looked a customer up by
 * email or phone and, having compared **nothing**, immediately issued a session
 * token for that account. Anyone who knew (or guessed) a shopper's phone number
 * — which the platform prints on invoices and courier labels — owned their
 * account. Registration likewise stored no credential at all, and
 * `AccountPage.tsx` shipped "1-Click Demo Account" buttons that authenticated
 * as `cust-1` with no password.
 *
 * Now: credentials are required, salted-hashed (scrypt), verified in constant
 * time, and the reset flow only claims delivery when a provider really accepted
 * the message.
 *
 * @license Apache-2.0
 */

import crypto from 'node:crypto';
import { config } from '../config';
import { log } from '../http/errors';
import { mintSessionToken, revocations, verifySessionPayload, type SessionPayload } from '../sessionTokens';
import { hashPassword, passwordPolicyError, verifyPassword } from './passwords';
import { issueNumericCode, oneTimeCodes } from './totp';
import { persistence } from '../persistence/store';
import { serverDb } from '../db';
import { normalizeBdMobilePhone } from '../../src/lib/phone';

/** Credentials-bearing fields that must never leave the server. */
const CUSTOMER_PRIVATE_FIELDS = ['passwordHash', 'salt', 'resetCodeHash'] as const;

export interface CustomerAuthFields {
  passwordHash?: string;
  passwordUpdatedAt?: string;
  mustChangePassword?: boolean;
  sessionsInvalidBefore?: number;
  emailVerified?: boolean;
  lastLoginAt?: string;
  phoneCanonical?: string;
}

type CustomerWithAuth = Record<string, unknown> & CustomerAuthFields & { id: string; email: string; phone: string; name: string };

export function publicCustomer<T extends object>(customer: T): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...(customer as Record<string, unknown>) };
  for (const field of CUSTOMER_PRIVATE_FIELDS) delete copy[field];
  return copy;
}

const findRecord = (identifier: string): CustomerWithAuth | undefined => {
  const needle = (identifier || '').trim().toLowerCase();
  if (!needle) return undefined;
  const phone = normalizeBdMobilePhone(needle);
  const list = serverDb.customers as unknown as CustomerWithAuth[];
  return list.find((c) => {
    if (!c) return false;
    if ((c.email || '').toLowerCase() === needle) return true;
    const canonical = c.phoneCanonical || normalizeBdMobilePhone(c.phone || '');
    return Boolean(phone && canonical && canonical === phone);
  });
};

class CustomerAuthService {
  /**
   * Registration. Returns a live session so the shopper lands signed in.
   * Rejects duplicates on either identifier, and enforces the same password
   * policy as staff accounts.
   */
  async register(input: {
    name: string;
    phone: string;
    email?: string;
    password: string;
    address?: string;
    district?: string;
    source?: string;
  }): Promise<
    | { success: true; customer: Record<string, unknown>; token: string; csrf: string }
    | { success: false; error: string; errorBn: string }
  > {
    const name = (input.name || '').trim();
    if (name.length < 2) {
      return { success: false, error: 'Please provide your full name (at least 2 characters).', errorBn: 'অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন (কমপক্ষে ২ অক্ষর)।' };
    }
    const phoneCanonical = normalizeBdMobilePhone(input.phone || '');
    if (!phoneCanonical) {
      return { success: false, error: 'A valid Bangladeshi mobile number is required (e.g. 01712345678).', errorBn: 'সঠিক বাংলাদেশি মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।' };
    }
    const email = (input.email || '').trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { success: false, error: 'That email address does not look valid.', errorBn: 'ইমেইল ঠিকানাটি সঠিক মনে হচ্ছে না।' };
    }
    const policy = passwordPolicyError(input.password, 'Password');
    if (policy) return { success: false, error: policy, errorBn: 'পাসওয়ার্ডের নিয়ম মেনে চলুন।' };

    if (findRecord(phoneCanonical) || (email && findRecord(email))) {
      return { success: false, error: 'An account with this phone number or email already exists. Please sign in instead.', errorBn: 'এই মোবাইল নম্বর বা ইমেইল দিয়ে আগে থেকেই অ্যাকাউন্ট আছে। অনুগ্রহ করে লগইন করুন।' };
    }

    const now = new Date().toISOString();
    const existingGuests = (serverDb.customers as unknown as CustomerWithAuth[]).filter(
      (c) => (c.phoneCanonical || normalizeBdMobilePhone(c.phone)) === phoneCanonical && !c.passwordHash
    );
    // Adopt the guest CRM record so a shopper's earlier COD orders follow them
    // into the new account instead of duplicating the customer.
    const base = existingGuests[0];
    const customer: CustomerWithAuth = {
      id: base?.id || `cust-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      name,
      phone: phoneCanonical,
      phoneCanonical,
      email: email || base?.email || '',
      joinedDate: (base?.joinedDate as string) || now.slice(0, 10),
      totalOrders: (base?.totalOrders as number) ?? 0,
      totalSpent: (base?.totalSpent as number) ?? 0,
      defaultAddress: input.address?.trim() || (base?.defaultAddress as string) || '',
      status: 'ACTIVE',
      source: input.source || 'WEB',
      district: input.district || base?.district || '',
      passwordHash: hashPassword(input.password),
      passwordUpdatedAt: now,
      mustChangePassword: false,
      emailVerified: false,
      lastLoginAt: now,
    };

    if (base) {
      Object.assign(base, customer);
    } else {
      (serverDb.customers as unknown as CustomerWithAuth[]).push(customer);
    }
    persistence.markDirty('customers');
    void persistence.upsertOne('customers', customer as unknown as object, 'id');

    if (input.address?.trim()) {
      serverDb.customerAddresses.push({
        id: `addr-${Date.now()}`,
        customerId: customer.id,
        label: 'Home',
        labelBn: 'বাসা',
        recipientName: name,
        phone: phoneCanonical,
        addressLine: input.address.trim(),
        district: input.district || 'Dhaka',
        division: 'Dhaka',
        upazilaOrArea: input.district || 'Dhaka',
        postalCode: '1200',
        isDefault: true,
        createdAt: now,
      });
      persistence.markDirty('customerAddresses');
    }

    const csrf = crypto.randomBytes(16).toString('base64url');
    const { token } = mintSessionToken('CUSTOMER', customer.id, { name, csrf });
    log.info('auth', `customer_registered ${customer.id}`);
    return { success: true, customer: publicCustomer(customer), token, csrf };
  }

  async login(input: {
    identifier: string;
    password: string;
    ip: string;
  }): Promise<
    | { success: true; customer: Record<string, unknown>; token: string; csrf: string }
    | { success: false; code: 'INVALID_CREDENTIALS' | 'NO_PASSWORD' | 'BLOCKED'; error: string; errorBn: string }
  > {
    const customer = findRecord(input.identifier);

    // Run a hash regardless of hit/miss so timing does not reveal existence.
    if (!customer) {
      verifyPassword(input.password || '', 'scrypt$32768$00$00');
      return { success: false, code: 'INVALID_CREDENTIALS', error: 'Invalid credentials.', errorBn: 'ইমেইল/মোবাইল নম্বর বা পাসওয়ার্ড ভুল।' };
    }

    if (customer.status === 'BLOCKED') {
      return {
        success: false,
        code: 'BLOCKED',
        error: 'This account is blocked. Please contact support.',
        errorBn: 'এই অ্যাকাউন্টটি ব্লক করা হয়েছে। অনুগ্রহ করে সাপোর্টে যোগাযোগ করুন।',
      };
    }

    if (!customer.passwordHash) {
      return {
        success: false,
        code: 'NO_PASSWORD',
        error: 'This account has no password yet. Use “Create account” to set one, or reset your password.',
        errorBn: 'এই অ্যাকাউন্টে এখনো পাসওয়ার্ড সেট করা হয়নি। পাসওয়ার্ড সেট করতে “অ্যাকাউন্ট তৈরি করুন” ব্যবহার করুন।',
      };
    }

    const verdict = verifyPassword(input.password || '', customer.passwordHash);
    if (!verdict.ok) {
      return { success: false, code: 'INVALID_CREDENTIALS', error: 'Invalid credentials.', errorBn: 'ইমেইল/মোবাইল নম্বর বা পাসওয়ার্ড ভুল।' };
    }

    if (verdict.needsUpgrade) {
      customer.passwordHash = hashPassword(input.password);
      customer.passwordUpdatedAt = new Date().toISOString();
      void persistence.upsertOne('customers', customer as unknown as object, 'id');
    }

    customer.lastLoginAt = new Date().toISOString();
    persistence.markDirty('customers');

    const csrf = crypto.randomBytes(16).toString('base64url');
    const { token } = mintSessionToken('CUSTOMER', customer.id, { name: customer.name, csrf, role: 'CUSTOMER' });
    return { success: true, customer: publicCustomer(customer), token, csrf };
  }

  findById(id: string): CustomerWithAuth | undefined {
    return (serverDb.customers as unknown as CustomerWithAuth[]).find((c) => c.id === id);
  }

  resolve(token: string): { payload: SessionPayload; customer: CustomerWithAuth } | null {
    const result = verifySessionPayload(token, 'CUSTOMER');
    if (!result.ok) return null;
    const payload = result.payload;
    if (revocations.isRevoked('jti', payload.jti)) return null;
    const customer = (serverDb.customers as unknown as CustomerWithAuth[]).find((c) => c.id === payload.sub);
    if (!customer) return null;
    if ((customer.status as string) === 'BLOCKED') return null;
    if (customer.sessionsInvalidBefore && payload.iat < customer.sessionsInvalidBefore) return null;
    return { payload, customer };
  }

  async logout(payload: SessionPayload | null): Promise<void> {
    if (!payload) return;
    revocations.revoke('jti', payload.jti, payload.exp);
  }

  async changePassword(input: {
    customerId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<{ success: boolean; error?: string; errorBn?: string }> {
    const customer = (serverDb.customers as unknown as CustomerWithAuth[]).find((c) => c.id === input.customerId);
    if (!customer) return { success: false, error: 'Account not found.', errorBn: 'অ্যাকাউন্ট পাওয়া যায়নি।' };

    if (customer.passwordHash) {
      const verdict = verifyPassword(input.currentPassword || '', customer.passwordHash);
      if (!verdict.ok) return { success: false, error: 'Current password is incorrect.', errorBn: 'বর্তমান পাসওয়ার্ড ভুল।' };
    }

    const policy = passwordPolicyError(input.newPassword, 'New password');
    if (policy) return { success: false, error: policy, errorBn: 'নতুন পাসওয়ার্ডের নিয়ম মেনে চলুন।' };

    customer.passwordHash = hashPassword(input.newPassword);
    customer.passwordUpdatedAt = new Date().toISOString();
    customer.mustChangePassword = false;
    // Every other device must sign in again.
    customer.sessionsInvalidBefore = Date.now();
    void persistence.upsertOne('customers', customer as unknown as object, 'id');
    return { success: true };
  }

  async beginReset(identifier: string): Promise<{ success: boolean; error?: string; devCode?: string }> {
    const customer = findRecord(identifier);
    const safe = 'If this account exists, a verification code has been sent.';
    if (!customer) return { success: true };
    if (!customer.email) {
      return {
        success: false,
        error: 'This account has no email address on file. Please contact support to recover access.',
        devCode: undefined,
      };
    }

    const code = issueNumericCode();
    oneTimeCodes.create('customer-reset', customer.email, code);

    const { resendEmailService } = await import('../resendEmailService');
    if (resendEmailService.isConfigured()) {
      const result = await resendEmailService
        .sendEmail({
          to: customer.email,
          subject: 'KISHOLOY password reset code',
          text: `Your KISHOLOY password reset code is ${code}. It expires in 10 minutes.`,
          html: `<p>Your KISHOLOY password reset code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
        })
        .catch(() => ({ success: false, provider: 'RESEND' as const }));
      if (result?.success && result.provider === 'RESEND') return { success: true };
      return { success: false, error: `${safe} The email provider could not deliver the code — please try again in a moment.` };
    }

    if (config.isProduction) {
      return { success: false, error: 'Password recovery by email is not available on this deployment. Please contact support.' };
    }
    return { success: true, devCode: code };
  }

  async completeReset(identifier: string, code: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
    const customer = findRecord(identifier);
    if (!customer?.email) return { success: false, error: 'Verification code is invalid or has expired.' };
    const check = oneTimeCodes.verify('customer-reset', customer.email, code);
    if (!check.ok) return { success: false, error: check.error || 'Verification code is invalid or has expired.' };

    const policy = passwordPolicyError(newPassword, 'New password');
    if (policy) return { success: false, error: policy };

    customer.passwordHash = hashPassword(newPassword);
    customer.passwordUpdatedAt = new Date().toISOString();
    customer.mustChangePassword = false;
    customer.sessionsInvalidBefore = Date.now();
    void persistence.upsertOne('customers', customer as unknown as object, 'id');
    return { success: true };
  }

  /** Guest-order claim: proves ownership with the order number + phone. */
  verifyGuestOrderMatch(orderNumber: string, phone: string): { ok: boolean; order?: Record<string, unknown>; error?: string } {
    const order = (serverDb.orders as unknown as Record<string, unknown>[]).find(
      (o) => String(o.orderNumber || '').toLowerCase() === (orderNumber || '').trim().toLowerCase()
    );
    if (!order) return { ok: false, error: 'No order found with that number.' };
    const orderPhone = normalizeBdMobilePhone(String((order.customer as { phone?: string })?.phone || ''));
    const provided = normalizeBdMobilePhone(phone || '');
    if (!provided || provided !== orderPhone) {
      return { ok: false, error: 'The phone number does not match this order.' };
    }
    return { ok: true, order };
  }
}

export const customerAuth = new CustomerAuthService();
