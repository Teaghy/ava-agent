import type { Context } from 'cordis';
import { Mem0Memory } from './rest.provider.js';
export { Mem0Memory } from './rest.provider.js';
export const memoryMem0Plugin = {
  name: 'memory-mem0',
  provide: ['memory'],
  apply(ctx: Context, config: { url: string; apiKey: string }) {
    ctx.provide('memory', new Mem0Memory(config));
  },
};
