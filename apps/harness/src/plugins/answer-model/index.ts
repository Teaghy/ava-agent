import type { Context } from 'cordis';
import { buildModelContext } from '../../core/agent/context.service.js';
export const answerModelPlugin = {
  name: 'answer-model',
  provide: ['answer'],
  inject: ['modelRouter', 'contextBuilder'],
  apply(
    ctx: Context,
    config: { systemPrompt: string; contextTokens: number; streaming?: boolean },
  ) {
    ctx.provide('answer', {
      async *stream(request) {
        const model = ctx.modelRouter.get('answer');
        const messages = await buildModelContext(ctx.contextBuilder, {
          ...request,
          purpose: 'answer',
          systemPrompt: config.systemPrompt,
          tokenBudget: config.contextTokens,
          tools: [],
        });
        const modelRequest = {
          messages,
          purpose: 'answer' as const,
          signal: request.signal,
          runId: request.runId,
          conversationId: request.conversationId,
        };
        if (config.streaming === false) {
          yield { text: (await model.chat(modelRequest)).text };
        } else {
          yield* model.stream(modelRequest);
        }
      },
    });
  },
};
