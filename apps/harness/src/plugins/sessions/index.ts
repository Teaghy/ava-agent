import type { Context } from 'cordis';
import { randomUUID } from 'node:crypto';
import type { ConversationSummary } from '../../core/session/session.types.js';
import type { SessionService } from '../../core/session/session.service.js';
export const sessionsPlugin = {
  name: 'sessions',
  provide: ['sessions'],
  inject: ['storage', 'cache', 'eventStore'],
  apply(ctx: Context) {
    const service: SessionService = {
      async open(id, principal) {
        await ctx.storage.ensureConversation(id, principal);
        await ctx.cache.set(
          `session:${id}`,
          { tenantId: principal.tenantId, userId: principal.userId },
          3600,
        );
      },
      recent: (id) => ctx.storage.messages(id, 20),
      summary: (id) => ctx.storage.summary(id),
      async add(conversationId, role, content, details) {
        await ctx.storage.addMessage({
          id: randomUUID(),
          conversationId,
          role,
          content,
          ...details,
          createdAt: new Date().toISOString(),
        });
      },
      async checkpoint(state, tenantId) {
        await ctx.storage.saveRun(state, tenantId);
        await ctx.eventStore.append(state, tenantId, 'checkpoint', state);
        await ctx.cache.set(`run:${state.runId}`, state, 3600);
      },
      async summarize(conversationId) {
        const recent = await ctx.storage.messages(conversationId, 21);
        if (
          recent.length < 20 &&
          recent.reduce((n, m) => n + Buffer.byteLength(m.content), 0) < 24000
        )
          return;
        const previous = await ctx.storage.summary(conversationId);
        // Bounded extractive rolling summary; no inferred facts become confirmed facts.
        const data: ConversationSummary = {
          conversationId,
          problem: recent.find((m) => m.role === 'user')?.content.slice(0, 300),
          confirmedFacts: previous?.confirmedFacts ?? [],
          executedActions: previous?.executedActions ?? [],
          pendingItems: previous?.pendingItems ?? [],
          summary: `${previous?.summary.slice(-1500) ?? ''}\n${recent
            .slice(0, -8)
            .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
            .join('\n')}`.slice(-6000),
          updatedAt: new Date().toISOString(),
        };
        await ctx.storage.saveSummary(data);
      },
    };
    ctx.provide('sessions', service);
  },
};
