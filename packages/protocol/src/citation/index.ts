import { z } from 'zod';
export const citationSchema = z
  .object({
    documentId: z.string(),
    chunkId: z.string(),
    title: z.string(),
    source: z.string().optional(),
  })
  .strict();
export type Citation = z.infer<typeof citationSchema>;
