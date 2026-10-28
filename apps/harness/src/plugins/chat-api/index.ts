import type { Context } from 'cordis';
import { chatRequestSchema } from '@ava/protocol';
import { authenticate, type AuthConfig } from '../../core/http/auth.js';
import { AppError } from '../../core/errors.js';
export const chatApiPlugin = {
  name: 'chat-api',
  inject: ['http', 'agent', 'sessions', 'cache'],
  apply(ctx: Context, config: AuthConfig) {
    ctx.effect(() =>
      ctx.http.post('/api/v1/chat', async (request) => {
        const principal = authenticate(request, config);
        if (
          !(await ctx.cache.rateLimit(
            `rate:${JSON.stringify([principal.tenantId, principal.userId])}`,
            30,
            60,
          ))
        )
          throw new AppError('RATE_LIMIT', '请求过于频繁。', 429);
        const parsed = chatRequestSchema.safeParse(await request.body());
        if (!parsed.success)
          throw new AppError(
            'INVALID_REQUEST',
            '需要 conversationId 和 message；不接受身份或权限字段。',
            400,
          );
        await ctx.sessions.open(parsed.data.conversationId, principal);
        return {
          stream: async (emit, signal) => {
            await ctx.agent.run({ ...parsed.data, principal, signal }, emit);
          },
        };
      }),
    );
  },
};
