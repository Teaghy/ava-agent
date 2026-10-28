import { z } from 'zod';
import { knowledgeDocumentSchema, type KnowledgeDocumentInput } from '@ava/protocol';
import type { Request } from './client.js';

export function createKnowledgeClient(request: Request) {
  return {
    async ingest(document: KnowledgeDocumentInput, signal?: AbortSignal) {
      return z.object({ chunks: z.number().int().nonnegative() }).parse(
        await (
          await request('/api/v1/knowledge', {
            method: 'POST',
            body: JSON.stringify(knowledgeDocumentSchema.parse(document)),
            signal,
          })
        ).json(),
      );
    },
  };
}
