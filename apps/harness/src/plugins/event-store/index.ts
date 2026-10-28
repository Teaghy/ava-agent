import type { Context } from 'cordis';
import { randomUUID } from 'node:crypto';
import type { EventStoreService } from '../../core/event/event-store.service.js';
import { agentStateSchema } from '../../core/agent/agent-state.js';
export const eventStorePlugin = {
  name: 'event-store',
  provide: ['eventStore'],
  inject: ['storage'],
  apply(ctx: Context) {
    const service: EventStoreService = {
      async append(state, tenantId, type, payload) {
        const event = {
          id: randomUUID(),
          runId: state.runId,
          conversationId: state.conversationId,
          tenantId,
          type,
          payload: structuredClone(payload),
          createdAt: new Date().toISOString(),
        };
        await ctx.storage.appendEvent(event);
        ctx.emit('harness/event', event);
        return event;
      },
      replay: (id, tenant) => ctx.storage.events(id, tenant),
      async recover(id, tenant) {
        const events = await ctx.storage.events(id, tenant);
        const payload = events.findLast((e) => e.type === 'checkpoint')?.payload;
        return payload === undefined ? undefined : agentStateSchema.parse(payload);
      },
    };
    ctx.provide('eventStore', service);
  },
};
