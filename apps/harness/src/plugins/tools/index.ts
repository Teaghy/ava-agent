import type { Context } from 'cordis';
import { ToolRegistry } from './registry.js';
export { ToolRegistry } from './registry.js';
export { knowledgeToolPlugin } from './built-in/knowledge-search.tool.js';
export { mockBusinessToolsPlugin } from './built-in/business-tools.js';
export const toolsPlugin = {
  name: 'tools',
  provide: ['tools'],
  inject: ['storage', 'telemetry'],
  apply(ctx: Context) {
    ctx.provide('tools', new ToolRegistry((log) => ctx.storage.audit(log), ctx.telemetry));
  },
};
