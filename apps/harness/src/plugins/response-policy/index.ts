import type { Context } from 'cordis';
import { z } from 'zod';
import type { AnswerPolicy } from '../../core/guard/guard.service.js';
import { AppError, checkAbort } from '../../core/errors.js';
import { createHash } from 'node:crypto';
import { assessEvidence, type EvidenceRelevance } from './evidence-relevance.js';

export const responsePolicyPlugin = {
  name: 'response-policy',
  provide: ['responsePolicy'],
  inject: { embedding: { required: false }, telemetry: { required: false } },
  Config: z
    .object({
      evidence: z.enum(['knowledge-or-tool', 'knowledge', 'optional']).default('knowledge-or-tool'),
      minimumSimilarity: z.number().min(0).max(1).default(0.5),
    })
    .strict(),
  apply(
    ctx: Context,
    config: {
      evidence: 'knowledge-or-tool' | 'knowledge' | 'optional';
      minimumSimilarity?: number;
    },
  ) {
    const relevance = new Map<string, Promise<EvidenceRelevance>>();
    const policy: AnswerPolicy = {
      name: `evidence-${config.evidence}`,
      allowStreaming: true,
      async validate(_answer, citations, state, signal, responseType = 'final_answer') {
        checkAbort(signal);
        // Only the runtime can mark its fixed refusal as a scope reply; model questions are checked too.
        if (responseType === 'scope_reply') return;
        if (responseType !== 'ask_user' && state.retrievedDocuments.length && !citations.length)
          throw new AppError('CITATION_REQUIRED', '使用检索文档回答时必须提供引用。', 422);
        const toolEvidence = state.observations.some(
          (observation) =>
            state.toolCalls.some(
              (call) =>
                call.tool === observation.tool &&
                call.status === 'completed' &&
                call.kind === undefined,
            ) && !('error' in Object(observation.result)),
        );
        if (
          config.evidence !== 'optional' &&
          !(config.evidence === 'knowledge-or-tool' && toolEvidence) &&
          state.goal?.trim()
        ) {
          const documents = citations.length
            ? state.retrievedDocuments.filter((document) =>
                citations.some(
                  (citation) =>
                    citation.documentId === document.documentId && citation.chunkId === document.id,
                ),
              )
            : responseType === 'ask_user'
              ? state.retrievedDocuments
              : [];
          if (!documents.length)
            throw new AppError('LOW_CONFIDENCE', '当前知识库没有足够相关的依据支持这个问题。', 422);
          const key = `${state.runId}:${createHash('sha256')
            .update(
              JSON.stringify([
                state.goal,
                responseType,
                documents.map(({ id, documentId, title, content }) => ({
                  id,
                  documentId,
                  title,
                  content,
                })),
              ]),
            )
            .digest('hex')}`;
          let pending = relevance.get(key);
          if (!pending) {
            if (relevance.size >= 128) relevance.delete(relevance.keys().next().value!);
            pending = assessEvidence(
              state.goal,
              documents,
              ctx.get('embedding'),
              config.minimumSimilarity ?? 0.5,
              signal,
              responseType !== 'ask_user',
            );
            relevance.set(key, pending);
            void pending.catch(() => {
              if (relevance.get(key) === pending) relevance.delete(key);
            });
          }
          const assessment = await pending;
          checkAbort(signal);
          if (!assessment.supported) {
            ctx.get('telemetry')?.log(
              {
                event: 'response.scope.rejected',
                run_id: state.runId,
                reason: assessment.reason,
                similarities: assessment.similarities,
                minimum_similarity: config.minimumSimilarity ?? 0.5,
              },
              'question lacks relevant knowledge evidence',
            );
            throw new AppError('LOW_CONFIDENCE', '当前知识库没有足够相关的依据支持这个问题。', 422);
          }
        }
        if (responseType === 'ask_user') return;
        if (config.evidence === 'optional' || state.retrievedDocuments.length) return;
        if (config.evidence === 'knowledge-or-tool' && toolEvidence) return;
        throw new AppError('LOW_CONFIDENCE', '缺乏足够依据，请补充信息。', 422);
      },
    };
    ctx.provide('responsePolicy', policy);
  },
};
