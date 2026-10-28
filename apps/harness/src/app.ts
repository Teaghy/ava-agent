/** Programmatic application entry; importing this module never starts a server. */
export { createHarness } from './bootstrap/plugins.js';
export { loadConfig, configSchema, type Config } from './config/index.js';
export type {
  HarnessOptions,
  HarnessProviders,
  HarnessPlugin,
  ProviderSlot,
} from './bootstrap/extensions.js';
