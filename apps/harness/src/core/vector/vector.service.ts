import type { Metadata } from '../common.types.js';
import type { RetrievedDocument } from '../rag/retrieval.types.js';
import type { VectorPoint } from './vector.types.js';
export interface VectorService {
  search(
    vector: number[],
    tenantId: string,
    filter: Metadata,
    limit: number,
    signal?: AbortSignal,
  ): Promise<RetrievedDocument[]>;
  upsert(points: VectorPoint[]): Promise<void>;
  delete(ids: string[]): Promise<void>;
}
