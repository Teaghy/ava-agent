import type { Context } from 'cordis';
import { Redis } from 'ioredis';
import { RedisCache } from './redis.service.js';
export { RedisCache } from './redis.service.js';
export const cacheRedisPlugin = {
  name: 'cache-redis',
  provide: ['cache'],
  async apply(ctx: Context, config: { url: string }) {
    const client = new Redis(config.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 5000,
      retryStrategy: () => null,
      keyPrefix: 'ava:',
    });
    client.on('error', () => {
      /* Command promises surface errors to the caller. */
    });
    ctx.effect(() => () => {
      client.disconnect();
    });
    await client.connect();
    ctx.provide('cache', new RedisCache(client));
  },
};
