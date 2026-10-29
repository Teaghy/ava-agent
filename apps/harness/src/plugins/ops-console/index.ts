import type { Context } from 'cordis';
import { fileURLToPath } from 'node:url';
import type { AuthConfig } from '../../core/http/auth.js';
import { H3HttpService } from '../http-h3/http.service.js';
import { pluginManagerApiPlugin } from '../plugin-manager/index.js';
import type { PluginManager } from '../plugin-manager/manager.js';
import { opsRunsApiPlugin } from './runs-api.js';

/** Boot infrastructure: never registered in the user-managed plugin catalog. */
export const opsConsolePlugin = {
  name: 'ops-console',
  provide: ['ops'],
  apply(ctx: Context, config: AuthConfig & { manager: PluginManager; secrets?: string[] }) {
    const http = new H3HttpService();
    ctx.provide('ops', http);
    ctx.effect(() => () => http.stop());
    // Published Harness carries its UI; tsx development reads the Ops workspace build.
    const assets = import.meta.url.endsWith('.ts') ? '../../../../ops/dist/' : '../../ops/';
    ctx.effect(() => http.static('/', fileURLToPath(new URL(assets, import.meta.url))));
    ctx.plugin(pluginManagerApiPlugin, config);
    ctx.plugin(opsRunsApiPlugin, config);
  },
};
