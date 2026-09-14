/**
 * Persistence facade used by the rest of the server.
 *
 * Responsibilities:
 *  - pick a driver from configuration (mongo > file > memory),
 *  - hydrate the in-memory read model at boot,
 *  - queue snapshot syncs for changed documents and flush them before an API
 *    response completes (so a serverless invocation cannot end with an
 *    unwritten order),
 *  - expose atomic stock allocation and idempotency claims.
 *
 * @license Apache-2.0
 */

import { createHash } from 'node:crypto';
import { config, persistenceConfigured } from '../config';
import { log } from '../http/errors';
import {
  APPEND_COLLECTIONS,
  FileDriver,
  MemoryDriver,
  MongoDriver,
  SNAPSHOT_COLLECTIONS,
  type StockAdjustResult,
  type StoreDriver,
} from './drivers';

export type PersistenceMode = 'mongo' | 'file' | 'memory';

interface SnapshotState {
  dirty: boolean;
  /** id -> content hash, so a sync only writes what actually changed. */
  digests: Map<string, string>;
  idField: string;
}

class PersistenceStore {
  private driver: StoreDriver | null = null;
  private _mode: PersistenceMode = 'memory';
  private initPromise: Promise<void> | null = null;
  private pending: Promise<unknown>[] = [];
  private snapshots = new Map<string, SnapshotState>();
  private hydrated = false;
  private bootError: string | null = null;

  get mode(): PersistenceMode {
    return this._mode;
  }

  /** True when durable storage is in use (mongo or file). */
  get durable(): boolean {
    return this._mode === 'mongo' || this._mode === 'file';
  }

  get isHydrated(): boolean {
    return this.hydrated;
  }

  get lastBootError(): string | null {
    return this.bootError;
  }

  /**
   * Selects and opens the driver. Idempotent and safe to call from every
   * request (the serverless entry point awaits this before proxying).
   */
  async ensureReady(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      const preferred = (process.env.KISHOLOY_PERSISTENCE_DRIVER || '').trim().toLowerCase();
      const useFile = preferred === 'file' || (!persistenceConfigured() && !config.isProduction && preferred !== 'memory');

      try {
        if (persistenceConfigured() && preferred !== 'file' && preferred !== 'memory') {
          const driver = new MongoDriver(config.persistence.mongoUri!, config.persistence.mongoDbName);
          await driver.init();
          this.driver = driver;
          this._mode = 'mongo';
          log.info('persistence', `durable store online (mongodb / ${config.persistence.mongoDbName})`);
        } else if (useFile) {
          const driver = new FileDriver();
          await driver.init();
          this.driver = driver;
          this._mode = 'file';
          log.warn('persistence', 'using FILE persistence — fine for local dev/tests, not for a multi-instance production deployment');
        } else {
          const driver = new MemoryDriver();
          await driver.init();
          this.driver = driver;
          this._mode = 'memory';
          if (config.isProduction) {
            this.bootError =
              'No durable datastore configured (MONGODB_URI missing). Orders and admin edits will NOT survive cold starts.';
            if (config.security.requirePersistence) {
              throw new Error(this.bootError);
            }
            log.warn('persistence', this.bootError);
          }
        }
      } catch (err) {
        const message = (err as Error).message;
        // A misconfigured Atlas URI must not take the whole storefront down:
        // degrade to the volatile store, but say so loudly and in health.
        if (this._mode !== 'memory') {
          log.error('persistence', `driver init failed (${message}) — falling back to volatile memory store`, err);
          const driver = new MemoryDriver();
          await driver.init();
          this.driver = driver;
          this._mode = 'memory';
          this.bootError = `Durable store unavailable: ${message}`;
        } else {
          throw err;
        }
      }

      for (const name of SNAPSHOT_COLLECTIONS) {
        this.snapshots.set(name, { dirty: false, digests: new Map(), idField: name === 'siteContent' ? 'id' : 'id' });
      }
      for (const name of APPEND_COLLECTIONS) {
        this.snapshots.set(name, { dirty: false, digests: new Map(), idField: 'id' });
      }
    })();
    return this.initPromise;
  }

  /** Called once at boot; loads durable collections into the read model. */
  async hydrate(loader: (collection: string, idField: string) => Promise<number>): Promise<void> {
    await this.ensureReady();
    if (this.hydrated) return;
    try {
      let total = 0;
      for (const [name, state] of this.snapshots) {
        try {
          total += await loader(name, state.idField);
        } catch (err) {
          log.warn('persistence', `hydrate_failed:${name}`, (err as Error).message);
        }
      }
      this.hydrated = true;
      log.info('persistence', `hydrated ${total} documents from ${this._mode} store`);
    } catch (err) {
      log.error('persistence', 'hydration_error', err);
      throw err;
    }
  }

  loadCollection<T>(collection: string, idField = 'id'): Promise<T[]> {
    if (!this.driver) return Promise.resolve([]);
    return this.driver.findAll<T>(collection, idField);
  }

  /**
   * Flag a collection as changed. Cheap to call on every mutation; the actual
   * diff happens at flush time.
   */
  markDirty(collection: string): void {
    const state = this.snapshots.get(collection);
    if (state) state.dirty = true;
    else this.snapshots.set(collection, { dirty: true, digests: new Map(), idField: 'id' });
  }

  private hash(doc: Record<string, unknown>, _idField: string): string {
    /**
     * Full-document digest: cheaper to reason about than a field allow-list and
     * it cannot miss a change in a field nobody remembered to enumerate.
     *
     * SHA-256 rather than SHA-1. This digest is change detection, never a
     * security boundary - but a collision-prone hash sitting in the persistence
     * layer invites the pattern to be copied somewhere it does matter, and the
     * cost difference at this size is nothing.
     */
    return createHash('sha256').update(JSON.stringify(doc)).digest('hex');
  }

  /**
   * Queue a durable sync of `docs` for `collection`.
   * Snapshot collections diff against the last sync; append collections only
   * push documents not seen before.
   */
  sync<T extends object>(collection: string, docs: T[], idField = 'id'): void {
    // Called from the read model on every mutation; the diff is deferred to
    // flush() so the hot path stays synchronous.
    const state = this.snapshots.get(collection);
    if (!state) return;
    state.dirty = true;
    (state as SnapshotState & { pendingDocs?: T[] }).pendingDocs = docs;
    (state as SnapshotState & { pendingIdField?: string }).pendingIdField = idField;
  }

  /** Single-document write used by hot paths (order create, session revoke). */
  upsertOne<T extends object>(collection: string, doc: T, idField = 'id'): Promise<void> {
    const promise = (async () => {
      await this.ensureReady();
      if (!this.driver) return;
      await this.driver.upsertOne(collection, idField, doc);
      const state = this.snapshots.get(collection);
      if (state) {
        const record = doc as Record<string, unknown>;
        state.digests.set(String(record[idField]), this.hash(record, idField));
      }
    })().catch((err) => {
      log.error('persistence', `write_failed:${collection}`, err);
    });
    this.pending.push(promise);
    return promise;
  }

  /** Await every queued durable write. Called before a response finishes. */
  async flush(): Promise<void> {
    if (!this.driver) return;
    await this.ensureReady();

    const jobs: Promise<unknown>[] = [];

    for (const [name, state] of this.snapshots as Map<string, SnapshotState & { pendingDocs?: unknown[]; pendingIdField?: string }>) {
      if (!state.dirty || !state.pendingDocs || !state.pendingDocs.length) continue;
      const docs = state.pendingDocs as Record<string, unknown>[];
      const idField = state.pendingIdField || state.idField;
      const toWrite: Record<string, unknown>[] = [];
      const seen = new Set<string>();

      const isAppendOnly = (APPEND_COLLECTIONS as readonly string[]).includes(name);

      for (const doc of docs) {
        const id = String(doc[idField] ?? '');
        if (!id || id === 'undefined') continue;
        seen.add(id);
        const digest = this.hash(doc, idField);
        if (isAppendOnly) {
          if (state.digests.has(id)) continue;
        } else if (state.digests.get(id) === digest) {
          continue;
        }
        state.digests.set(id, digest);
        toWrite.push(doc);
      }

      if (!isAppendOnly) {
        const removed: string[] = [];
        for (const id of state.digests.keys()) if (!seen.has(id)) removed.push(id);
        if (removed.length) {
          jobs.push(
            this.driver
              .removeMany(name, idField, removed)
              .then(() => removed.forEach((id) => state.digests.delete(id)))
              .catch((err) => log.error('persistence', `delete_failed:${name}`, err))
          );
        }
      }

      if (toWrite.length) {
        jobs.push(
          this.driver
            .upsertMany(name, idField, toWrite)
            .catch((err) => log.error('persistence', `sync_failed:${name}`, err))
        );
      }
      state.dirty = false;
      state.pendingDocs = undefined;
    }

    const queued = this.pending.splice(0, this.pending.length);
    await Promise.all([...jobs, ...queued]);
  }

  async atomicStockAdjust(productId: string, delta: number, requireSufficiency = true): Promise<StockAdjustResult | null> {
    await this.ensureReady();
    if (!this.driver) return null;
    try {
      return await this.driver.atomicStockAdjust(productId, delta, requireSufficiency);
    } catch (err) {
      log.error('persistence', `atomic_stock_failed:${productId}`, err);
      return null;
    }
  }

  async claimIdempotency(key: string, meta: Record<string, unknown>): Promise<{ replayed: boolean; record?: { orderNumber?: string; orderId?: string } } | null> {
    await this.ensureReady();
    const driver = this.driver as (StoreDriver & { claimIdempotency?: (k: string, m: Record<string, unknown>) => Promise<{ replayed: boolean; record?: { orderNumber?: string; orderId?: string } }> });
    if (!driver?.claimIdempotency) return null;
    try {
      return await driver.claimIdempotency(key, meta);
    } catch (err) {
      log.warn('persistence', `idempotency_claim_failed`, (err as Error).message);
      return null;
    }
  }

  async health(): Promise<{ mode: PersistenceMode; durable: boolean; ok: boolean; latencyMs: number; detail?: string; bootError?: string | null }> {
    await this.ensureReady();
    const h = this.driver ? await this.driver.health() : { ok: false, latencyMs: 0, detail: 'driver not initialised' };
    return { mode: this._mode, durable: this.durable, bootError: this.bootError, ...h };
  }

  async close(): Promise<void> {
    try {
      await this.flush();
    } catch {
      /* best effort */
    }
    await this.driver?.close();
  }
}

export const persistence = new PersistenceStore();
export { SNAPSHOT_COLLECTIONS, APPEND_COLLECTIONS };
