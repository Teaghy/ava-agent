import type { Context } from 'cordis';
import { randomUUID } from 'node:crypto';
import type { ConversationSummary } from '../../core/session/session.types.js';
import type { SessionService } from '../../core/session/session.service.js';
import { AppError, checkAbort } from '../../core/errors.js';
export const sessionsPlugin = {
  name: 'sessions',
  provide: ['sessions'],
  inject: ['storage', 'cache', 'eventStore', 'summarizer'],
  apply(ctx: Context) {
    const service: SessionService = {
      async open(id, principal) {
        await ctx.storage.ensureConversation(id, principal);
        await ctx.cache.set(
          `session:${id}`,
          {
            tenantId: principal.tenantId,
            userId: principal.userId,
            applicationId: principal.applicationId,
            knowledgeSpaceId: principal.knowledgeSpaceId,
          },
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
      async summarize(conversationId, signal) {
        checkAbort(signal);
        const recent = await ctx.storage.messages(conversationId, 21);
        if (
          recent.length < 20 &&
          recent.reduce((n, m) => n + Buffer.byteLength(m.content), 0) < 24000
        )
          return;
        const previous = await ctx.storage.summary(conversationId);
        const summary = await ctx.summarizer.summarize({
          conversationId,
          messages: structuredClone(recent),
          previous: previous && structuredClone(previous),
          signal,
        });
        checkAbort(signal);
        if (typeof summary !== 'string' || !summary.trim() || summary.length > 6000)
          throw new AppError('INVALID_SUMMARY', '摘要插件返回了无效的摘要。', 502);
        // Generated background text must not become confirmed facts or executed actions.
        const data: ConversationSummary = {
          conversationId,
          problem: recent.find((m) => m.role === 'user')?.content.slice(0, 300),
          confirmedFacts: previous?.confirmedFacts ?? [],
          executedActions: previous?.executedActions ?? [],
          pendingItems: previous?.pendingItems ?? [],
          summary,
          updatedAt: new Date().toISOString(),
        };
        await ctx.storage.saveSummary(data);
      },
    };
    ctx.provide('sessions', service);
  },
};
