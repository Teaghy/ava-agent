import { z } from 'zod';
import { applicationPresetSchema } from '@ava/protocol';
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const principal = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  permissions: z.array(z.enum(['READ', 'WRITE', 'CRITICAL'])),
  admin: z.boolean().optional(),
  managePlugins: z.boolean().optional(),
  inspectTenants: z.array(z.string().min(1).max(200)).max(100).optional(),
});
const apiKeys = z
  .string()
  .default('{}')
  .transform((s, ctx) => {
    try {
      return z.record(z.string().min(1), principal).parse(JSON.parse(s));
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'API keys must be a JSON object of tokens to principals',
      });
      return z.NEVER;
    }
  });
export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_MODE: z.enum(['mock', 'live']).default('mock'),
    APP_PRESET: applicationPresetSchema.default('customer-service'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    HOST: z.string().default('127.0.0.1'),
    OPS_ENABLED: bool.default(false),
    OPS_HOST: z.string().min(1).default('127.0.0.1'),
    OPS_PORT: z.coerce.number().int().min(0).max(65535).default(3001),
    OPS_API_KEYS: apiKeys,
    PLUGIN_STATE_PATH: z.string().min(1).default('data/plugins.json'),
    PLUGIN_SAFE_MODE: bool.default(false),
    INFRA_MODE: z.enum(['memory', 'external']).optional(),
    DATABASE_URL: z.string().default('postgres://ava:ava@localhost:5432/ava'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    QDRANT_URL: z.string().url().default('http://localhost:6333'),
    QDRANT_API_KEY: z.string().default(''),
    QDRANT_COLLECTION: z.string().default('knowledge'),
    LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    LLM_API_KEY: z.string().default(''),
    LLM_MODEL: z.string().default('gpt-4.1-mini'),
    EMBEDDING_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    EMBEDDING_API_KEY: z.string().default(''),
    EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
    MEM0_ENABLED: bool.default(false),
    MEM0_URL: z.string().url().default('http://localhost:8888'),
    MEM0_API_KEY: z.string().default(''),
    API_KEYS: apiKeys,
    SEED_KNOWLEDGE: bool.default(true),
    SEED_TENANT_ID: z.string().default('demo'),
    OTEL_ENABLED: bool.default(false),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().default('http://localhost:4318'),
    MAX_AGENT_STEPS: z.coerce.number().int().positive().max(30).default(8),
    MAX_TOOL_CALLS: z.coerce.number().int().positive().max(30).default(10),
    MAX_RAG_SEARCHES: z.coerce.number().int().positive().max(10).default(3),
    CONTEXT_TOKEN_BUDGET: z.coerce.number().int().min(4000).max(64000).default(12000),
    RUN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(90000).default(90000),
  })
  .superRefine((c, ctx) => {
    if (c.OPS_ENABLED) {
      if (!Object.values(c.OPS_API_KEYS).some((p) => p.admin === true && p.managePlugins === true))
        ctx.addIssue({
          code: 'custom',
          message:
            'OPS_ENABLED requires a dedicated OPS_API_KEYS maintainer with admin && managePlugins',
        });
      if (Object.keys(c.OPS_API_KEYS).some((token) => Object.hasOwn(c.API_KEYS, token)))
        ctx.addIssue({ code: 'custom', message: 'OPS_API_KEYS must not reuse API_KEYS tokens' });
    }
    if (
      (c.APP_MODE === 'live' || c.NODE_ENV === 'production') &&
      Object.keys(c.API_KEYS).length === 0
    )
      ctx.addIssue({ code: 'custom', message: 'Live/production mode requires API_KEYS' });
    if (c.NODE_ENV === 'production' && c.APP_MODE === 'mock')
      ctx.addIssue({ code: 'custom', message: 'Production must use live infrastructure' });
    if (c.APP_MODE === 'live' && c.INFRA_MODE === 'memory')
      ctx.addIssue({ code: 'custom', message: 'Live mode must use external infrastructure' });
  });
export type Config = z.infer<typeof configSchema>;
