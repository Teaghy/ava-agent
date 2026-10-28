import type { Context } from 'cordis';
import type { AnswerPolicy, GuardService } from '../../core/guard/guard.service.js';
import { AppError, checkAbort } from '../../core/errors.js';
export const guardPlugin = {
  name: 'answer-guard',
  provide: ['guard'],
  apply(ctx: Context) {
    const policies = new Map<string, AnswerPolicy>();
    const guard: GuardService = {
      register(policy) {
        if (policies.has(policy.name))
          throw new AppError('DUPLICATE_POLICY', `校验策略 ${policy.name} 已注册。`);
        policies.set(policy.name, policy);
        return () => {
          if (policies.get(policy.name) === policy) policies.delete(policy.name);
        };
      },
      async validate(answer, citations, state, signal, responseType = 'final_answer') {
        checkAbort(signal);
        for (const citation of citations) {
          const doc = state.retrievedDocuments.find(
            (d) => d.id === citation.chunkId && d.documentId === citation.documentId,
          );
          if (!doc || doc.title !== citation.title || doc.source !== citation.source)
            throw new AppError('INVALID_CITATION', '答案引用无法验证。', 422);
        }
        if (responseType === 'final_answer' && state.retrievedDocuments.length && !citations.length)
          throw new AppError('CITATION_REQUIRED', '知识库答案必须提供引用。', 422);
        if (
          responseType === 'final_answer' &&
          !state.retrievedDocuments.length &&
          !state.observations.some(
            (o) =>
              state.toolCalls.some(
                (call) =>
                  call.tool === o.tool && call.status === 'completed' && call.kind !== 'retrieval',
              ) && !('error' in Object(o.result)),
          )
        )
          throw new AppError('LOW_CONFIDENCE', '缺乏足够依据，请补充信息或转人工。', 422);
        const selectedPolicies = [...policies.values()];
        for (const policy of selectedPolicies) {
          checkAbort(signal);
          const snapshot = structuredClone({ citations, state });
          await policy.validate(answer, snapshot.citations, snapshot.state, signal, responseType);
        }
        checkAbort(signal);
      },
    };
    ctx.provide('guard', guard);
  },
};
