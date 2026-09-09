/**
 * Upstash Serverless Redis REST Service
 * Provides distributed caching, rate-limiting store, idempotency locks, and job queues
 * Works via zero-dependency HTTP REST API compatible with serverless & containers
 * @license Apache-2.0
 */

export interface UpstashHealth {
  status: 'ONLINE' | 'OFFLINE' | 'DEGRADED';
  url: string;
  latencyMs: number;
  error?: string;
}

export class UpstashRedisService {
  private restUrl: string;
  private restToken: string;

  constructor() {
    this.restUrl = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
    this.restToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  }

  public isConfigured(): boolean {
    return Boolean(this.restUrl && this.restToken);
  }

  /**
   * Execute raw Redis command array via Upstash REST API
   * e.g. execute(['SET', 'key', 'value', 'EX', 3600])
   */
  public async execute<T = any>(command: any[]): Promise<T | null> {
    if (!this.isConfigured()) {
      return null;
    }

    try {
      const res = await fetch(`${this.restUrl}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.restToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(command),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn(`[Upstash Redis Error] HTTP ${res.status}: ${text}`);
        return null;
      }

      const data = await res.json();
      if (data.error) {
        console.warn(`[Upstash Redis Command Error]:`, data.error);
        return null;
      }

      return data.result as T;
    } catch (err: any) {
      console.warn(`[Upstash Redis Connection Failed]:`, err.message);
      return null;
    }
  }

  /**
   * Health check / Ping
   */
  public async ping(): Promise<UpstashHealth> {
    if (!this.isConfigured()) {
      return {
        status: 'OFFLINE',
        url: this.restUrl || 'not-configured',
        latencyMs: 0,
        error: 'Upstash REST credentials not supplied',
      };
    }

    const start = Date.now();
    try {
      const result = await this.execute(['PING']);
      const latencyMs = Date.now() - start;

      if (result === 'PONG') {
        return {
          status: 'ONLINE',
          url: this.restUrl,
          latencyMs,
        };
      }

      return {
        status: 'DEGRADED',
        url: this.restUrl,
        latencyMs,
        error: `Unexpected PING response: ${result}`,
      };
    } catch (err: any) {
      return {
        status: 'OFFLINE',
        url: this.restUrl,
        latencyMs: Date.now() - start,
        error: err.message,
      };
    }
  }

  /**
   * Get cached value
   */
  public async get<T = any>(key: string): Promise<T | null> {
    const raw = await this.execute<string>(['GET', key]);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  /**
   * Set cached value with optional expiration in seconds
   */
  public async set(key: string, value: any, ttlSeconds?: number): Promise<boolean> {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const command = ttlSeconds 
      ? ['SET', key, payload, 'EX', ttlSeconds]
      : ['SET', key, payload];
    const res = await this.execute(command);
    return res === 'OK';
  }

  /**
   * Delete one or more keys
   */
  public async del(key: string): Promise<number> {
    const res = await this.execute<number>(['DEL', key]);
    return res || 0;
  }

  /**
   * Atomic increment for rate-limiting
   */
  public async incr(key: string, ttlSeconds: number = 60): Promise<number> {
    const count = await this.execute<number>(['INCR', key]);
    if (count === 1) {
      await this.execute(['EXPIRE', key, ttlSeconds]);
    }
    return count || 1;
  }

  /**
   * Queue push (FIFO)
   */
  public async lpush(queueKey: string, value: any): Promise<number> {
    const payload = typeof value === 'string' ? value : JSON.stringify(value);
    const res = await this.execute<number>(['LPUSH', queueKey, payload]);
    return res || 0;
  }

  /**
   * Queue pop (FIFO)
   */
  public async rpop<T = any>(queueKey: string): Promise<T | null> {
    const raw = await this.execute<string>(['RPOP', queueKey]);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }
}

export const upstashRedisService = new UpstashRedisService();
