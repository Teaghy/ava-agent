import type { Context } from 'cordis';
import { z } from 'zod';
import type { AnswerPolicy } from '../../core/guard/guard.service.js';
import { AppError, checkAbort } from '../../core/errors.js';

export const responsePolicyPlugin = {
  name: 'response-policy',
  provide: ['responsePolicy'],
  Config: z
    .object({
      evidence: z.enum(['knowledge-or-tool', 'knowledge', 'optional']).default('knowledge-or-tool'),
    })
    .strict(),
  apply(ctx: Context, config: { evidence: 'knowledge-or-tool' | 'knowledge' | 'optional' }) {
    const policy: AnswerPolicy = {
      name: `evidence-${config.evidence}`,
      allowStreaming: true,
      validate(_answer, citations, state, signal, responseType = 'final_answer') {
        checkAbort(signal);
        if (responseType === 'ask_user') return;
        if (state.retrievedDocuments.length && !citations.length)
          throw new AppError('CITATION_REQUIRED', '使用检索文档回答时必须提供引用。', 422);
        if (config.evidence === 'optional' || state.retrievedDocuments.length) return;
        const toolEvidence = state.observations.some(
          (observation) =>
            state.toolCalls.some(
              (call) =>
                call.tool === observation.tool &&
                call.status === 'completed' &&
                call.kind !== 'retrieval',
            ) && !('error' in Object(observation.result)),
        );
        if (config.evidence === 'knowledge-or-tool' && toolEvidence) return;
        throw new AppError('LOW_CONFIDENCE', '缺乏足够依据，请补充信息。', 422);
      },
    };
    ctx.provide('responsePolicy', policy);
  },
};
