import type { Context } from 'cordis';
import { QdrantKnowledgeSource } from './qdrant-knowledge-source.js';
export const knowledgeQdrantPlugin = {
  name: 'knowledge-qdrant',
  provide: ['qdrantKnowledge'],
  inject: ['knowledge', 'vector', 'embedding', 'storage', 'cache'],
  apply(ctx: Context) {
    const source = new QdrantKnowledgeSource(ctx);
    ctx.provide('qdrantKnowledge', source);
    ctx.effect(() => ctx.knowledge.register(source));
  },
};
