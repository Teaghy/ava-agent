import type { Context } from 'cordis';
import { createAgentService, type AgentConfig } from './react-loop.js';
export type { AgentConfig } from './react-loop.js';
export const agentLoopPlugin = {
  name: 'agent-loop',
  provide: ['agent'],
  inject: {
    decision: { required: true },
    knowledge: { required: true },
    tools: { required: true },
    sessions: { required: true },
    eventStore: { required: true },
    cache: { required: true },
    telemetry: { required: true },
    memory: { required: false },
    guard: { required: false },
  },
  apply(ctx: Context, c: AgentConfig) {
    ctx.provide('agent', createAgentService(ctx, c));
  },
};
