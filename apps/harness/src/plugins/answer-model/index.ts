import type { Context } from 'cordis';
import { ContextBuilder } from '../../core/agent/context-builder.js';
import { AppError } from '../../core/errors.js';
export const answerModelPlugin = {
  name: 'answer-model',
  provide: ['answer'],
  apply(ctx: Context, config: { systemPrompt: string; contextTokens: number }) {
    const builder = new ContextBuilder(config.systemPrompt, config.contextTokens);
    ctx.provide('answer', {
      async *stream(request) {
        const model = ctx.get('model');
        if (!model) throw new AppError('MODEL_UNAVAILABLE', '当前未配置回答生成模型。', 503);
        const messages = builder.build({ ...request, tools: [] });
        yield* model.stream({
          messages,
          signal: request.signal,
          runId: request.runId,
          conversationId: request.conversationId,
        });
      },
    });
  },
};
