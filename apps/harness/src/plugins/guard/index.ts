import type { Context } from 'cordis';
import type { AnswerPolicy, GuardService } from '../../core/guard/guard.service.js';
import { AppError, checkAbort } from '../../core/errors.js';
export const guardPlugin = {
  name: 'answer-guard',
  provide: ['guard'],
  inject: ['responsePolicy'],
  apply(ctx: Context) {
    const policies = new Map<string, AnswerPolicy>();
    const guard: GuardService = {
      canStream: () => policies.size === 0 && ctx.responsePolicy.allowStreaming === true,
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
        const response = structuredClone({ citations, state });
        await ctx.responsePolicy.validate(
          answer,
          response.citations,
          response.state,
          signal,
          responseType,
        );
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
