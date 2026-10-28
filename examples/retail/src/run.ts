import { createHarness, loadConfig } from '@ava/harness';
import { createRetailPreset } from './retail.js';
import { demoRetailServices, demoPrincipal } from './demo-data.js';

const harness = await createHarness(
  loadConfig({
    NODE_ENV: 'development',
    APP_MODE: 'mock',
    INFRA_MODE: 'memory',
    SEED_KNOWLEDGE: 'false',
    MEM0_ENABLED: 'false',
    OTEL_ENABLED: 'false',
  }),
  { ...createRetailPreset(demoRetailServices), quiet: true },
);
try {
  for (const [index, message] of ['查询订单 A100', '配送政策是什么'].entries()) {
    const result = await harness.ctx.agent.run({
      conversationId: `retail-demo-${index}`,
      message,
      principal: demoPrincipal,
    });
    console.log(
      JSON.stringify({ question: message, answer: result.answer, citations: result.citations }),
    );
  }
} finally {
  await harness.stop();
}
