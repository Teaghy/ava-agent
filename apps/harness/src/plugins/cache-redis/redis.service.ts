import { Redis } from 'ioredis';
import type { CacheService } from '../../core/cache/cache.service.js';
export class RedisCache implements CacheService {
  constructor(private client: Redis) {}
  async get<T>(key: string): Promise<T | undefined> {
    const value = await this.client.get(key);
    return value === null ? undefined : (JSON.parse(value) as T);
  }
  async set(key: string, value: unknown, ttl: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttl);
  }
  async acquire(key: string, token: string, ttl: number): Promise<boolean> {
    return (await this.client.set(key, JSON.stringify(token), 'EX', ttl, 'NX')) === 'OK';
  }
  async renew(key: string, token: string, ttl: number): Promise<boolean> {
    return (
      (await this.client.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('expire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        key,
        JSON.stringify(token),
        ttl,
      )) === 1
    );
  }
  async release(key: string, token: string): Promise<void> {
    await this.client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      JSON.stringify(token),
    );
  }
  async rateLimit(key: string, limit: number, window: number): Promise<boolean> {
    const count = await this.client.eval(
      "local n = redis.call('incr', KEYS[1]); if n == 1 then redis.call('expire', KEYS[1], ARGV[1]) end; return n",
      1,
      key,
      window,
    );
    return Number(count) <= limit;
  }
}
