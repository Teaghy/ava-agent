import { defineConfig } from 'drizzle-kit';
import { loadConfig } from './src/config/index.js';
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/plugins/storage-postgres/schema/index.ts',
  out: './drizzle',
  dbCredentials: { url: loadConfig().DATABASE_URL },
});
