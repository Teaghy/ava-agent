import { z } from 'zod';

export const pluginSlotSchema = z.enum([
  'decision',
  'model',
  'embedding',
  'reranker',
  'memory',
  'rag',
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
  })
  .strict();
export const pluginInstallSchema = registration.superRefine((value, ctx) => {
  if ((value.kind === 'provider') !== (value.slot !== undefined))
    ctx.addIssue({ code: 'custom', message: 'Provider 必须选择服务槽位，扩展插件不能指定槽位。' });
});
export type PluginInstallRequest = z.input<typeof pluginInstallSchema>;
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
export const providerViewSchema = z.object({
  slot: pluginSlotSchema,
  source: z.enum(['default', 'application', 'plugin']),
  name: z.string(),
  pluginId: z.string().uuid().optional(),
});
export type ProviderView = z.infer<typeof providerViewSchema>;
export const pluginManagerSnapshotSchema = z.object({
  enabled: z.boolean(),
  safeMode: z.boolean(),
  plugins: z.array(pluginViewSchema),
  providers: z.array(providerViewSchema),
});
export type PluginManagerSnapshot = z.infer<typeof pluginManagerSnapshotSchema>;
