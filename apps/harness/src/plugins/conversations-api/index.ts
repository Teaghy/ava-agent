import type { Context } from 'cordis';
import { historyRequestSchema } from '@ava/protocol';
import { authenticate, type AuthConfig } from '../../core/http/auth.js';
import { AppError } from '../../core/errors.js';
import { randomUUID } from 'node:crypto';
export const conversationsApiPlugin = {
  name: 'conversations-api',
  inject: ['http', 'storage', 'cache'],
  apply(ctx: Context, config: AuthConfig) {
    ctx.effect(() =>
      ctx.http.post('/api/v1/conversations/delete', async (request) => {
        const principal = authenticate(request, config);
        const parsed = historyRequestSchema.safeParse(await request.body());
        if (!parsed.success)
          throw new AppError('INVALID_REQUEST', '需要有效的 conversationId。', 400);
        const id = parsed.data.conversationId;
        await ctx.storage.assertConversation(id, principal);
        const lockKey = `conversation-lock:${id}`,
          token = randomUUID();
        if (!(await ctx.cache.acquire(lockKey, token, 120)))
          throw new AppError('CONVERSATION_BUSY', '会话正在回复，请先停止生成后再删除。', 409);
        try {
          await ctx.storage.deleteConversation(id, principal);
          return { body: { deleted: true } };
        } finally {
          await ctx.cache.release(lockKey, token);
        }
      }),
    );
    ctx.effect(() =>
      ctx.http.get('/api/v1/conversations', async (request) => {
        const principal = authenticate(request, config);
        return { body: { conversations: await ctx.storage.listConversations(principal, 100) } };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/conversations/history', async (request) => {
        const principal = authenticate(request, config);
        const parsed = historyRequestSchema.safeParse(await request.body());
        if (!parsed.success)
          throw new AppError('INVALID_REQUEST', '需要有效的 conversationId。', 400);
        await ctx.storage.assertConversation(parsed.data.conversationId, principal);
        return {
          body: {
            messages: await ctx.storage.messages(parsed.data.conversationId, 100),
            limit: 100,
          },
        };
      }),
    );
  },
};
