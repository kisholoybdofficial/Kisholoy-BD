/**
 * Demo data seeding — the only sanctioned way to populate demo content.
 *
 * Rules this enforces:
 *  - demo catalogue data is inserted into the **durable store**, not baked into
 *    React components. Deleting `src/data/mockData.ts` from the browser bundle
 *    must not change what a customer sees; the store is the source of truth.
 *  - in production it is a no-op unless `KISHOLOY_ALLOW_DEMO_DATA=true`, so a
 *    real launch can never accidentally ship 22 fake products;
 *  - it never creates a credential: demo shoppers are inserted **without** a
 *    password hash, so they cannot be signed into, and vendors keep whatever
 *    portal password the environment provides (see `supplierCredentials.ts`);
 *  - seeding is idempotent — running it twice updates demo rows in place
 *    instead of duplicating SKUs (unique index on `sku`/`slug` would reject it).
 *
 * CLI: `npm run seed` (or `npm run seed:demo`).
 *
 * @license Apache-2.0
 */

import { config } from '../config';
import { log } from '../http/errors';
import { persistence } from '../persistence/store';
import { serverDb } from '../db';
import { supplierEngine } from '../supplierEngine';
import { seedPortalPassword } from '../supplierCredentials';
import { availableStockOf } from '../financeEngine';
import type { Category, CouponRule, Customer, Product, Supplier } from '../../src/types';
import {
  DEMO_CATEGORIES,
  DEMO_COUPONS,
  DEMO_CUSTOMERS,
  DEMO_PRODUCTS,
  DEMO_VENDORS,
} from './demoCatalogue';

export interface SeedReport {
  ran: boolean;
  skippedReason?: string;
  products: number;
  categories: number;
  vendors: number;
  coupons: number;
  customers: number;
  mode: 'durable' | 'memory';
}

const uniqueSlug = (base: string, taken: Set<string>): string => {
  let slug = base || 'product';
  let n = 2;
  while (taken.has(slug)) {
    slug = `${base}-${n++}`;
  }
  taken.add(slug);
  return slug;
};

/**
 * Insert (or refresh) the demo catalogue.
 *
 * @param opts.force re-apply even when the store already has products
 * @param opts.allowProduction required to write demo data while NODE_ENV=production
 */
export async function seedDemoData(opts: { force?: boolean; allowProduction?: boolean } = {}): Promise<SeedReport> {
  await persistence.ensureReady();

  const report: SeedReport = {
    ran: false,
    products: 0,
    categories: 0,
    vendors: 0,
    coupons: 0,
    customers: 0,
    mode: persistence.durable ? 'durable' : 'memory',
  };

  if (config.isProduction && !opts.allowProduction) {
    report.skippedReason =
      'Refusing to write demo catalogue data while NODE_ENV=production. Pass --allow-demo (or set KISHOLOY_ALLOW_DEMO_DATA=true) if this deployment is intentionally a demo.';
    log.warn('seed', report.skippedReason);
    return report;
  }

  const durableProducts = persistence.durable ? await persistence.loadCollection<Product>('products', 'id') : null;
  const alreadyPopulated = (durableProducts?.length ?? serverDb.products.filter((p) => !p.isDeleted).length) > 0;
  if (alreadyPopulated && !opts.force) {
    report.skippedReason = 'Catalogue already contains products; pass --force to re-apply demo rows.';
    log.info('seed', report.skippedReason);
    // Even when skipping, keep the derived stock status honest.
    for (const product of serverDb.products) serverDb.recomputeStockStatus(product);
    return report;
  }

  // The bundle ships a `mockData` starting set for pure-frontend development.
  // Once a durable store is in play that set has to go, otherwise the demo
  // catalogue is seeded *on top of* mock products and the storefront shows the
  // same kind of item twice with two different provenances.
  const durableWasEmpty = persistence.durable && (durableProducts?.length ?? 0) === 0;
  if (durableWasEmpty) {
    serverDb.products = [];
    serverDb.categories = [];
    serverDb.coupons = [];
  }

  // ── Categories ────────────────────────────────────────────────────────────
  const existingCategories = new Map(serverDb.categories.map((c) => [c.slug, c]));
  for (const category of DEMO_CATEGORIES) {
    const prior = existingCategories.get(category.slug);
    const merged: Category = { ...category, ...(prior ? { id: prior.id } : {}), updatedAt: new Date().toISOString() };
    if (prior) Object.assign(prior, merged);
    else serverDb.categories.push(merged);
    report.categories += 1;
  }

  // ── Vendors / entrepreneur partners ───────────────────────────────────────
  const portalSeed = seedPortalPassword();
  for (const vendor of DEMO_VENDORS) {
    const id = vendor.id;
    const record: Supplier = {
      id,
      code: vendor.code,
      companyName: vendor.companyName,
      contactPerson: vendor.contactPerson || 'Operations Desk',
      email: vendor.email || '',
      phone: vendor.phone || '',
      address: vendor.address || '',
      district: vendor.district || 'Dhaka',
      division: vendor.division,
      categoriesSupplied: vendor.categoriesSupplied || [],
      paymentTerms: 'NET_15',
      paymentTermsDays: vendor.paymentTermsDays,
      status: vendor.status || 'ACTIVE',
      totalPurchased: 0,
      totalPaid: 0,
      totalDue: 0,
      notes: vendor.notes,
      portalAccess: {
        // Portal is provisioned but only reachable with an environment-provided
        // password; a seeded demo vendor can never be signed into blindly.
        enabled: true,
        loginEmail: vendor.email,
        email: vendor.email,
        loginIsolated: true,
        passwordHash: portalSeed.hash,
        passwordUpdatedAt: new Date().toISOString(),
        mustChangePassword: true,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as Supplier;
    supplierEngine.upsertSupplierRecord(record);
    report.vendors += 1;
  }

  // ── Products ──────────────────────────────────────────────────────────────
  const takenSlugs = new Set(serverDb.products.map((p) => p.slug));
  const byId = new Map(serverDb.products.map((p) => [p.id, p]));
  const bySku = new Map(serverDb.products.map((p) => [p.sku, p]));

  for (const spec of DEMO_PRODUCTS) {
    const existing = byId.get(spec.id!) || bySku.get(spec.sku);
    const slug = uniqueSlug(spec.slug || spec.sku.toLowerCase(), takenSlugs);
    const prepared: Product = {
      ...spec,
      slug,
      status: spec.status || 'ACTIVE',
      updatedAt: new Date().toISOString(),
    } as Product;

    // Derived availability, then the storefront never has to recompute it.
    serverDb.recomputeStockStatus(prepared);

    if (existing) {
      Object.assign(existing, prepared);
    } else {
      serverDb.products.unshift(prepared);
    }
    report.products += 1;
  }

  // Category counts shown on the storefront grid.
  for (const category of serverDb.categories) {
    category.itemCount = serverDb.products.filter(
      (p) => !p.isDeleted && p.status === 'ACTIVE' && p.categorySlug === category.slug
    ).length;
  }

  // ── Coupons ───────────────────────────────────────────────────────────────
  const couponCodes = new Set(serverDb.coupons.map((c) => c.code.toUpperCase()));
  for (const coupon of DEMO_COUPONS as CouponRule[]) {
    const prior = serverDb.coupons.find((c) => c.code.toUpperCase() === coupon.code.toUpperCase());
    if (prior) {
      Object.assign(prior, coupon, { id: prior.id, usageCount: prior.usageCount });
    } else if (!couponCodes.has(coupon.code.toUpperCase())) {
      serverDb.coupons.push(coupon);
      report.coupons += 1;
    }
  }

  // ── Demo shoppers (no credentials, by design) ─────────────────────────────
  const seenPhones = new Set(serverDb.customers.map((c) => (c.phone || '').replace(/\D/g, '')));
  for (const demo of DEMO_CUSTOMERS as Array<Partial<Customer> & { name: string; phone: string }>) {
    if (seenPhones.has(demo.phone.replace(/\D/g, ''))) continue;
    serverDb.customers.push({
      id: `cust-${demo.name.toLowerCase().replace(/[^a-z]+/g, '-')}`,
      name: demo.name,
      phone: demo.phone,
      phoneCanonical: demo.phone,
      email: demo.email || '',
      joinedDate: new Date().toISOString().slice(0, 10),
      totalOrders: 0,
      totalSpent: 0,
      defaultAddress: demo.defaultAddress || '',
      district: demo.district,
      thana: demo.thana,
      status: 'ACTIVE',
      source: 'WEB',
      // NOTE: deliberately no passwordHash — a demo row must not be signable.
    } as Customer);
    report.customers += 1;
  }

  // ── Durability ────────────────────────────────────────────────────────────
  serverDb.syncAll();
  await persistence.flush();

  const sellable = serverDb.products.filter((p) => !p.isDeleted && p.status === 'ACTIVE').length;
  const vendorOwned = serverDb.products.filter((p) => p.sellingModel === 'VENDOR' || p.sellingModel === 'MADE_TO_ORDER').length;
  log.info(
    'seed',
    `demo catalogue applied — ${report.products} products (${sellable} sellable, ${vendorOwned} vendor-owned), ` +
      `${report.categories} categories, ${report.vendors} vendors, ${report.coupons} coupons, ${report.customers} demo shoppers → ${report.mode} store`
  );

  report.ran = true;
  return report;
}

/**
 * Boot-time hook: seed only when the store is empty and the deployment asked
 * for it. Returns whether anything was written.
 */
export async function maybeSeedDemoCatalogue(): Promise<boolean> {
  if (!config.seeding.autoSeed && !config.seeding.allowDemoInProduction) return false;
  await persistence.ensureReady();

  // A durable store that already has products needs no seeding, ever.
  if (persistence.durable) {
    const existing = await persistence.loadCollection<Product>('products', 'id');
    if (existing.length > 0) return false;
  } else if (serverDb.products.length > 0 && !config.isTest) {
    return false;
  }

  const report = await seedDemoData({ force: false, allowProduction: config.seeding.allowDemoInProduction });
  return report.ran;
}

/** Available-stock helper re-exported so callers do not import the engine twice. */
export { availableStockOf };
