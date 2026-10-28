import type { KnowledgeSource } from '../../core/rag/knowledge-source.js';
import type { RagRequest } from '../../core/rag/retrieval.types.js';
export class CaseKnowledgeSource implements KnowledgeSource {
  readonly name = 'cases';
  readonly description = '历史客服案例';
  readonly default = false;
  constructor(private source: KnowledgeSource) {}
  search(request: RagRequest) {
    return this.source.search({ ...request, filters: { ...request.filters, category: 'case' } });
  }
}
