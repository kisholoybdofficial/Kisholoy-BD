/**
 * Schema validation for the money- and identity-bearing endpoints.
 *
 * `src/lib/validations.ts` already covers suppliers/marketing; this module adds
 * the paths where unvalidated input turns into a financial or auth bug:
 *   - order creation (the one that can lose money),
 *   - checkout quote,
 *   - staff / customer credentials.
 *
 * Rules that matter:
 *   - quantities are integers, never negative, never absurd;
 *   - clients may send **product ids and quantities only** — prices, totals and
 *     discounts are stripped (`stripUnknown`) so a tampered payload cannot even
 *     reach the pricing engine;
 *   - identifiers are length-capped to keep indexes and logs sane.
 *
 * @license Apache-2.0
 */

import { z } from 'zod';

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const bdPhone = z
  .string()
  .trim()
  .min(10)
  .max(20)
  .regex(/^(\+?880|0)?1[3-9][0-9]{8}$/, 'Provide a valid Bangladeshi mobile number (e.g. 01712345678).');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Optional email: accepts "", null, undefined or a valid address. */
export const emailOrNull = z
  .union([z.string().trim().max(160), z.null(), z.undefined()])
  .transform((v) => (typeof v === 'string' ? v.trim().toLowerCase() : ''))
  .refine((v) => v === '' || EMAIL_RE.test(v), { message: 'Email address is not valid.' });

export const safeText = (max: number) =>
  z
    .string()
    // Control characters and angle brackets are the vectors for stored XSS in
    // free-text fields that later reach innerHTML-ish renderers or print HTML.
    .transform((v) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, '').trim())
    .refine((v) => v.length <= max, { message: 'Text is too long.' });

export const couponCode = z
  .string()
  .trim()
  .max(32)
  .regex(/^[A-Za-z0-9_-]*$/, 'Coupon code contains invalid characters.');

export const orderLineSchema = z
  .object({
    productId: trimmed(64),
    quantity: z.coerce.number().int('Quantity must be a whole number.').min(1).max(200),
    variantId: z.string().trim().max(64).optional(),
    // Accepted but ignored: the server is the only price authority.
    price: z.number().optional(),
    title: z.string().max(200).optional(),
  })
  .strict();

export const orderCreateSchema = z
  .object({
    customer: z
      .object({
        name: safeText(120).refine((v) => v.length >= 2, { message: 'Please enter your full name.' }),
        phone: bdPhone,
        email: emailOrNull.optional(),
      })
      .strict(),
    shippingAddress: z
      .object({
        firstName: safeText(80).optional(),
        lastName: safeText(80).optional(),
        phone: z.optional(z.union([bdPhone, z.literal('')])),
        // Optional fields are declared with .optional() (zod v4 semantics):
        // a shopper may legitimately not type a phone/email/postal code, and the
        // server derives the delivery phone from the customer record instead.
        email: z.optional(emailOrNull),
        address: safeText(320).refine((v) => v.length >= 8, { message: 'Please provide a detailed delivery address.' }),
        division: safeText(60).optional(),
        district: safeText(60).refine((v) => v.length >= 2, { message: 'Delivery district is required.' }),
        thana: safeText(60).optional(),
        postalCode: safeText(16).optional(),
      })
      .strict(),
    items: z.array(orderLineSchema).min(1, 'Your cart is empty.').max(60),
    paymentMethod: z.enum(['COD', 'BKASH', 'NAGAD', 'ROCKET', 'CARD', 'MANUAL', 'SSLCOMMERZ']).default('COD'),
    couponCode: couponCode.optional(),
    notes: safeText(500).optional(),
    orderSource: z.enum(['WEB', 'WHATSAPP', 'MESSENGER', 'FACEBOOK', 'INSTAGRAM', 'PHONE', 'DIRECT', 'MANUAL_ADMIN']).optional(),
    /** Signed quote from POST /api/checkout/quote (optional, checked if present). */
    quoteToken: z.string().max(1200).optional(),
    /** Dedupe key for double-submitted checkouts. */
    idempotencyKey: z.string().trim().max(120).optional(),
    utm: z.record(z.string(), z.string().max(160)).optional(),
    advancePayment: z
      .object({
        amount: z.number().min(0).max(10_000_000).optional(),
        isPaid: z.boolean().optional(),
        method: z.string().max(32).optional(),
        transactionId: z.string().max(80).optional(),
      })
      .catchall(z.unknown())
      .optional(),
    channelDetails: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const checkoutQuoteSchema = z
  .object({
    items: z.array(orderLineSchema).min(1).max(60),
    division: z.string().trim().max(60).optional(),
    district: z.string().trim().max(60).optional(),
    couponCode: couponCode.optional(),
  })
  .strict();

export const staffLoginSchema = z
  .object({
    email: z.string().trim().min(3).max(160),
    password: z.string().min(1).max(200),
    totpCode: z.string().trim().regex(/^[0-9]{6}$/).optional(),
  })
  .strict();

export const customerLoginSchema = z
  .object({
    identifier: z.string().trim().min(6).max(160),
    password: z.string().min(1).max(200),
  })
  .strict();

export const customerRegisterSchema = z
  .object({
    name: safeText(120).refine((v) => v.length >= 2, { message: 'Please enter your full name.' }),
    phone: bdPhone,
    email: emailOrNull.optional(),
    password: z.string().min(10).max(200),
    address: safeText(320).optional(),
    district: safeText(60).optional(),
  })
  .strict();

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().max(200).optional(),
    newPassword: z.string().min(10).max(200),
  })
  .strict();

export const productWriteSchema = z
  .object({
    title: safeText(200).refine((v) => v.length >= 2, { message: 'Product name is required.' }),
    titleBn: safeText(200).optional(),
    slug: z
      .string()
      .trim()
      .max(180)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers and hyphens.')
      .optional(),
    sku: safeText(64).optional(),
    description: safeText(8000).optional(),
    descriptionBn: safeText(8000).optional(),
    shortDescription: safeText(400).optional(),
    price: z.number().finite().min(0).max(10_000_000),
    originalPrice: z.number().finite().min(0).max(10_000_000).optional(),
    costPrice: z.number().finite().min(0).max(10_000_000).optional(),
    taxRate: z.number().min(0).max(100).optional(),
    stock: z.number().int().min(0).max(1_000_000).optional(),
    reservedStock: z.number().int().min(0).max(1_000_000).optional(),
    lowStockThreshold: z.number().int().min(0).max(10_000).optional(),
    category: safeText(120).optional(),
    categorySlug: safeText(120).optional(),
    subcategory: safeText(120).optional(),
    brand: safeText(120).optional(),
    productType: z.enum(['PHYSICAL', 'DIGITAL', 'SERVICE', 'BUNDLE', 'GIFT_CARD', 'SUBSCRIPTION']).optional(),
    sellingModel: z.enum(['IN_HOUSE', 'VENDOR', 'DROP_SHIP', 'PRE_ORDER', 'MADE_TO_ORDER']).optional(),
    supplierId: safeText(64).optional(),
    vendorId: safeText(64).optional(),
    unit: safeText(32).optional(),
    unitBn: safeText(32).optional(),
    weightGrams: z.number().min(0).max(10_000_000).optional(),
    dimensions: z
      .object({
        length: z.number().min(0).max(10000).optional(),
        width: z.number().min(0).max(10000).optional(),
        height: z.number().min(0).max(10000).optional(),
        unit: z.enum(['cm', 'in']).optional(),
      })
      .optional(),
    status: z.enum(['ACTIVE', 'DRAFT', 'INACTIVE', 'ARCHIVED', 'OUT_OF_STOCK']).optional(),
    trackInventory: z.boolean().optional(),
    readyToShip: z.boolean().optional(),
    isFeatured: z.boolean().optional(),
    isBestseller: z.boolean().optional(),
    isNewArrival: z.boolean().optional(),
    badge: safeText(40).optional(),
    badgeBn: safeText(40).optional(),
    origin: safeText(120).optional(),
    images: z.array(z.string().trim().max(600)).max(20).optional(),
    tags: z.array(safeText(60)).max(40).optional(),
    rating: z.number().min(0).max(5).optional(),
    reviewsCount: z.number().int().min(0).max(10_000_000).optional(),
    variants: z
      .array(
        z.object({
          id: safeText(64).optional(),
          name: safeText(80),
          nameBn: safeText(80).optional(),
          sku: safeText(64).optional(),
          price: z.number().min(0).max(10_000_000),
          stock: z.number().int().min(0).max(1_000_000).optional(),
          attributes: z.record(z.string(), z.string().max(80)).optional(),
        })
      )
      .max(60)
      .optional(),
    customAttributes: z
      .array(
        z.object({
          key: safeText(64),
          label: safeText(80),
          labelBn: safeText(80).optional(),
          value: z.union([z.string().max(600), z.number(), z.boolean(), z.array(z.union([z.string().max(120), z.number()]))]),
          unit: safeText(24).optional(),
          dataType: z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'SELECT', 'MULTI_SELECT', 'MEASURE', 'DATE']).optional(),
          visible: z.boolean().optional(),
          filterable: z.boolean().optional(),
        })
      )
      .max(80)
      .optional(),
    seo: z
      .object({
        title: safeText(180).optional(),
        description: safeText(400).optional(),
        keywords: z.array(safeText(60)).max(30).optional(),
      })
      .optional(),
    returnPolicy: z
      .object({
        returnable: z.boolean(),
        windowDays: z.number().int().min(0).max(365).optional(),
        restockable: z.boolean().optional(),
        conditionRequired: safeText(240).optional(),
        exceptions: safeText(400).optional(),
      })
      .optional(),
    warranty: z
      .object({
        applicable: z.boolean(),
        durationMonths: z.number().int().min(0).max(600).optional(),
        provider: safeText(120).optional(),
        summary: safeText(400).optional(),
      })
      .optional(),
    metadata: z.record(z.string(), z.union([z.string().max(400), z.number(), z.boolean(), z.null()])).optional(),
  })
  .strict();

export type OrderCreateInput = z.infer<typeof orderCreateSchema>;
export type ProductWriteInput = z.infer<typeof productWriteSchema>;

/** Normalises a Zod error into the {error, errorBn, fields} shape the UI reads. */
export function formatZodErrorSafe(error: unknown): {
  error: string;
  errorBn: string;
  fields: Record<string, string>;
} {
  const fields: Record<string, string> = {};
  let first = 'The request could not be validated.';
  let firstBn = 'অনুরোধটি যাচাই করা যায়নি।';

  const issues = (error as { issues?: Array<{ code?: string; path: Array<string | number>; message: string; minimum?: number; maximum?: number }> })?.issues || [];
  for (const issue of issues) {
    const key = issue.path.join('.') || '_';
    const human = humaniseIssue(issue);
    if (!fields[key]) {
      fields[key] = human;
      first = human;
      firstBn = banglaFor(key, human);
    }
  }
  return { error: first, errorBn: firstBn, fields };
}

const BN_BY_FIELD: Record<string, string> = {
  name: 'সঠিক নাম লিখুন।',
  phone: 'সঠিক মোবাইল নম্বর দিন (যেমন ০১৭১২৩৪৫৬৭৮)।',
  email: 'সঠিক ইমেইল ঠিকানা দিন।',
  password: 'পাসওয়ার্ডটি অন্তত ১০ অক্ষরের হতে হবে।',
  address: 'বিস্তারিত ডেলিভারি ঠিকানা দিন।',
  district: 'জেলা নির্বাচন করুন।',
  items: 'কার্টে অন্তত একটি পণ্য প্রয়োজন।',
  quantity: 'পরিমাণ ১ থেকে ২০০ এর মধ্যে পূর্ণসংখ্যা হতে হবে।',
  couponCode: 'কুপন কোডটি সঠিক নয়।',
  identifier: 'ইমেইল বা মোবাইল নম্বর দিন।',
};

/**
 * Zod's own strings ("Invalid input: expected nonoptional, received undefined",
 * "Unrecognized key(s) in object") are useless — and mildly revealing — to a
 * shopper. Translate the shapes we can name, fall back to a plain sentence.
 */
function humaniseIssue(issue: { code?: string; message: string; path: Array<string | number>; minimum?: number; maximum?: number }): string {
  const key = String(issue.path[issue.path.length - 1] || '');
  const code = issue.code || '';
  if (code === 'unrecognized_keys') return 'This request contains fields that are not accepted.';
  if (code === 'too_small') {
    if (key === 'items') return 'Your cart is empty.';
    return issue.minimum
      ? `Please enter at least ${issue.minimum} character(s).`
      : 'This value is too short.';
  }
  if (code === 'too_big') {
    return issue.maximum
      ? `This value is too large (maximum ${issue.maximum}).`
      : 'This value is too large.';
  }
  if (code === 'invalid_type') {
    const friendly: Record<string, string> = {
      phone: 'Enter a valid mobile number, e.g. 01712345678.',
      email: 'Enter a valid email address.',
      name: 'Enter your full name.',
      address: 'Enter your delivery address.',
      district: 'Select your delivery district.',
      quantity: 'Quantity must be a whole number.',
      password: 'Enter your password.',
      identifier: 'Enter your email or mobile number.',
    };
    return friendly[key] || 'A required value is missing or in the wrong format.';
  }
  if (/invalid|expected|received|unrecognized/i.test(issue.message)) {
    return 'One or more values are not in the expected format.';
  }
  return issue.message;
}

function banglaFor(field: string, message: string): string {
  const key = field.split('.').pop() || field;
  if (BN_BY_FIELD[key]) return BN_BY_FIELD[key];
  if (/quantity/i.test(message)) return 'পরিমাণ ১ থেকে ২০০ এর মধ্যে পূর্ণসংখ্যা হতে হবে।';
  if (/price/i.test(message)) return 'মূল্য সঠিক নয়।';
  return 'দেওয়া তথ্য যাচাই করা যায়নি। আবার চেষ্টা করুন।';
}
