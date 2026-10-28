/** Public plugin contracts. No bootstrap or concrete provider is loaded here. */
export type { Context, Plugin } from './bootstrap/context.js';
export type * from './core/index.js';
export type {
  HarnessOptions,
  HarnessProviders,
  HarnessPlugin,
  ProviderSlot,
} from './bootstrap/extensions.js';
export { decisionSchema, type AgentDecision } from './core/decision/decision.schema.js';
export { ContextBuilder } from './core/agent/context-builder.js';
export { AppError, checkAbort } from './core/errors.js';
