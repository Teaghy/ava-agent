import type { RetrievedDocument } from '../../core/rag/retrieval.types.js';
export function selectContext(documents: RetrievedDocument[]): RetrievedDocument[] {
  return documents.slice(0, 5);
}
