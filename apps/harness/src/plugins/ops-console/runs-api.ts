import type { Context } from 'cordis';
import { runListRequestSchema, runDetailRequestSchema } from '@ava/protocol';
import { authenticate, type AuthConfig } from '../../core/http/auth.js';
import type { HttpRequest } from '../../core/http/http.types.js';
import { AppError } from '../../core/errors.js';
import { redactTrace } from './redact.js';

export const opsRunsApiPlugin = {
  name: 'ops-runs-api',
  inject: ['ops', 'storage', 'eventStore', 'telemetry'],
  apply(ctx: Context, config: AuthConfig & { secrets?: string[] }) {
    const authorize = (request: HttpRequest) => {
      const p = authenticate(request, config);
      if (p.admin !== true || p.managePlugins !== true)
        throw new AppError('FORBIDDEN', '此接口需要平台维护权限。', 403);
      return p;
    };
    const scope = (
      p: ReturnType<typeof authorize>,
      tenantId: string,
      action: string,
      runId?: string,
    ) => {
      const allowed = p.tenantId === tenantId || p.inspectTenants?.includes(tenantId) === true;
      ctx.telemetry.log(
        {
          event: 'ops.runs.read',
          actor_tenant_id: p.tenantId,
          actor_user_id: p.userId,
          tenant_id: tenantId,
          run_id: runId,
          action,
          allowed,
        },
        'run inspection',
      );
      if (!allowed) throw new AppError('FORBIDDEN', '未授权查看此租户的运行记录。', 403);
    };
    const cleanRun = <T extends { question: string }>(run: T): T => ({
      ...run,
      question: String(redactTrace(run.question, config.secrets)),
    });
    ctx.effect(() =>
      ctx.ops.get('/api/v1/ops/runs/access', async (request) => {
        const p = authorize(request);
        return { body: { tenantIds: [...new Set([p.tenantId, ...(p.inspectTenants ?? [])])] } };
      }),
    );
    ctx.effect(() =>
      ctx.ops.post('/api/v1/ops/runs/list', async (request) => {
        const p = authorize(request);
        const parsed = runListRequestSchema.safeParse(await request.body());
        if (!parsed.success) throw new AppError('INVALID_REQUEST', '运行查询条件无效。', 400);
        const q = parsed.data;
        scope(p, q.tenantId, 'list', q.runId);
        const rows = await ctx.storage.listRuns({ ...q, limit: q.limit + 1 });
        return {
          headers: { 'Cache-Control': 'no-store' },
          body: {
            runs: rows.slice(0, q.limit).map(cleanRun),
            hasMore: rows.length > q.limit,
          },
        };
      }),
    );
    ctx.effect(() =>
      ctx.ops.post('/api/v1/ops/runs/detail', async (request) => {
        const p = authorize(request);
        const parsed = runDetailRequestSchema.safeParse(await request.body());
        if (!parsed.success)
          throw new AppError('INVALID_REQUEST', '需要有效的租户和运行 ID。', 400);
        const q = parsed.data;
        scope(p, q.tenantId, 'detail', q.runId);
        const [run] = await ctx.storage.listRuns({ ...q, limit: 1, offset: 0 });
        if (!run) throw new AppError('NOT_FOUND', '运行记录不存在。', 404);
        const events = await ctx.eventStore.replay(q.runId, q.tenantId);
        return {
          headers: { 'Cache-Control': 'no-store' },
          body: {
            run: cleanRun(run),
            events: events.map(({ id, type, createdAt, payload }) => ({
              id,
              type,
              createdAt,
              payload: redactTrace(payload, config.secrets),
            })),
          },
        };
      }),
    );
  },
};
