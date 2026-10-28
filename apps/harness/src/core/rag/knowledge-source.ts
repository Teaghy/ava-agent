import type { KnowledgeDocument, RagRequest, RetrievedDocument } from './retrieval.types.js';

export interface KnowledgeSource {
  name: string;
  description: string;
  default?: boolean;
  search(request: RagRequest): Promise<RetrievedDocument[]>;
  ingest?(document: KnowledgeDocument, tenantId: string): Promise<number>;
}
export interface KnowledgeRegistryService {
  register(source: KnowledgeSource): () => void;
  get(name: string): KnowledgeSource | undefined;
  list(): Pick<KnowledgeSource, 'name' | 'description' | 'default'>[];
  search(request: RagRequest): Promise<RetrievedDocument[][]>;
}
