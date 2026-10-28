import { z } from 'zod';
import { citationSchema } from '../citation/index.js';
export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;
export const messageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
  citations: z.array(citationSchema).optional(),
  runId: z.string().nullish(),
});
export type Message = z.infer<typeof messageSchema>;
