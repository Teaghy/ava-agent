import type { RetrievedDocument } from '../rag/retrieval.types.js';
export interface VectorPoint {
  id: string;
  vector: number[];
  document: RetrievedDocument;
}
