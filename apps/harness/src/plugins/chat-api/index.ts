import type { Context } from 'cordis';
import { chatRequestSchema } from '@ava/protocol';
import { authenticateRequest as authenticate, type AuthConfig } from '../../core/http/auth.js';
import { AppError } from '../../core/errors.js';
import type { AgentService } from '../../core/agent/agent.service.js';
export const chatApiPlugin = {
  name: 'chat-api',
  inject: ['http', 'sessions', 'cache'],
  apply(
    ctx: Context,
    config: AuthConfig & { getAgent: () => AgentService | undefined; isPaused: () => boolean },
  ) {
    ctx.effect(() =>
      ctx.http.post('/api/v1/chat', async (request) => {
        const principal = await authenticate(request, config);
        if (principal.allowChat === false)
          throw new AppError('FORBIDDEN', '此应用凭证没有对话权限。', 403);
        if (config.isPaused())
          throw new AppError('PLUGIN_CHANGE_IN_PROGRESS', '插件正在变更，请稍后重试。', 503);
        if (
          !(await ctx.cache.rateLimit(
            `rate:${JSON.stringify([principal.tenantId, principal.applicationId ? ['application', principal.applicationId] : principal.userId])}`,
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
            if (config.isPaused())
              throw new AppError('PLUGIN_CHANGE_IN_PROGRESS', '插件正在变更，请稍后重试。', 503);
            const agent = config.getAgent();
            if (!agent) throw new AppError('AGENT_STOPPED', 'Agent 尚未就绪。', 503);
            await agent.run({ ...parsed.data, principal, signal }, emit);
          },
        };
      }),
    );
  },
};
