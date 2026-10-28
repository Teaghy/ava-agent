import { z } from 'zod';
export const MAX_MESSAGE_LENGTH = 2000;
export const conversationIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[\w-]+$/);
export const chatRequestSchema = z
  .object({
    conversationId: conversationIdSchema,
    message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  })
  .strict();
export const historyRequestSchema = z.object({ conversationId: conversationIdSchema }).strict();
export type ChatRequest = z.infer<typeof chatRequestSchema>;
