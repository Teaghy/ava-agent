import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../src/config/index.js';
const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
} finally {
  await pool.end();
}
