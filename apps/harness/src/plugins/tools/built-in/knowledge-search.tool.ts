import type { Context } from 'cordis';
import { z } from 'zod';

export const knowledgeToolPlugin = {
  name: 'knowledge-tools',
  inject: ['tools', 'rag'],
  apply(ctx: Context) {
    for (const name of ['knowledge_search', 'case_search']) {
      ctx.effect(() =>
        ctx.tools.register({
          name,
          description:
            name === 'case_search'
              ? '检索历史客服案例。'
              : '检索设备知识库；涉及设备故障的答案必须先检索并引用来源。',
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
              filters: {
                ...input.filters,
                ...(name === 'case_search' ? { category: 'case' } : {}),
              },
              hints: Object.values(context.state.entities).filter(
                (v): v is string => typeof v === 'string',
              ),
              signal: context.signal,
            });
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
