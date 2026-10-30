import { z } from 'zod';
export const MAX_PLUGIN_UPLOAD_BYTES = 10 * 1024 * 1024;

export const pluginSlotSchema = z.enum([
  'decision',
  'model',
  'embedding',
  'reranker',
  'memory',
  'rag',
  'responsePolicy',
]);
export type PluginSlot = z.infer<typeof pluginSlotSchema>;
const registration = z
  .object({
    name: z.string().trim().min(1).max(80),
    entry: z.string().trim().min(1).max(2000),
    kind: z.enum(['extension', 'provider']),
    slot: pluginSlotSchema.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    enabled: z.boolean().default(true),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
      .max(80)
      .optional(),
  })
  .strict();
export const pluginInstallSchema = registration.superRefine((value, ctx) => {
  if ((value.kind === 'provider') !== (value.slot !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Provider 必须选择服务槽位，扩展插件不能指定槽位。' });
});
export type PluginInstallRequest = z.input<typeof pluginInstallSchema>;
export const pluginManifestSchema = registration
  .pick({ name: true, kind: true, slot: true })
  .extend({
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/)
      .max(80),
    entry: z.string().min(1).max(180),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.kind === 'provider') !== (v.slot !== undefined))
      ctx.addIssue({ code: 'custom', message: 'Provider 必须选择槽位，扩展插件不能指定槽位。' });
  });
export const pluginActionSchema = z
  .object({
    id: z.string().uuid(),
    action: z.enum(['enable', 'disable', 'remove']),
  })
  .strict();
export type PluginActionRequest = z.infer<typeof pluginActionSchema>;
export const pluginConfigureSchema = z
  .object({
    id: z.string().uuid(),
    config: z.record(z.string(), z.unknown()),
  })
  .strict();
export type PluginConfigureRequest = z.infer<typeof pluginConfigureSchema>;
export const pluginViewSchema = registration.omit({ config: true }).extend({
  id: z.string().uuid(),
  status: z.enum(['active', 'disabled', 'failed']),
  error: z.string().optional(),
});
export type PluginView = z.infer<typeof pluginViewSchema>;
export const runtimePluginStatusSchema = z.enum(['active', 'loading', 'failed', 'disabled']);
export const providerViewSchema = z.object({
  slot: pluginSlotSchema,
  source: z.enum(['default', 'application', 'plugin']),
  name: z.string(),
  pluginId: z.string().uuid().optional(),
  status: runtimePluginStatusSchema.optional(),
});
export type ProviderView = z.infer<typeof providerViewSchema>;
export const runtimePluginViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  description: z.string(),
  category: z.enum([
    'engine',
    'model',
    'knowledge',
    'tool',
    'storage',
    'ops',
    'transport',
    'extension',
  ]),
  source: z.enum(['builtin', 'application']),
  status: runtimePluginStatusSchema,
  services: z.array(z.string()),
  dependencies: z.array(z.object({ name: z.string(), required: z.boolean() })),
  parentId: z.string().optional(),
});
export type RuntimePluginView = z.infer<typeof runtimePluginViewSchema>;
export const pluginManagerSnapshotSchema = z.object({
  enabled: z.boolean(),
  safeMode: z.boolean(),
  plugins: z.array(pluginViewSchema),
  providers: z.array(providerViewSchema),
  runtimePlugins: z.array(runtimePluginViewSchema).default([]),
});
export type PluginManagerSnapshot = z.infer<typeof pluginManagerSnapshotSchema>;
