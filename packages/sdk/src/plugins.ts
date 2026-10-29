import {
  pluginActionSchema,
  pluginInstallSchema,
  pluginConfigureSchema,
  pluginManagerSnapshotSchema,
  type PluginActionRequest,
  type PluginInstallRequest,
  type PluginConfigureRequest,
  MAX_PLUGIN_UPLOAD_BYTES,
} from '@ava/protocol';
import type { Request } from './client.js';

export function createPluginClient(request: Request) {
  const snapshot = async (path: string, init: RequestInit) =>
    pluginManagerSnapshotSchema.parse(await (await request(path, init)).json());
  return {
    list: (signal?: AbortSignal) => snapshot('/api/v1/plugins', { signal }),
    async upload(file: Blob, signal?: AbortSignal) {
      if (!file.size || file.size > MAX_PLUGIN_UPLOAD_BYTES)
        throw new Error('插件 ZIP 包必须为 1 字节至 10 MiB。');
      return snapshot('/api/v1/plugins/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: file,
        signal,
      });
    },
    async install(input: PluginInstallRequest, signal?: AbortSignal) {
      return snapshot('/api/v1/plugins/install', {
        method: 'POST',
        body: JSON.stringify(pluginInstallSchema.parse(input)),
        signal,
      });
    },
    async action(input: PluginActionRequest, signal?: AbortSignal) {
      return snapshot('/api/v1/plugins/action', {
        method: 'POST',
        body: JSON.stringify(pluginActionSchema.parse(input)),
        signal,
      });
    },
    async configure(input: PluginConfigureRequest, signal?: AbortSignal) {
      return snapshot('/api/v1/plugins/configure', {
        method: 'POST',
        body: JSON.stringify(pluginConfigureSchema.parse(input)),
        signal,
      });
    },
  };
}
