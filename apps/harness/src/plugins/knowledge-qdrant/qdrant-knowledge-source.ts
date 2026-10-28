import type { Context } from 'cordis';
import type { KnowledgeSource } from '../../core/rag/knowledge-source.js';
import type {
  KnowledgeDocument,
  RagRequest,
  RetrievedDocument,
} from '../../core/rag/retrieval.types.js';
import { rankFusion } from '../../core/rag/rank-fusion.js';
import { chunkDocument } from '../../core/rag/chunker.js';
import { AppError, checkAbort } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';
export class QdrantKnowledgeSource implements KnowledgeSource {
  readonly name = 'qdrant';
  readonly description = '已发布的设备知识库，向量与关键词混合检索';
  constructor(private ctx: Pick<Context, 'embedding' | 'vector' | 'storage' | 'cache'>) {}
  async search(request: RagRequest): Promise<RetrievedDocument[]> {
    checkAbort(request.signal);
    const embedding = await this.ctx.embedding.embed(request.query, request.signal);
    const rankings = [
      await this.ctx.vector.search(
        embedding,
        request.tenantId,
        request.filters ?? {},
        12,
        request.signal,
      ),
      await this.ctx.storage.keywordSearch(
        request.query,
        request.tenantId,
        request.filters ?? {},
        12,
      ),
    ];
    const documents = rankFusion(rankings);
    // SQL publication is authoritative after interrupted vector writes.
    const published = new Map<string, RetrievedDocument[]>();
    for (const document of documents)
      if (!published.has(document.documentId))
        published.set(
          document.documentId,
          await this.ctx.storage.knowledgeChunks(document.documentId, request.tenantId),
        );
    checkAbort(request.signal);
    return documents.filter((document) =>
      published.get(document.documentId)?.some((chunk) => chunk.id === document.id),
    );
  }
  async ingest(document: KnowledgeDocument, tenantId: string): Promise<number> {
    const lockKey = `ingest:${JSON.stringify([tenantId, document.id])}`;
    const token = randomUUID();
    if (!(await this.ctx.cache.acquire(lockKey, token, 120)))
      throw new AppError('INGEST_BUSY', '文档正在导入。', 409);
    try {
      const chunks = chunkDocument(document, tenantId);
      if (!chunks.length || chunks.length > 200)
        throw new AppError('INVALID_DOCUMENT', '文档为空或分片数超过 200。', 400);
      const vectors = await this.ctx.embedding.embedMany(
        chunks.map((c) => `${document.title}\n${c.content}`),
      );
      if (vectors.length !== chunks.length) throw new Error('Embedding count mismatch');
      // Versioned document IDs are immutable; updating a document uses a new ID.
      const existing = await this.ctx.storage.knowledgeChunks(document.id, tenantId);
      if (
        existing.length &&
        (existing.length !== chunks.length ||
          existing.some((d) => !chunks.some((c) => c.id === d.id)))
      )
        throw new AppError('DOCUMENT_IMMUTABLE', '请使用新的文档版本 ID。', 409);
      await this.ctx.vector.upsert(
        chunks.map((d, i) => ({ id: d.id, vector: vectors[i]!, document: d })),
      );
      await this.ctx.storage.saveKnowledge(document, tenantId, chunks);
      return chunks.length;
    } finally {
      await this.ctx.cache.release(lockKey, token);
    }
  }
}
