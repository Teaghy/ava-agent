import type { Context } from 'cordis';
import { KnowledgeRegistry } from './registry.js';
export const knowledgeRegistryPlugin = {
  name: 'knowledge-registry',
  provide: ['knowledge'],
  apply(ctx: Context) {
    ctx.provide('knowledge', new KnowledgeRegistry());
  },
};
