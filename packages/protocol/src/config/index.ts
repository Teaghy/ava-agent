import { z } from 'zod';
export const configSchema = z.object({
  mode: z.enum(['mock', 'live']),
  authRequired: z.boolean(),
  memoryProvider: z.enum(['storage', 'mem0-oss-rest', 'custom']),
  persistence: z.enum(['memory', 'postgres', 'custom']),
  maxMessageLength: z.number().int().positive(),
});
export type ClientConfig = z.infer<typeof configSchema>;
