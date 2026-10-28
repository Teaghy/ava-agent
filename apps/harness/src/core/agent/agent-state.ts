export type { AgentState, AgentObservation, ToolCallRecord } from './agent.types.js';
import { z } from 'zod';
export const agentStateSchema = z
  .object({
    runId: z.string().uuid(),
    conversationId: z.string(),
    userId: z.string().optional(),
    goal: z.string().optional(),
    intent: z.string().optional(),
    entities: z.record(z.string(), z.unknown()),
    observations: z.array(z.object({ tool: z.string(), result: z.unknown() })),
    toolCalls: z.array(
      z.object({
        tool: z.string(),
        kind: z.literal('retrieval').optional(),
        arguments: z.record(z.string(), z.unknown()),
        status: z.enum(['completed', 'failed']),
      }),
    ),
    retrievedDocuments: z.array(
      z.object({
        id: z.string(),
        documentId: z.string(),
        tenantId: z.string(),
        title: z.string(),
        content: z.string(),
        source: z.string().optional(),
        metadata: z.record(z.string(), z.string()),
        score: z.number(),
      }),
    ),
    step: z.number().int().nonnegative(),
    status: z.enum(['running', 'waiting_tool', 'completed', 'failed']),
  })
  .strict();
