import { QdrantClient } from '@qdrant/js-client-rest';
import { z } from 'zod';
import type { Metadata } from '../../core/common.types.js';
import type { RetrievedDocument } from '../../core/rag/retrieval.types.js';
import type { VectorPoint } from '../../core/vector/vector.types.js';
import type { VectorService } from '../../core/vector/vector.service.js';
const payloadSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  tenantId: z.string(),
  title: z.string(),
  content: z.string(),
  source: z.string().optional(),
  metadata: z.record(z.string(), z.string()),
  score: z.number(),
});
export class QdrantVector implements VectorService {
  constructor(
    private client: QdrantClient,
    private collection: string,
  ) {}
  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length)
      await this.client.upsert(this.collection, {
        wait: true,
        points: points.map((p) => ({ id: p.id, vector: p.vector, payload: { ...p.document } })),
      });
  }
  async delete(ids: string[]): Promise<void> {
    if (ids.length) await this.client.delete(this.collection, { wait: true, points: ids });
  }
  async search(
    vector: number[],
    tenant: string,
    filters: Metadata,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RetrievedDocument[]> {
    signal?.throwIfAborted();
    const result = await this.client.query(this.collection, {
      query: vector,
      limit,
      with_payload: true,
      filter: {
        must: [
          { key: 'tenantId', match: { value: tenant } },
          ...Object.entries(filters).map(([key, value]) => ({
            key: `metadata.${key}`,
            match: { value },
          })),
        ],
      },
    });
    signal?.throwIfAborted();
    return result.points.map((row) => ({ ...payloadSchema.parse(row.payload), score: row.score }));
  }
}
