import type { Context } from 'cordis';
import { z } from 'zod';
import { sameKnowledgeSpace } from '../../../core/rag/knowledge-scope.js';
import { AppError } from '../../../core/errors.js';

export const knowledgeToolPlugin = {
  name: 'knowledge-tools',
  inject: ['tools', 'rag'],
  apply(ctx: Context) {
    for (const name of ['knowledge_search', 'case_search']) {
      ctx.effect(() =>
        ctx.tools.register({
          name,
          kind: 'retrieval',
          description:
            name === 'case_search'
              ? '检索历史客服案例。'
              : '检索客服知识库；基于知识的答案必须先检索并引用来源。',
          permission: 'READ',
          inputSchema: z
            .object({
              query: z.string().min(1).max(2000),
              sources: z.array(z.string().min(1).max(100)).max(10).optional(),
              filters: z.record(z.string().max(40), z.string().max(200)).optional(),
            })
            .strict(),
          async execute(input, context) {
            await context.emit({ type: 'rag.started', data: { query: input.query } });
            const documents = await ctx.rag.search({
              query: input.query,
              sources: name === 'case_search' ? ['cases'] : input.sources,
              tenantId: context.principal.tenantId,
              knowledgeSpaceId: context.principal.knowledgeSpaceId,
              filters: {
                ...input.filters,
                ...(name === 'case_search' ? { category: 'case' } : {}),
              },
              hints: Object.values(context.state.entities).filter(
                (v): v is string => typeof v === 'string',
              ),
              signal: context.signal,
            });
            if (
              documents.some(
                (document) =>
                  document.tenantId !== context.principal.tenantId ||
                  !sameKnowledgeSpace(document, context.principal.knowledgeSpaceId),
              )
            )
              throw new AppError('KNOWLEDGE_SCOPE', '检索结果超出应用允许的知识范围。');
            context.state.retrievedDocuments = [
              ...new Map(
                [...context.state.retrievedDocuments, ...documents].map((d) => [d.id, d]),
              ).values(),
            ].slice(-15);
            await context.emit({ type: 'rag.completed', data: { count: documents.length } });
            return { documents };
          },
        }),
      );
    }
  },
};
