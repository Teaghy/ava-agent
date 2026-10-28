import type { Context } from 'cordis';
import { CaseKnowledgeSource } from './case-knowledge-source.js';
export const knowledgeCasesPlugin = {
  name: 'knowledge-cases',
  inject: ['knowledge', 'qdrantKnowledge'],
  apply(ctx: Context) {
    ctx.effect(() => ctx.knowledge.register(new CaseKnowledgeSource(ctx.qdrantKnowledge)));
  },
};
