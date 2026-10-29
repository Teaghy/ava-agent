import { afterEach, expect, it, vi } from 'vitest';
import { AgentClient } from '../src/index.js';
afterEach(() => vi.unstubAllGlobals());
it('queries only Ops run endpoints with validated scope, auth and cancellation', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ tenantIds: ['demo'] }))
    .mockResolvedValueOnce(Response.json({ runs: [], hasMore: false }));
  vi.stubGlobal('fetch', fetcher);
  const client = new AgentClient({ baseURL: 'http://localhost:3001', token: 'ops-token' });
  const signal = new AbortController().signal;
  expect(await client.runs.access(signal)).toEqual({ tenantIds: ['demo'] });
  expect(await client.runs.list({ tenantId: 'demo', status: 'failed' }, signal)).toEqual({
    runs: [],
    hasMore: false,
  });
  const [url, init] = fetcher.mock.calls[1]!;
  expect(url).toBe('http://localhost:3001/api/v1/ops/runs/list');
  expect(init?.signal).toBe(signal);
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer ops-token');
  expect(JSON.parse(String(init?.body))).toMatchObject({
    tenantId: 'demo',
    limit: 30,
    offset: 0,
    status: 'failed',
  });
  await expect(client.runs.get({ tenantId: 'demo', runId: 'invalid' })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockResolvedValueOnce(Response.json({ events: [] }));
  await expect(
    client.runs.get({ tenantId: 'demo', runId: '11111111-1111-4111-8111-111111111111' }),
  ).rejects.toThrow();
});
