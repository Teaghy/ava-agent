import type { Context } from 'cordis';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as s from './schema/index.js';
import { PostgresStorage } from './db.js';
export { PostgresStorage } from './db.js';
export const storagePostgresPlugin = {
  name: 'storage-postgres',
  provide: ['storage'],
  async apply(ctx: Context, config: { url: string }) {
    const pool = new pg.Pool({
      connectionString: config.url,
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 10000,
    });
    ctx.effect(() => () => pool.end());
    await pool.query('select 1');
    ctx.provide('storage', new PostgresStorage(drizzle(pool, { schema: s })));
  },
};
