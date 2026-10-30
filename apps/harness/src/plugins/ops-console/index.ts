import type { Context } from 'cordis';
import { fileURLToPath } from 'node:url';
import { authenticate, type AuthConfig } from '../../core/http/auth.js';
import { AppError } from '../../core/errors.js';
import { H3HttpService } from '../http-h3/http.service.js';
import { pluginManagerApiPlugin } from '../plugin-manager/index.js';
import type { PluginManager } from '../plugin-manager/manager.js';
import { opsRunsApiPlugin } from './runs-api.js';
import { modelSettingsApiPlugin } from '../model-settings/index.js';
import type { ModelSettingsController } from '../model-settings/controller.js';

/** Boot infrastructure: never registered in the user-managed plugin catalog. */
export const opsConsolePlugin = {
  name: 'ops-console',
  provide: ['ops'],
  apply(
    ctx: Context,
    config: AuthConfig & {
      manager: PluginManager;
      secrets?: string[];
      models?: ModelSettingsController;
    },
  ) {
    const http = new H3HttpService();
    ctx.provide('ops', http);
    ctx.effect(() => () => http.stop());
    ctx.effect(() =>
      http.get('/api/v1/ops/access', async (request) => {
        const p = authenticate(request, config);
        const access = {
          managePlugins: p.admin === true && p.managePlugins === true,
          inspectRuns: p.inspectRuns === true,
        };
        if (!access.managePlugins && !access.inspectRuns)
          throw new AppError('FORBIDDEN', '此身份没有维护权限。', 403);
        return { headers: { 'Cache-Control': 'no-store' }, body: access };
      }),
    );
    // Published Harness carries its UI; tsx development reads the Ops workspace build.
    const assets = import.meta.url.endsWith('.ts') ? '../../../../ops/dist/' : '../../ops/';
    ctx.effect(() => http.static('/', fileURLToPath(new URL(assets, import.meta.url))));
    ctx.plugin(pluginManagerApiPlugin, config);
    ctx.plugin(opsRunsApiPlugin, config);
    if (config.models)
      ctx.plugin(modelSettingsApiPlugin, { keys: config.keys, models: config.models });
  },
};
