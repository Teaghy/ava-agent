import type { RetrievedDocument } from './retrieval.types.js';

export function rankFusion(rankings: RetrievedDocument[][]): RetrievedDocument[] {
  const fused = new Map<string, RetrievedDocument>();
  for (const rows of rankings)
    rows.forEach((document, rank) => {
      const previous = fused.get(document.id);
      fused.set(document.id, { ...document, score: (previous?.score ?? 0) + 1 / (60 + rank + 1) });
    });
  return [...fused.values()].sort((a, b) => b.score - a.score);
}
