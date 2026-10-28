import type { Context } from 'cordis';
import { pluginInstallSchema, pluginActionSchema, pluginConfigureSchema } from '@ava/protocol';
import { authenticate, type AuthConfig } from '../../core/http/auth.js';
import type { HttpRequest } from '../../core/http/http.types.js';
import { AppError } from '../../core/errors.js';
import type { PluginManager } from './manager.js';

export const pluginManagerApiPlugin = {
  name: 'plugin-manager-api',
  inject: ['ops'],
  apply(ctx: Context, config: AuthConfig & { manager: PluginManager }) {
    const authorize = (request: HttpRequest) => {
      const principal = authenticate(request, config);
      if (principal.admin !== true || principal.managePlugins !== true)
        throw new AppError('FORBIDDEN', '此接口需要平台插件管理权限。', 403);
    };
    ctx.effect(() =>
      ctx.ops.get('/api/v1/plugins', async (request) => {
        authorize(request);
        return { body: config.manager.snapshot() };
      }),
    );
    ctx.effect(() =>
      ctx.ops.post('/api/v1/plugins/install', async (request) => {
        authorize(request);
        const input = pluginInstallSchema.safeParse(await request.body());
        if (!input.success) throw new AppError('INVALID_PLUGIN_REQUEST', '插件注册参数无效。', 400);
        return { status: 201, body: await config.manager.install(input.data) };
      }),
    );
    ctx.effect(() =>
      ctx.ops.post('/api/v1/plugins/action', async (request) => {
        authorize(request);
        const input = pluginActionSchema.safeParse(await request.body());
        if (!input.success) throw new AppError('INVALID_PLUGIN_REQUEST', '插件操作参数无效。', 400);
        return { body: await config.manager.action(input.data) };
      }),
    );
    ctx.effect(() =>
      ctx.ops.post('/api/v1/plugins/configure', async (request) => {
        authorize(request);
        const input = pluginConfigureSchema.safeParse(await request.body());
        if (!input.success) throw new AppError('INVALID_PLUGIN_REQUEST', '插件配置参数无效。', 400);
        return { body: await config.manager.configure(input.data) };
      }),
    );
  },
};
