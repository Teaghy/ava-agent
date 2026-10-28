import type { Context } from 'cordis';
import type { GuardService } from '../../core/guard/guard.service.js';
import { AppError } from '../../core/errors.js';
export const guardPlugin = {
  name: 'answer-guard',
  provide: ['guard'],
  apply(ctx: Context) {
    const guard: GuardService = {
      validate(answer, citations, state) {
        for (const citation of citations) {
          const doc = state.retrievedDocuments.find(
            (d) => d.id === citation.chunkId && d.documentId === citation.documentId,
          );
          if (!doc || doc.title !== citation.title || doc.source !== citation.source)
            throw new AppError('INVALID_CITATION', '答案引用无法验证。', 422);
        }
        if (state.retrievedDocuments.length && !citations.length)
          throw new AppError('CITATION_REQUIRED', '知识库答案必须提供引用。', 422);
        if (
          !state.retrievedDocuments.length &&
          !state.observations.some(
            (o) =>
              !['knowledge_search', 'case_search'].includes(o.tool) &&
              !('error' in Object(o.result)),
          )
        )
          throw new AppError('LOW_CONFIDENCE', '缺乏足够依据，请补充信息或转人工。', 422);
        if (
          /工单.{0,6}(已创建|创建成功)/.test(answer) &&
          !state.toolCalls.some((t) => t.tool === 'create_ticket' && t.status === 'completed')
        )
          throw new AppError('TOOL_INCONSISTENT', '未执行创建工单，不能宣称已创建。', 422);
      },
    };
    ctx.provide('guard', guard);
  },
};
