import type { Context } from 'cordis';
import type { RerankerService } from '../../core/reranker/reranker.service.js';
import type { RetrievedDocument } from '../../core/rag/retrieval.types.js';
export class NoopReranker implements RerankerService {
  async rerank(_query: string, documents: RetrievedDocument[]): Promise<RetrievedDocument[]> {
    return documents;
  }
}
export const rerankerPlugin = {
  name: 'reranker-noop',
  provide: ['reranker'],
  apply(ctx: Context) {
    ctx.provide('reranker', new NoopReranker());
  },
};
