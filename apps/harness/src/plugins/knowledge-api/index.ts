import type { Context } from 'cordis';
import { z } from 'zod';
import { knowledgeDocumentSchema } from '@ava/protocol';
import { authenticate, type AuthConfig } from '../../core/http/auth.js';
import { AppError } from '../../core/errors.js';
export const knowledgeApiPlugin = {
  name: 'knowledge-api',
  inject: ['http', 'rag', 'eventStore'],
  apply(ctx: Context, config: AuthConfig) {
    ctx.effect(() =>
      ctx.http.post('/api/v1/knowledge', async (request) => {
        const principal = authenticate(request, config);
        if (!principal.admin) throw new AppError('FORBIDDEN', '此接口需要管理员权限。', 403);
        const parsed = knowledgeDocumentSchema.safeParse(await request.body());
        if (!parsed.success) throw new AppError('INVALID_DOCUMENT', '知识文档格式不正确。', 400);
        const { metadata: meta, ...document } = parsed.data;
        const clean = Object.fromEntries(
          Object.entries(meta).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        );
        return {
          status: 201,
          body: {
            chunks: await ctx.rag.ingest({ ...document, metadata: clean }, principal.tenantId),
          },
        };
      }),
    );
    ctx.effect(() =>
      ctx.http.post('/api/v1/runs/replay', async (request) => {
        const principal = authenticate(request, config);
        if (!principal.admin) throw new AppError('FORBIDDEN', '此接口需要管理员权限。', 403);
        const body = z
          .object({ runId: z.string().uuid() })
          .strict()
          .safeParse(await request.body());
        if (!body.success) throw new AppError('INVALID_REQUEST', '需要有效的 runId。', 400);
        return {
          body: {
            events: await ctx.eventStore.replay(body.data.runId, principal.tenantId),
            checkpoint: await ctx.eventStore.recover(body.data.runId, principal.tenantId),
          },
        };
      }),
    );
  },
};
