import type { Metadata } from '../common.types.js';
export interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  source?: string;
  metadata: Metadata;
}

export interface RetrievedDocument extends KnowledgeDocument {
  documentId: string;
  tenantId: string;
  score: number;
}

export interface RagRequest {
  sources?: string[];
  query: string;
  tenantId: string;
  filters?: Metadata;
  hints?: string[];
  signal?: AbortSignal;
}
