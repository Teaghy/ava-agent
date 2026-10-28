import type { RagRequest } from '../../core/rag/retrieval.types.js';
export function rewriteQueries(request: RagRequest): string[] {
  return [
    ...new Set([
      request.query.trim(),
      `${request.hints?.join(' ') ?? ''} ${request.query}`.trim(),
      ...(request.query.match(/E\d{3,}/gi) ?? []).map(
        (code) => `${request.hints?.join(' ') ?? ''} ${code} troubleshooting`,
      ),
    ]),
  ].slice(0, 3);
}
