import type { KnowledgeRegistryService, KnowledgeSource } from '../../core/rag/knowledge-source.js';
import type { RagRequest, RetrievedDocument } from '../../core/rag/retrieval.types.js';
import { AppError, checkAbort } from '../../core/errors.js';

export class KnowledgeRegistry implements KnowledgeRegistryService {
  private sources = new Map<string, KnowledgeSource>();
  register(source: KnowledgeSource): () => void {
    if (this.sources.has(source.name))
      throw new AppError('DUPLICATE_KNOWLEDGE_SOURCE', '知识源名称已注册。');
    this.sources.set(source.name, source);
    return () => {
      if (this.sources.get(source.name) === source) this.sources.delete(source.name);
    };
  }
  get(name: string) {
    return this.sources.get(name);
  }
  list() {
    return [...this.sources.values()].map(({ name, description, default: isDefault }) => ({
      name,
      description,
      default: isDefault,
    }));
  }
  async search(request: RagRequest): Promise<RetrievedDocument[][]> {
    const names =
      request.sources ??
      this.list()
        .filter((source) => source.default !== false)
        .map((source) => source.name);
    const rankings: RetrievedDocument[][] = [];
    for (const name of new Set(names)) {
      checkAbort(request.signal);
      const source = this.sources.get(name);
      if (!source) throw new AppError('UNKNOWN_KNOWLEDGE_SOURCE', '知识源未注册。', 400);
      const documents = await source.search(request);
      if (documents.some((document) => document.tenantId !== request.tenantId))
        throw new AppError('KNOWLEDGE_SCOPE', '知识源返回了不匹配的租户数据。');
      rankings.push(
        documents.filter((document) =>
          Object.entries(request.filters ?? {}).every(
            ([key, value]) => document.metadata[key] === value,
          ),
        ),
      );
    }
    checkAbort(request.signal);
    return rankings;
  }
}
