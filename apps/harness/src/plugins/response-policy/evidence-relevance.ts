import type { EmbeddingService } from '../../core/embedding/embedding.service.js';
import type { RetrievedDocument } from '../../core/rag/retrieval.types.js';
import { checkAbort } from '../../core/errors.js';

export interface EvidenceRelevance {
  supported: boolean;
  reason: 'supported' | 'missing-anchor' | 'low-similarity' | 'unavailable';
  similarities: number[];
}

/** Assess the original question against cited text, never against a model-rewritten search query. */
export async function assessEvidence(
  question: string,
  documents: RetrievedDocument[],
  embedding: EmbeddingService | undefined,
  minimumSimilarity: number,
  signal?: AbortSignal,
  requireAll = true,
): Promise<EvidenceRelevance> {
  checkAbort(signal);
  const normalize = (text: string) => text.normalize('NFKC').toLowerCase();
  const query = normalize(question);
  const text = normalize(
    documents.map((document) => `${document.title}\n${document.content}`).join('\n'),
  );
  // In mixed-language questions, identifiers such as Vue or CF-A200 must actually occur in evidence.
  // This prevents adding a known product name from laundering an unrelated technical question.
  const identifiers = /\p{Script=Han}/u.test(query)
    ? (query.match(/[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*/g) ?? []).filter((word) => word.length > 1)
    : [];
  const expressions = query.match(/\d+(?:\.\d+)?\s*[+*/=−-]\s*\d+(?:\.\d+)?/g) ?? [];
  const missingIdentifier = identifiers.some((identifier) => {
    const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return !new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
  });
  if (
    missingIdentifier ||
    expressions.some(
      (expression) => !text.replace(/\s+/g, '').includes(expression.replace(/\s+/g, '')),
    )
  )
    return { supported: false, reason: 'missing-anchor', similarities: [] };
  if (!embedding || !documents.length)
    return { supported: false, reason: 'unavailable', similarities: [] };
  const vectors = await embedding.embedMany(
    [question, ...documents.map((document) => `${document.title}\n${document.content}`)],
    signal,
  );
  checkAbort(signal);
  const [questionVector, ...evidenceVectors] = vectors;
  const similarities = evidenceVectors.map((vector) => cosine(questionVector ?? [], vector));
  const supported =
    similarities.length === documents.length &&
    (requireAll
      ? similarities.every((score) => Number.isFinite(score) && score >= minimumSimilarity)
      : similarities.some((score) => Number.isFinite(score) && score >= minimumSimilarity));
  return { supported, reason: supported ? 'supported' : 'low-similarity', similarities };
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return NaN;
  const norm = Math.hypot(...left) * Math.hypot(...right);
  if (!norm) return NaN;
  return left.reduce((sum, value, index) => sum + value * right[index]!, 0) / norm;
}
