/**
 * Durable datastore abstraction.
 *
 * Why: the platform's authoritative state lived in a process-local
 * `ServerDatabase` class populated from `src/data/mockData`. On Vercel that
 * means (a) the Express process is recycled per cold start, so every order
 * created by a customer evaporates, and (b) "products" are whatever the
 * bundle was compiled with, so nothing in the admin panel persists either.
 * The previous `mongoService` only mirrored orders fire-and-forget, and the
 * build command never deployed the API at all.
 *
 * Design: `serverDb` stays a synchronous read model (289 routes depend on
 * that), and this store becomes the write-behind journal:
 *   - `hydrate()` on boot loads durable state (or seeds an empty store),
 *   - mutations are queued and `flush()`ed before an API response finishes,
 *   - stock allocation uses *atomic* conditional updates so two concurrent
 *     checkouts can never oversell the same unit.
 *
 * Drivers:
 *   - `mongo`   — production (MongoDB Atlas),
 *   - `file`    — local development/testing; real persistence, no service,
 *   - `memory`  — last resort, explicitly reported as VOLATILE.
 *
 * @license Apache-2.0
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config';
import { log } from '../http/errors';

export type DriverName = 'mongo' | 'file' | 'memory';

/** Collections whose authoritative content is durable state. */
export const SNAPSHOT_COLLECTIONS = [
  'products',
  'categories',
  'coupons',
  'siteContent',
  'staffUsers',
  'suppliers',
  'customerAddresses',
  'wishlists',
  'loyaltyWallets',
  'flashDeals',
  'warehouses',
  'warehouseStock',
] as const;

/** Append-only collections (never deleted wholesale, cheap to journal). */
export const APPEND_COLLECTIONS = [
  'orders',
  'auditLogs',
  'inventoryTransactions',
  'paymentTransactions',
  'customers',
  'customerReturns',
  'customerNotifications',
  'contentRevisions',
  'notificationLogs',
  'rmaRecords',
] as const;

export type SnapshotCollection = (typeof SNAPSHOT_COLLECTIONS)[number];
export type AppendCollection = (typeof APPEND_COLLECTIONS)[number];

export interface StockAdjustResult {
  ok: boolean;
  before?: number;
  after?: number;
  error?: string;
}

export interface StoreDriver {
  readonly name: DriverName;
  init(): Promise<void>;
  findAll<T>(collection: string, idField: string): Promise<T[]>;
  upsertMany<T>(collection: string, idField: string, docs: T[]): Promise<void>;
  removeMany(collection: string, idField: string, ids: string[]): Promise<void>;
  upsertOne<T>(collection: string, idField: string, doc: T): Promise<void>;
  findOne<T>(collection: string, idField: string, id: string): Promise<T | null>;
  atomicStockAdjust(productId: string, delta: number, requireSufficiency: boolean): Promise<StockAdjustResult>;
  claimIdempotency?(key: string, meta: Record<string, unknown>): Promise<{ replayed: boolean; record?: { orderNumber?: string; orderId?: string } }>;
  close(): Promise<void>;
  health(): Promise<{ ok: boolean; latencyMs: number; detail?: string }>;
}

// ---------------------------------------------------------------------------
// File driver — development and automated tests.
// ---------------------------------------------------------------------------

export class FileDriver implements StoreDriver {
  readonly name: DriverName = 'file';
  private root: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root?: string) {
    this.root = root || process.env.KISHOLOY_DATA_DIR || path.join(process.cwd(), '.kisholoy-data');
  }

  private file(collection: string): string {
    return path.join(this.root, `${collection}.ndjson`);
  }

  async init(): Promise<void> {
    await fsp.mkdir(this.root, { recursive: true });
  }

  private serialize(doc: Record<string, unknown>): string {
    return JSON.stringify(doc);
  }

  private async readAll<T>(collection: string): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    let raw = '';
    try {
      raw = await fsp.readFile(this.file(collection), 'utf8');
    } catch {
      return out;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const doc = JSON.parse(trimmed) as T & Record<string, unknown>;
        const id = String(doc.__id);
        if (!id) continue;
        if (doc.__deleted) out.delete(id);
        else out.set(id, doc as T);
      } catch {
        // Skip a torn final line (crash during append) rather than fail boot.
      }
    }
    return out;
  }

  async findAll<T>(collection: string, idField: string): Promise<T[]> {
    const map = await this.readAll<Record<string, unknown>>(collection);
    return Array.from(map.values()).map((doc) => {
      const { __id: _drop, __deleted: _drop2, ...rest } = doc;
      void _drop;
      void _drop2;
      if (!(rest as Record<string, unknown>)[idField]) (rest as Record<string, unknown>)[idField] = doc.__id;
      return rest as T;
    });
  }

  private append(collection: string, lines: string[]): Promise<void> {
    this.queue = this.queue.then(async () => {
      const file = this.file(collection);
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.appendFile(file, lines.map((l) => l + '\n').join(''), 'utf8');
      // Compact occasionally so the journal cannot grow without bound.
      const stat = await fsp.stat(file);
      if (stat.size > 8 * 1024 * 1024) await this.compact(collection);
    });
    return this.queue as Promise<void>;
  }

  private async compact(collection: string): Promise<void> {
    const map = await this.readAll<Record<string, unknown>>(collection);
    const tmp = `${this.file(collection)}.tmp`;
    const body = Array.from(map.values())
      .map((doc) => this.serialize(doc))
      .join('\n');
    await fsp.writeFile(tmp, body ? `${body}\n` : '', 'utf8');
    await fsp.rename(tmp, this.file(collection));
  }

  async upsertMany<T>(collection: string, idField: string, docs: T[]): Promise<void> {
    if (!docs.length) return;
    await this.append(
      collection,
      docs.map((doc) => {
        const record = doc as Record<string, unknown>;
        return this.serialize({ ...record, __id: String(record[idField]) });
      })
    );
  }

  async upsertOne<T>(collection: string, idField: string, doc: T): Promise<void> {
    await this.upsertMany(collection, idField, [doc]);
  }

  async removeMany(collection: string, idField: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.append(collection, ids.map((id) => this.serialize({ __id: String(id), __deleted: true })));
  }

  async findOne<T>(collection: string, idField: string, id: string): Promise<T | null> {
    const all = await this.readAll<T & Record<string, unknown>>(collection);
    const hit = all.get(String(id));
    if (!hit) {
      const list = await this.findAll<T>(collection, idField);
      return list.find((d) => String((d as Record<string, unknown>)[idField]) === String(id)) || null;
    }
    const { __id: _drop, __deleted: _drop2, ...rest } = hit;
    void _drop;
    void _drop2;
    return { [idField]: id, ...rest } as unknown as T;
  }

  async atomicStockAdjust(productId: string, delta: number, requireSufficiency: boolean): Promise<StockAdjustResult> {
    // The file driver serialises through its promise queue, which gives the
    // same "one writer at a time" guarantee a Mongo conditional update gives.
    let result: StockAdjustResult = { ok: false, error: 'PRODUCT_NOT_FOUND' };
    this.queue = this.queue.then(async () => {
      const map = await this.readAll<Record<string, unknown>>('products');
      const entry = Array.from(map.values()).find((p) => String(p.__id) === String(productId) || String(p.sku) === String(productId));
      if (!entry) {
        result = { ok: false, error: 'PRODUCT_NOT_FOUND' };
        return;
      }
      const before = Number(entry.stock ?? 0);
      const after = before + delta;
      if (requireSufficiency && after < 0) {
        result = { ok: false, before, after: before, error: 'INSUFFICIENT_STOCK' };
        return;
      }
      const updated = { ...entry, stock: Math.max(0, after) };
      await fsp.appendFile(this.file('products'), `${this.serialize(updated)}\n`, 'utf8');
      result = { ok: true, before, after: Math.max(0, after) };
    });
    await this.queue;
    return result;
  }

  async claimIdempotency(key: string, meta: Record<string, unknown>): Promise<{ replayed: boolean; record?: { orderNumber?: string; orderId?: string } }> {
    const existing = await this.findOne<{ orderNumber?: string; orderId?: string }>('idempotency', 'key', key);
    if (existing) return { replayed: true, record: existing };
    await this.upsertOne('idempotency', 'key', { key, ...meta, claimedAt: new Date().toISOString() });
    return { replayed: false };
  }

  async close(): Promise<void> {
    await this.queue;
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const started = Date.now();
    try {
      await fsp.access(this.root);
      return { ok: true, latencyMs: Date.now() - started, detail: this.root };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, detail: (err as Error).message };
    }
  }
}

// ---------------------------------------------------------------------------
// Memory driver — explicitly volatile.
// ---------------------------------------------------------------------------

export class MemoryDriver implements StoreDriver {
  readonly name: DriverName = 'memory';
  private data = new Map<string, Map<string, Record<string, unknown>>>();
  private products = new Map<string, Record<string, unknown>>();

  async init(): Promise<void> {
    /* nothing to open */
  }

  private bucket(collection: string): Map<string, Record<string, unknown>> {
    let b = this.data.get(collection);
    if (!b) {
      b = new Map();
      this.data.set(collection, b);
    }
    return b;
  }

  async findAll<T>(collection: string, idField: string): Promise<T[]> {
    return Array.from(this.bucket(collection).values()).map((d) => ({ ...d }) as T).filter((d) => (d as Record<string, unknown>)[idField] !== undefined);
  }

  async upsertMany<T>(collection: string, idField: string, docs: T[]): Promise<void> {
    const b = this.bucket(collection);
    for (const doc of docs) {
      const record = doc as Record<string, unknown>;
      b.set(String(record[idField]), { ...record });
    }
    if (collection === 'products') {
      for (const doc of docs) {
        const record = doc as Record<string, unknown>;
        this.products.set(String(record.id), record);
      }
    }
  }

  async upsertOne<T>(collection: string, idField: string, doc: T): Promise<void> {
    await this.upsertMany(collection, idField, [doc]);
  }

  async removeMany(collection: string, _idField: string, ids: string[]): Promise<void> {
    const b = this.bucket(collection);
    for (const id of ids) b.delete(String(id));
  }

  async findOne<T>(collection: string, idField: string, id: string): Promise<T | null> {
    const hit = this.bucket(collection).get(String(id)) || (collection === 'products' ? this.products.get(String(id)) : undefined);
    return hit ? ({ ...hit } as T) : null;
  }

  async atomicStockAdjust(productId: string, delta: number, requireSufficiency: boolean): Promise<StockAdjustResult> {
    const entry = this.products.get(String(productId)) || Array.from(this.products.values()).find((p) => String(p.sku) === String(productId));
    if (!entry) return { ok: false, error: 'PRODUCT_NOT_FOUND' };
    const before = Number(entry.stock ?? 0);
    const after = before + delta;
    if (requireSufficiency && after < 0) return { ok: false, before, after: before, error: 'INSUFFICIENT_STOCK' };
    entry.stock = Math.max(0, after);
    return { ok: true, before, after: Math.max(0, after) };
  }

  async claimIdempotency(key: string, meta: Record<string, unknown>): Promise<{ replayed: boolean; record?: { orderNumber?: string; orderId?: string } }> {
    const b = this.bucket('idempotency');
    const hit = b.get(key);
    if (hit) return { replayed: true, record: hit as { orderNumber?: string; orderId?: string } };
    b.set(key, { key, ...meta });
    return { replayed: false };
  }

  async close(): Promise<void> {
    this.data.clear();
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    return { ok: true, latencyMs: 0, detail: 'VOLATILE — data is lost when the process exits' };
  }
}

// ---------------------------------------------------------------------------
// MongoDB driver — production.
// ---------------------------------------------------------------------------

export class MongoDriver implements StoreDriver {
  readonly name: DriverName = 'mongo';
  // Typing kept loose on purpose: the driver is loaded dynamically so the
  // dependency is optional at runtime (and never bundled into the browser).
  private client: import('mongodb').MongoClient | null = null;
  private dbInstance: import('mongodb').Db | null = null;
  private uri: string;
  private dbName: string;

  constructor(uri: string, dbName: string) {
    this.uri = uri;
    this.dbName = dbName;
  }

  async init(): Promise<void> {
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(this.uri, {
      serverSelectionTimeoutMS: 6000,
      connectTimeoutMS: 8000,
      maxPoolSize: 10,
      retryWrites: true,
      // Vercel/serverless: fail fast instead of hanging a function invocation.
      directConnection: config.isProduction ? undefined : undefined,
    });
    await this.client.connect();
    this.dbInstance = this.client.db(this.dbName);
    await this.ensureIndexes();
  }

  private get db(): import('mongodb').Db {
    if (!this.dbInstance) throw new Error('MongoDB driver used before init()');
    return this.dbInstance;
  }

  private async ensureIndexes(): Promise<void> {
    try {
      const indexes: { coll: string; spec: { key: Record<string, 1 | -1>; unique?: boolean; name?: string; background?: boolean }[] }[] = [
        { coll: 'products', spec: [
          { key: { slug: 1 }, unique: true, name: 'uniq_slug' },
          { key: { sku: 1 }, unique: true, name: 'uniq_sku' },
          { key: { categorySlug: 1, status: 1 }, name: 'cat_status' },
          { key: { stock: 1 }, name: 'stock' },
        ] },
        { coll: 'categories', spec: [{ key: { slug: 1 }, unique: true, name: 'uniq_slug' }] },
        { coll: 'orders', spec: [
          { key: { orderNumber: 1 }, unique: true, name: 'uniq_order_number' },
          { key: { 'customer.id': 1, createdAt: -1 }, name: 'customer_recent' },
          { key: { 'customer.phone': 1 }, name: 'customer_phone' },
          { key: { orderStatus: 1, createdAt: -1 }, name: 'status_recent' },
          { key: { idempotencyKey: 1 }, unique: true, name: 'uniq_idem' },
        ] },
        { coll: 'customers', spec: [
          { key: { email: 1 }, unique: true, name: 'uniq_email' },
          { key: { phoneCanonical: 1 }, unique: true, name: 'uniq_phone' },
        ] },
        { coll: 'staffUsers', spec: [{ key: { email: 1 }, unique: true, name: 'uniq_email' }] },
        { coll: 'coupons', spec: [{ key: { code: 1 }, unique: true, name: 'uniq_code' }] },
        { coll: 'suppliers', spec: [{ key: { code: 1 }, unique: true, name: 'uniq_code' }] },
        { coll: 'inventoryTransactions', spec: [{ key: { productId: 1, createdAt: -1 }, name: 'product_recent' }] },
        { coll: 'auditLogs', spec: [{ key: { timestamp: -1 }, name: 'recent' }] },
        { coll: 'idempotency', spec: [{ key: { key: 1 }, unique: true, name: 'uniq_key' }, { key: { expiresAt: 1 }, name: 'ttl' }] },
        { coll: 'revokedSessions', spec: [{ key: { id: 1 }, unique: true, name: 'uniq_id' }] },
      ];

      for (const entry of indexes) {
        for (const spec of entry.spec) {
          await this.db.collection(entry.coll).createIndex(spec.key, {
            unique: spec.unique,
            name: spec.name,
            background: true,
            ...(entry.coll === 'idempotency' && spec.name === 'ttl' ? { expireAfterSeconds: 86400 } : {}),
          });
        }
      }
    } catch (err) {
      // Index creation must never block boot (e.g. pre-existing conflicts).
      log.warn('persistence', 'index_setup_partial', (err as Error).message);
    }
  }

  private col(collection: string): import('mongodb').Collection {
    return this.db.collection(collection);
  }

  async findAll<T>(collection: string, idField: string): Promise<T[]> {
    const docs = await this.col(collection).find({}).toArray();
    return docs.map((doc) => {
      const { _id, ...rest } = doc as Record<string, unknown> & { _id?: unknown };
      void _id;
      if (!rest[idField]) rest[idField] = doc._id;
      return rest as T;
    });
  }

  async upsertMany<T>(collection: string, idField: string, docs: T[]): Promise<void> {
    if (!docs.length) return;
    const ops = docs.map((doc) => {
      const record = doc as Record<string, unknown>;
      const id = String(record[idField]);
      const { [idField]: _idField, ...rest } = record;
      void _idField;
      return {
        updateOne: {
          filter: { _id: id },
          update: { $set: { ...rest, [idField]: id } },
          upsert: true,
        },
      };
    });
    await this.col(collection).bulkWrite(ops as never, { ordered: false });
  }

  async upsertOne<T>(collection: string, idField: string, doc: T): Promise<void> {
    await this.upsertMany(collection, idField, [doc]);
  }

  async removeMany(collection: string, idField: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    await this.col(collection).deleteMany({ [idField]: { $in: ids } } as never);
  }

  async findOne<T>(collection: string, idField: string, id: string): Promise<T | null> {
    const doc = await this.col(collection).findOne({ [idField]: id } as never);
    if (!doc) return null;
    const { _id, ...rest } = doc as Record<string, unknown> & { _id?: unknown };
    void _id;
    return { [idField]: id, ...rest } as T;
  }

  /**
   * Atomic conditional decrement — the real oversell guard.
   * `updateOne` with a `{ stock: { $gte: qty } }` filter is atomic per
   * document, so two concurrent checkouts cannot both take the last unit.
   */
  async atomicStockAdjust(productId: string, delta: number, requireSufficiency: boolean): Promise<StockAdjustResult> {
    const col = this.col('products');
    const identity = { $or: [{ id: productId }, { sku: productId }, { _id: productId }] };
    const abs = Math.abs(delta);

    const filter: Record<string, unknown> = requireSufficiency
      ? { ...identity, stock: { $gte: abs } }
      : { ...identity };

    const result = await col.findOneAndUpdate(
      filter as never,
      { $inc: { stock: delta } } as never,
      { returnDocument: 'after' } as never
    );

    const value = (result as unknown as { value?: Record<string, unknown> } | null)?.value ?? null;
    if (value) {
      return { ok: true, before: Number(value.stock) - delta, after: Number(value.stock) };
    }

    if (!requireSufficiency) {
      const existing = await col.findOne(identity as never);
      if (!existing) return { ok: false, error: 'PRODUCT_NOT_FOUND' };
      await col.updateOne(identity as never, { $set: { stock: Math.max(0, Number((existing as { stock?: number }).stock ?? 0) + delta) } } as never);
      return { ok: true };
    }

    // Conditional update matched nothing: distinguish "no such product" from
    // "not enough stock" so the API can report the right reason.
    const exists = await col.findOne(identity as never);
    if (!exists) return { ok: false, error: 'PRODUCT_NOT_FOUND' };
    const before = Number((exists as { stock?: number }).stock ?? 0);
    return { ok: false, before, after: before, error: 'INSUFFICIENT_STOCK' };
  }

  async claimIdempotency(key: string, meta: Record<string, unknown>): Promise<{ replayed: boolean; record?: { orderNumber?: string; orderId?: string } }> {
    const col = this.col('idempotency');
    try {
      await col.insertOne({ _id: key, key, ...meta, expiresAt: new Date(Date.now() + 86400_000) } as never);
      return { replayed: false };
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        const existing = await col.findOne({ key } as never);
        return { replayed: true, record: (existing || {}) as { orderNumber?: string; orderId?: string } };
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    await this.client?.close();
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; detail?: string }> {
    const started = Date.now();
    try {
      await this.db.command({ ping: 1 });
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, detail: (err as Error).message };
    }
  }
}

