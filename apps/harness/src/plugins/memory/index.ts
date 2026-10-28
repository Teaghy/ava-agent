import type { Context } from 'cordis';
import { randomUUID } from 'node:crypto';
import type { MemoryService } from '../../core/memory/memory.service.js';
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
        const rows = await ctx.storage.recall(options);
        const terms = query.toLowerCase().split(/\s+/);
        return rows
          .sort(
            (a, b) =>
              terms.filter((t) => b.content.toLowerCase().includes(t)).length -
              terms.filter((t) => a.content.toLowerCase().includes(t)).length,
          )
          .slice(0, options.limit ?? 5);
      },
      forget: (id, owner) => ctx.storage.forget(id, owner),
    };
    ctx.provide('memory', service);
  },
};
