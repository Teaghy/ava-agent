import type { Context } from 'cordis';
import type { CacheService } from '../../core/cache/cache.service.js';
export class InMemoryCache implements CacheService {
  private values = new Map<string, { value: unknown; expires: number }>();
  async get<T>(key: string): Promise<T | undefined> {
    const row = this.values.get(key);
    if (!row || row.expires <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    return structuredClone(row.value) as T;
  }
  async set(key: string, value: unknown, ttl: number): Promise<void> {
    this.values.set(key, { value: structuredClone(value), expires: Date.now() + ttl * 1000 });
  }
  async acquire(key: string, token: string, ttl: number): Promise<boolean> {
    const row = this.values.get(key);
    if (row && row.expires > Date.now()) return false;
    this.values.set(key, { value: token, expires: Date.now() + ttl * 1000 });
    return true;
  }
  async renew(key: string, token: string, ttl: number): Promise<boolean> {
    if ((await this.get(key)) !== token) return false;
    await this.set(key, token, ttl);
    return true;
  }
  async release(key: string, token: string): Promise<void> {
    if ((await this.get(key)) === token) this.values.delete(key);
  }
  async rateLimit(key: string, limit: number, window: number): Promise<boolean> {
    const row = this.values.get(key);
    const count = row && row.expires > Date.now() ? Number(row.value) : 0;
    this.values.set(key, {
      value: count + 1,
      expires: count ? row!.expires : Date.now() + window * 1000,
    });
    return count < limit;
  }
}
export const cacheMemoryPlugin = {
  name: 'cache-memory',
  provide: ['cache'],
  apply(ctx: Context) {
    ctx.provide('cache', new InMemoryCache());
  },
};
