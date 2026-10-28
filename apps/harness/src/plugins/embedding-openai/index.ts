import type { Context } from 'cordis';
import { OpenAIEmbedding } from './openai-embedding.service.js';
import { MockEmbedding } from './mock-embedding.service.js';
export { OpenAIEmbedding } from './openai-embedding.service.js';
export { MockEmbedding } from './mock-embedding.service.js';
export const embeddingPlugin = {
  name: 'embedding',
  provide: ['embedding'],
  apply(
    ctx: Context,
    config: { mock: boolean; baseURL: string; apiKey: string; model: string; dimensions: number },
  ) {
    ctx.provide('embedding', config.mock ? new MockEmbedding() : new OpenAIEmbedding(config));
  },
};
