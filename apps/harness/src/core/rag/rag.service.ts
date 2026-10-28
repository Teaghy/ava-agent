import type { KnowledgeDocument, RagRequest, RetrievedDocument } from './retrieval.types.js';
export interface RagService {
  search(input: RagRequest): Promise<RetrievedDocument[]>;
  ingest(document: KnowledgeDocument, tenantId: string): Promise<number>;
}
