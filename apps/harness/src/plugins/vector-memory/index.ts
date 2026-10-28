import type { Context } from 'cordis';
import type { VectorService } from '../../core/vector/vector.service.js';
import type { VectorPoint } from '../../core/vector/vector.types.js';
import type { RetrievedDocument } from '../../core/rag/retrieval.types.js';
import type { Metadata } from '../../core/common.types.js';
export class InMemoryVector implements VectorService {
  readonly points = new Map<string, VectorPoint>();
  async upsert(points: VectorPoint[]): Promise<void> {
    for (const p of points) this.points.set(p.id, structuredClone(p));
  }
  async delete(ids: string[]): Promise<void> {
    ids.forEach((id) => this.points.delete(id));
  }
  async search(
    vector: number[],
    tenant: string,
    filters: Metadata,
    limit: number,
  ): Promise<RetrievedDocument[]> {
    return [...this.points.values()]
      .filter(
        (p) =>
          p.document.tenantId === tenant &&
          Object.entries(filters).every(([k, v]) => p.document.metadata[k] === v),
      )
      .map((p) => ({
        ...structuredClone(p.document),
        score: p.vector.reduce((sum, v, i) => sum + v * (vector[i] ?? 0), 0),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
export const vectorMemoryPlugin = {
  name: 'vector-memory',
  provide: ['vector'],
  apply(ctx: Context) {
    ctx.provide('vector', new InMemoryVector());
  },
};
