/**
 * MongoDB Atlas Persistent Cloud Storage Service
 * Provides durable cloud replication for Orders, Catalog, Customers, and Disaster Recovery Snapshots
 * Lazy initialized to guarantee zero container crash risk
 * @license Apache-2.0
 */

import { MongoClient, Db } from 'mongodb';

export interface MongoHealth {
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  dbName: string;
  latencyMs: number;
  collectionsCount?: number;
  error?: string;
}

export class MongoService {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private uri: string;
  private dbName: string;
  private connectingPromise: Promise<boolean> | null = null;
  private lastError: string | null = null;

  constructor() {
    this.uri = process.env.MONGODB_URI || '';
    this.dbName = process.env.MONGODB_DB_NAME || 'kisholoybd';
  }

  public isConfigured(): boolean {
    return Boolean(this.uri && this.uri.startsWith('mongodb'));
  }

  /**
   * Connect to MongoDB Atlas lazily
   */
  public async getDb(): Promise<Db | null> {
    if (this.db) return this.db;
    if (!this.isConfigured()) return null;

    if (this.connectingPromise) {
      await this.connectingPromise;
      return this.db;
    }

    this.connectingPromise = (async () => {
      try {
        const client = new MongoClient(this.uri, {
          serverSelectionTimeoutMS: 5000,
          connectTimeoutMS: 8000,
        });

        await client.connect();
        this.client = client;
        this.db = client.db(this.dbName);
        console.log(`[MongoDB Atlas] Connected successfully to database: ${this.dbName}`);
        return true;
      } catch (err: any) {
        this.lastError = err.message || 'Connection failed';
        console.warn(`[MongoDB Atlas] Connection could not be established:`, err.message);
        this.client = null;
        this.db = null;
        return false;
      } finally {
        this.connectingPromise = null;
      }
    })();

    await this.connectingPromise;
    return this.db;
  }

  /**
   * Health Check with latency measurement
   */
  public async healthCheck(): Promise<MongoHealth> {
    if (!this.isConfigured()) {
      return {
        status: 'DISCONNECTED',
        dbName: this.dbName,
        latencyMs: 0,
        error: 'MONGODB_URI environment variable not configured',
      };
    }

    const start = Date.now();
    try {
      const db = await this.getDb();
      if (!db) {
        const errorMsg = this.lastError
          ? (this.lastError.includes('ENOTFOUND')
              ? 'Atlas cluster querySrv pending / whitelist (Verify 0.0.0.0/0 IP Access in Atlas)'
              : this.lastError)
          : 'Failed to obtain database handle';
        return {
          status: 'DISCONNECTED',
          dbName: this.dbName,
          latencyMs: Date.now() - start,
          error: errorMsg,
        };
      }

      await db.command({ ping: 1 });
      const collections = await db.listCollections().toArray();

      return {
        status: 'CONNECTED',
        dbName: this.dbName,
        latencyMs: Date.now() - start,
        collectionsCount: collections.length,
      };
    } catch (err: any) {
      return {
        status: 'ERROR',
        dbName: this.dbName,
        latencyMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  /**
   * Upsert an order in MongoDB
   */
  public async syncOrder(order: any): Promise<boolean> {
    try {
      const db = await this.getDb();
      if (!db) return false;
      await db.collection('orders').updateOne(
        { id: order.id },
        { $set: { ...order, lastSyncedAt: new Date().toISOString() } },
        { upsert: true }
      );
      return true;
    } catch (err: any) {
      console.warn(`[MongoDB Sync Order Error]:`, err.message);
      return false;
    }
  }

  /**
   * Upsert a customer profile in MongoDB
   */
  public async syncCustomer(customer: any): Promise<boolean> {
    try {
      const db = await this.getDb();
      if (!db) return false;
      await db.collection('customers').updateOne(
        { id: customer.id },
        { $set: { ...customer, lastSyncedAt: new Date().toISOString() } },
        { upsert: true }
      );
      return true;
    } catch (err: any) {
      console.warn(`[MongoDB Sync Customer Error]:`, err.message);
      return false;
    }
  }

  /**
   * Append an audit log to MongoDB
   */
  public async syncAuditLog(log: any): Promise<boolean> {
    try {
      const db = await this.getDb();
      if (!db) return false;
      await db.collection('audit_logs').insertOne({
        ...log,
        syncedAt: new Date().toISOString(),
      });
      return true;
    } catch (err: any) {
      console.warn(`[MongoDB Sync Audit Log Error]:`, err.message);
      return false;
    }
  }

  /**
   * Save a disaster recovery database snapshot into MongoDB
   */
  public async saveBackupSnapshot(manifest: any, payload: any): Promise<boolean> {
    try {
      const db = await this.getDb();
      if (!db) return false;
      await db.collection('backup_snapshots').updateOne(
        { id: manifest.id },
        { $set: { manifest, payload, createdAt: new Date().toISOString() } },
        { upsert: true }
      );
      return true;
    } catch (err: any) {
      console.warn(`[MongoDB Save Backup Error]:`, err.message);
      return false;
    }
  }
}

export const mongoService = new MongoService();
