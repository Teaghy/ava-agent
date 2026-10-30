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
    guard: { required: true },
  },
  apply(ctx: Context, c: AgentConfig) {
    const service = createAgentService(
      {
        decision: ctx.decision,
        knowledge: ctx.knowledge,
        tools: ctx.tools,
        sessions: ctx.sessions,
        eventStore: ctx.eventStore,
        cache: ctx.cache,
        telemetry: ctx.telemetry,
        guard: ctx.guard,
        getAnswer: () => ctx.get('answer'),
        memory: ctx.memory,
      },
      c,
    );
    ctx.effect(() => () => service.stop());
    ctx.provide('agent', service);
  },
};
