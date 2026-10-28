import type { RetrievedDocument } from '../rag/retrieval.types.js';
export interface RerankerService {
  rerank(
    query: string,
    documents: RetrievedDocument[],
    signal?: AbortSignal,
  ): Promise<RetrievedDocument[]>;
}
