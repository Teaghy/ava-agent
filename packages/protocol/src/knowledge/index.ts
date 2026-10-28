import { z } from 'zod';
const metadata = z
  .object({
    product: z.string().max(200).optional(),
    model: z.string().max(200).optional(),
    category: z.string().max(200).optional(),
    errorCode: z.string().max(100).optional(),
    version: z.string().max(100).optional(),
    language: z.string().max(30).optional(),
    department: z.string().max(200).optional(),
  })
  .strict();
export const knowledgeDocumentSchema = z
  .object({
    id: z.string().min(1).max(100),
    title: z.string().min(1).max(300),
    content: z.string().trim().min(1).max(50000),
    source: z.string().url().optional(),
    metadata,
  })
  .strict();
export type KnowledgeDocumentInput = z.infer<typeof knowledgeDocumentSchema>;
