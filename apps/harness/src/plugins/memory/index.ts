import type { Context } from 'cordis';
import { randomUUID } from 'node:crypto';
import type { MemoryService } from '../../core/memory/memory.service.js';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
export const memoryPlugin = {
  name: 'memory-storage',
  provide: ['memory'],
  inject: ['storage'],
  apply(ctx: Context) {
    const service: MemoryService = {
      async remember(input) {
        const item = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
        await ctx.storage.remember(item);
        return item;
      },
      async recall(query, options) {
        const terms = [
          ...new Set(
            [...segmenter.segment(query.toLowerCase())]
              .filter((part) => part.isWordLike && !/^\p{Script=Han}$/u.test(part.segment))
              .map((part) => part.segment),
          ),
        ];
        if (!terms.length) return [];
        const rows = await ctx.storage.recall(options);
        return rows
          .map((row) => {
            const content = row.content.toLowerCase();
            const score = terms.filter((term) => content.includes(term)).length;
            return { row, score };
          })
          .filter(({ score }) => score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, options.limit ?? 5)
          .map(({ row }) => row);
      },
      forget: (id, owner) => ctx.storage.forget(id, owner),
    };
    ctx.provide('memory', service);
  },
};
