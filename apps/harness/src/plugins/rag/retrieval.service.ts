import type { Context } from 'cordis';
import type { RagService } from '../../core/rag/rag.service.js';
import { rankFusion } from '../../core/rag/rank-fusion.js';
import { AppError, checkAbort } from '../../core/errors.js';
import { rewriteQueries } from './query-rewriter.js';
import { selectContext } from './context-selector.js';

export function createRetrievalService(ctx: Context): RagService {
  return {
    async search(request) {
      return ctx.telemetry.span('rag.search', { tenant_id: request.tenantId }, async () => {
        checkAbort(request.signal);
        const rankings = [];
        for (const query of rewriteQueries(request))
          rankings.push(...(await ctx.knowledge.search({ ...request, query })));
        let documents = rankFusion(rankings).slice(0, 12);
        if (ctx.reranker)
          documents = await ctx.reranker.rerank(request.query, documents, request.signal);
        checkAbort(request.signal);
        return selectContext(documents);
      });
    },
    async ingest(document, tenantId) {
      const source = ctx.knowledge.get('qdrant');
      if (!source?.ingest)
        throw new AppError('INGESTION_UNAVAILABLE', '默认知识源不支持导入。', 503);
      return source.ingest(document, tenantId);
    },
  };
}
