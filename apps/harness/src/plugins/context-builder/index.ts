import type { Context } from 'cordis';
import { defaultContextService } from '../../core/agent/context.service.js';

export const contextBuilderPlugin = {
  name: 'context-builder',
  provide: ['contextBuilder'],
  apply(ctx: Context) {
    ctx.provide('contextBuilder', defaultContextService);
  },
};
