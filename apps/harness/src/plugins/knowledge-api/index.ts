import type { Context } from 'cordis';
import { knowledgeDocumentSchema } from '@ava/protocol';
import { authenticateRequest as authenticate, type AuthConfig } from '../../core/http/auth.js';
import { AppError } from '../../core/errors.js';
export const knowledgeApiPlugin = {
  name: 'knowledge-api',
  inject: ['http', 'rag'],
  apply(ctx: Context, config: AuthConfig & { isPaused?: () => boolean }) {
    ctx.effect(() =>
      ctx.http.post('/api/v1/knowledge', async (request) => {
        const principal = await authenticate(request, config);
        if (!principal.admin && !principal.manageKnowledge)
          throw new AppError('FORBIDDEN', '此接口需要管理员权限。', 403);
        if (config.isPaused?.())
          throw new AppError(
            'MAINTENANCE_IN_PROGRESS',
            '模型或插件正在切换，请稍后导入知识。',
            503,
          );
        const parsed = knowledgeDocumentSchema.safeParse(await request.body());
        if (!parsed.success) throw new AppError('INVALID_DOCUMENT', '知识文档格式不正确。', 400);
        const { metadata: meta, ...document } = parsed.data;
        if (
          principal.applicationId &&
          document.knowledgeSpaceId !== undefined &&
          document.knowledgeSpaceId !== principal.knowledgeSpaceId
        )
          throw new AppError('FORBIDDEN', '不能向此应用范围外的知识空间导入。', 403);
        if (principal.applicationId) document.knowledgeSpaceId = principal.knowledgeSpaceId;
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
  },
};
