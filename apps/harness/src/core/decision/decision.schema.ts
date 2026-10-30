import { z } from 'zod';
import { citationSchema } from '@ava/protocol';

export const decisionSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('tool_call'),
      tool: z.string().max(100),
      arguments: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('final_answer'),
      answer: z.string().min(1).max(16000),
      citations: z.array(citationSchema).max(10).optional(),
    })
    .strict(),
  z.object({ type: z.literal('ask_user'), question: z.string().min(1).max(2000) }).strict(),
  z
    .object({
      type: z.literal('answer_ready'),
      citations: z.array(citationSchema).max(10).optional(),
    })
    .strict(),
]);
export type AgentDecision = z.infer<typeof decisionSchema>;
