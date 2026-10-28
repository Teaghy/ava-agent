import { AgentClient } from '@ava/sdk';
import type {
  PluginActionRequest,
  PluginInstallRequest,
  PluginConfigureRequest,
} from '@ava/protocol';

export const loadPlugins = (token: string, signal?: AbortSignal) =>
  new AgentClient({ token }).plugins.list(signal);
export const installPlugin = (token: string, input: PluginInstallRequest, signal?: AbortSignal) =>
  new AgentClient({ token }).plugins.install(input, signal);
export const changePlugin = (token: string, input: PluginActionRequest, signal?: AbortSignal) =>
  new AgentClient({ token }).plugins.action(input, signal);
export const configurePlugin = (
  token: string,
  input: PluginConfigureRequest,
  signal?: AbortSignal,
) => new AgentClient({ token }).plugins.configure(input, signal);
