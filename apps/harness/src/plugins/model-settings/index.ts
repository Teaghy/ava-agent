import type { Context } from 'cordis';
import { modelApplySchema } from '@ava/protocol';
import { authenticate, type AuthConfig } from '../../core/http/auth.js';
import { AppError } from '../../core/errors.js';
import type { ModelSettingsController } from './controller.js';
export const modelSettingsApiPlugin = {
  name: 'model-settings-api',
  inject: ['ops', 'telemetry'],
  apply(ctx: Context, config: AuthConfig & { models: ModelSettingsController }) {
    const authorize = (request: Parameters<typeof authenticate>[0]) => {
      const principal = authenticate(request, config);
      if (!principal.admin || !principal.managePlugins)
        throw new AppError('FORBIDDEN', '此操作需要模型和插件管理权限。', 403);
      return principal;
    };
    ctx.effect(() =>
      ctx.ops.get('/api/v1/ops/models', async (request) => {
        authorize(request);
        return { headers: { 'Cache-Control': 'no-store' }, body: config.models.view() };
      }),
    );
    ctx.effect(() =>
      ctx.ops.post('/api/v1/ops/models/apply', async (request) => {
        const principal = authorize(request);
        const parsed = modelApplySchema.safeParse(await request.body());
        if (!parsed.success)
          throw new AppError(
            'INVALID_MODEL_SETTINGS',
            '模型配置格式无效，请检查地址、模型和维度。',
            400,
          );
        const view = config.models.apply(parsed.data);
        ctx.telemetry.log(
          {
            event: 'ops.models.apply',
            actor_tenant_id: principal.tenantId,
            actor_user_id: principal.userId,
            job_id: view.job?.id,
          },
          'model settings requested',
        );
        return { status: 202, headers: { 'Cache-Control': 'no-store' }, body: view };
      }),
    );
  },
};
