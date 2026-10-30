import { modelApplySchema, modelSettingsViewSchema, type ModelApplyRequest } from '@ava/protocol';
import type { Request } from './client.js';
export function createModelClient(request: Request) {
  return {
    get: async (signal?: AbortSignal) =>
      modelSettingsViewSchema.parse(await (await request('/api/v1/ops/models', { signal })).json()),
    apply: async (input: ModelApplyRequest, signal?: AbortSignal) =>
      modelSettingsViewSchema.parse(
        await (
          await request('/api/v1/ops/models/apply', {
            method: 'POST',
            body: JSON.stringify(modelApplySchema.parse(input)),
            signal,
          })
        ).json(),
      ),
  };
}
