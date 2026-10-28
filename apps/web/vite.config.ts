import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const port = z.coerce.number().int().min(1).max(65535).default(3000).parse(process.env.PORT);
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${port}`,
      '/health': `http://127.0.0.1:${port}`,
    },
  },
});
