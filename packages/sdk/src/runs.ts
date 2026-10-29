import {
  runAccessSchema,
  runListRequestSchema,
  runListResponseSchema,
  runDetailRequestSchema,
  runDetailResponseSchema,
  type RunListRequest,
  type RunDetailRequest,
} from '@ava/protocol';
import type { Request } from './client.js';

export function createRunClient(request: Request) {
  return {
    async access(signal?: AbortSignal) {
      return runAccessSchema.parse(
        await (await request('/api/v1/ops/runs/access', { signal })).json(),
      );
    },
    async list(input: RunListRequest, signal?: AbortSignal) {
      return runListResponseSchema.parse(
        await (
          await request('/api/v1/ops/runs/list', {
            method: 'POST',
            body: JSON.stringify(runListRequestSchema.parse(input)),
            signal,
          })
        ).json(),
      );
    },
    async get(input: RunDetailRequest, signal?: AbortSignal) {
      return runDetailResponseSchema.parse(
        await (
          await request('/api/v1/ops/runs/detail', {
            method: 'POST',
            body: JSON.stringify(runDetailRequestSchema.parse(input)),
            signal,
          })
        ).json(),
      );
    },
  };
}
