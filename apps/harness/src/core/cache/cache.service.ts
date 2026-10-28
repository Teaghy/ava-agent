export interface CacheService {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  acquire(key: string, token: string, ttlSeconds: number): Promise<boolean>;
  renew(key: string, token: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
  rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}
