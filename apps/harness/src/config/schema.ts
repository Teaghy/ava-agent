import { z } from 'zod';
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const principal = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  permissions: z.array(z.enum(['READ', 'WRITE', 'CRITICAL'])),
  admin: z.boolean().optional(),
});
export const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_MODE: z.enum(['mock', 'live']).default('mock'),
    PORT: z.coerce.number().int().min(0).max(65535).default(3000),
    HOST: z.string().default('127.0.0.1'),
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
    API_KEYS: z
      .string()
      .default('{}')
      .transform((s, ctx) => {
        try {
          return z.record(z.string(), principal).parse(JSON.parse(s));
        } catch {
          ctx.addIssue({
            code: 'custom',
            message: 'API_KEYS must be a JSON object of API keys to principals',
          });
          return z.NEVER;
        }
      }),
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
    if (c.APP_MODE === 'live' && (!c.LLM_API_KEY || !c.EMBEDDING_API_KEY))
      ctx.addIssue({ code: 'custom', message: 'Live mode requires LLM and embedding credentials' });
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
