import { z } from 'zod';
export const defaultModelCompatibility = {
  messageFormat: 'auto',
  jsonOutput: 'auto',
  streamUsage: 'auto',
} as const;
export const modelCompatibilitySchema = z
  .object({
    messageFormat: z.enum(['auto', 'preserve', 'single-system-first']),
    jsonOutput: z.enum(['auto', 'json-object', 'prompt']),
    streamUsage: z.enum(['auto', 'enabled', 'disabled']),
  })
  .strict();
export const resolvedModelCompatibilitySchema = z.object({
  messageFormat: z.enum(['preserve', 'single-system-first']),
  jsonOutput: z.enum(['json-object', 'prompt']),
  streamUsage: z.boolean(),
  source: z.enum(['default', 'known-model', 'override']),
  rule: z.object({ id: z.string(), label: z.string() }).optional(),
});
const endpoint = z
  .string()
  .trim()
  .url()
  .max(1000)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, 'Base URL 不能包含凭据、查询参数或片段')
  .transform((value) => value.replace(/\/+$/, ''));
export const modelConnectionSchema = z
  .object({ baseURL: endpoint, model: z.string().trim().min(1).max(200) })
  .strict();
export const embeddingConnectionSchema = modelConnectionSchema
  .extend({
    dimensions: z.number().int().min(1).max(65536),
    batchSize: z.number().int().min(1).max(2048),
  })
  .strict();
export const modelApplySchema = z
  .object({
    revision: z.number().int().nonnegative(),
    llm: modelConnectionSchema
      .extend({
        apiKey: z.string().trim().min(1).max(4096).nullable().optional(),
        compatibility: modelCompatibilitySchema.optional(),
      })
      .optional(),
    embedding: embeddingConnectionSchema
      .extend({ apiKey: z.string().trim().min(1).max(4096).nullable().optional() })
      .optional(),
  })
  .strict()
  .refine((value) => value.llm || value.embedding, '请选择要更新的模型');
export const modelJobSchema = z.object({
  id: z.string(),
  status: z.enum(['queued', 'validating', 'reindexing', 'applying', 'completed', 'failed']),
  processed: z.number(),
  total: z.number(),
  error: z.string().optional(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  checks: z.object({ structuredOutput: z.boolean(), streaming: z.boolean() }).optional(),
});
export const modelSettingsViewSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().optional(),
  persistent: z.boolean(),
  source: z.enum(['env', 'ops']),
  revision: z.number(),
  llm: modelConnectionSchema.extend({
    keyConfigured: z.boolean(),
    compatibility: modelCompatibilitySchema.default(defaultModelCompatibility),
    effectiveCompatibility: resolvedModelCompatibilitySchema.optional(),
  }),
  embedding: embeddingConnectionSchema.extend({
    keyConfigured: z.boolean(),
    collection: z.string(),
  }),
  job: modelJobSchema.optional(),
});
export type ModelApplyRequest = z.infer<typeof modelApplySchema>;
export type ModelSettingsView = z.infer<typeof modelSettingsViewSchema>;
export type ModelJob = z.infer<typeof modelJobSchema>;
export type ModelCompatibilityOptions = z.infer<typeof modelCompatibilitySchema>;
export type ResolvedModelCompatibility = z.infer<typeof resolvedModelCompatibilitySchema>;
