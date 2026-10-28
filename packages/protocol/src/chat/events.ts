import { z } from 'zod';
import { citationSchema } from '../citation/index.js';
const event = <T extends string, S extends z.ZodType>(type: T, data: S) =>
  z.object({ type: z.literal(type), data });
export const streamEventSchema = z.discriminatedUnion('type', [
  event('agent.started', z.object({ runId: z.string(), conversationId: z.string() })),
  event('agent.step', z.object({ step: z.number(), phase: z.string() })),
  event('tool.started', z.object({ tool: z.string() })),
  event('tool.completed', z.object({ tool: z.string(), status: z.enum(['completed', 'failed']) })),
  event('rag.started', z.object({ query: z.string() })),
  event('rag.completed', z.object({ count: z.number() })),
  event('answer.delta', z.object({ text: z.string() })),
  event(
    'answer.completed',
    z.object({
      runId: z.string(),
      answer: z.string(),
      citations: z.array(citationSchema),
      status: z.enum(['completed', 'ask_user']),
    }),
  ),
  event('error', z.object({ code: z.string(), message: z.string() })),
]);
export type ChatEvent = z.infer<typeof streamEventSchema>;

export type AgentResult = Extract<ChatEvent, { type: 'answer.completed' }>['data'];
export type StreamEventType = ChatEvent['type'];
