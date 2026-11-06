import { z } from 'zod';
import type { ContextInput } from './context-builder.js';
import { ContextBuilder } from './context-builder.js';
import type { ModelMessage } from '../model/model.types.js';
import type { ModelRole } from '../model/model-router.service.js';
import { AppError, checkAbort } from '../errors.js';

export interface ContextBuildRequest extends ContextInput {
  purpose: ModelRole;
  systemPrompt: string;
  tokenBudget: number;
  signal?: AbortSignal;
  runId?: string;
  conversationId?: string;
}

export interface ContextService {
  build(request: ContextBuildRequest): ModelMessage[] | Promise<ModelMessage[]>;
}

export const defaultContextService: ContextService = {
  build: (request) => new ContextBuilder(request.systemPrompt, request.tokenBudget).build(request),
};

const messagesSchema = z
  .array(
    z
      .object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
      })
      .strict(),
  )
  .min(1);

/** Keep plugin mutations out of runtime state and enforce budgets for every adapter. */
export async function buildModelContext(
  service: ContextService,
  request: ContextBuildRequest,
): Promise<ModelMessage[]> {
  checkAbort(request.signal);
  const { signal, ...input } = request;
  const result = await service.build({ ...structuredClone(input), signal });
  checkAbort(signal);
  const parsed = messagesSchema.safeParse(result);
  if (!parsed.success) throw new AppError('INVALID_CONTEXT', '上下文插件返回了无效的消息。', 502);
  const overhead = Math.max(256, parsed.data.length * 32);
  if (
    parsed.data.reduce((size, message) => size + Buffer.byteLength(message.content), overhead) >
    request.tokenBudget
  )
    throw new AppError('CONTEXT_BUDGET', '上下文插件返回的消息超过预算。', 400);
  return parsed.data;
}
