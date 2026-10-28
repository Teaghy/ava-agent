import { loadConfig } from '../config/index.js';
import { createHarness } from './plugins.js';
import { loadApplicationConfig } from './application-config.js';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
export async function bootstrap() {
  const config = loadConfig();
  const options = await loadApplicationConfig({ configPath: process.env.AVA_CONFIG });
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const management = options.pluginManagement;
  const harness = await createHarness(config, {
    ...options,
    pluginManagement:
      management === false
        ? false
        : {
            statePath: resolve(
              root,
              process.env.PLUGIN_STATE_PATH ?? management?.statePath ?? config.PLUGIN_STATE_PATH,
            ),
            safeMode:
              process.env.PLUGIN_SAFE_MODE !== undefined
                ? config.PLUGIN_SAFE_MODE
                : (management?.safeMode ?? config.PLUGIN_SAFE_MODE),
          },
  });
  const port = await harness.start();
  harness.ctx.telemetry.log({ port }, 'HTTP listening');
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      void harness.stop().catch(() => {
        process.exitCode = 1;
      });
    });

  return harness;
}
