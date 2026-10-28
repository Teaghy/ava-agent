import { loadConfig } from '../src/config/index.js';
import { createHarness } from '../src/bootstrap/plugins.js';
import type { Principal } from '../src/core/common.types.js';
import type { TelemetryService } from '../src/core/observability/telemetry.service.js';
export const principal: Principal = { tenantId: 'demo', userId: 'alice', permissions: ['READ'] };
export const silentTelemetry: TelemetryService = {
  span: (_name, _attributes, fn) => fn(),
  log() {},
};
export const makeHarness = (overrides: Parameters<typeof loadConfig>[0] = {}) =>
  createHarness(loadConfig({ NODE_ENV: 'test', ...overrides }), { quiet: true });
