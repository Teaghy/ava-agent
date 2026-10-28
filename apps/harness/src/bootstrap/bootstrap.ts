import { loadConfig } from '../config/index.js';
import { createHarness } from './plugins.js';
export async function bootstrap() {
  const harness = await createHarness(loadConfig());
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
