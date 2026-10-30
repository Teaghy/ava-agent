export * from './client.js';
export { parseSse } from './stream.js';
export type { ChatEvent, ChatRequest } from '@ava/protocol';
export type { ModelApplyRequest, ModelSettingsView, ModelJob } from '@ava/protocol';
export type {
  PluginInstallRequest,
  PluginActionRequest,
  PluginConfigureRequest,
  PluginManagerSnapshot,
  PluginView,
  ProviderView,
  RuntimePluginView,
  PluginSlot,
} from '@ava/protocol';
export type { ModelCompatibilityOptions, ResolvedModelCompatibility } from '@ava/protocol';
