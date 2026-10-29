import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';
import { redactTrace } from '../src/plugins/ops-console/redact.js';
import { InMemoryStorage } from '../src/plugins/storage-memory/index.js';
import type { AgentState } from '../src/core/agent/agent.types.js';
import type { Principal } from '../src/core/common.types.js';

const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
const state = (runId: string, status: AgentState['status'] = 'completed'): AgentState => ({
  runId,
  conversationId: 'conversation',
  userId: 'alice',
  goal: '测试问题',
  entities: {},
  observations: [],
  toolCalls: [],
  retrievedDocuments: [],
  step: 2,
  status,
});
async function setup() {
  const principal: Principal = { tenantId: 'demo', userId: 'alice', permissions: ['READ'] };
  const maintainer = {
    tenantId: 'platform',
    userId: 'operator',
    permissions: ['READ'],
    admin: true,
    managePlugins: true,
  };
  const h = await createHarness(
    loadConfig({
      NODE_ENV: 'test',
      APP_MODE: 'mock',
      APP_PRESET: 'chat',
      INFRA_MODE: 'memory',
      PORT: '0',
      SEED_KNOWLEDGE: 'false',
      OPS_ENABLED: 'true',
      OPS_PORT: '0',
      API_KEYS: JSON.stringify({ customer: principal, business: { ...principal, admin: true } }),
      OPS_API_KEYS: JSON.stringify({
        operator: { ...maintainer, inspectRuns: true, inspectTenants: ['demo'] },
        scoped: { ...maintainer, inspectRuns: true },
        incomplete: { ...maintainer, managePlugins: false },
        viewer: { tenantId: 'demo', userId: 'reviewer', permissions: [], inspectRuns: true },
        manager: maintainer,
      }),
    }),
    { quiet: true },
  );
  harnesses.push(h);
  const publicUrl = `http://127.0.0.1:${await h.start()}`;
  const opsUrl = `http://127.0.0.1:${h.opsPort}`;
  const call = (path: string, body?: unknown, token = 'operator', base = opsUrl) =>
    fetch(`${base}/api/v1/ops/runs/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { h, call, principal, publicUrl, opsUrl };
}

describe('Ops run inspection', () => {
  it('separates read-only inspection from plugin control and removes public replay', async () => {
    const { call, publicUrl, opsUrl } = await setup();
    const headers = (token: string) => ({ authorization: `Bearer ${token}` });
    expect(
      await (await fetch(`${opsUrl}/api/v1/ops/access`, { headers: headers('viewer') })).json(),
    ).toEqual({ managePlugins: false, inspectRuns: true });
    expect(
      await (await fetch(`${opsUrl}/api/v1/ops/access`, { headers: headers('manager') })).json(),
    ).toEqual({ managePlugins: true, inspectRuns: false });
    expect((await call('list', { tenantId: 'demo' }, 'viewer')).status).toBe(200);
    expect((await call('access', undefined, 'manager')).status).toBe(403);
    for (const path of ['', '/install', '/action', '/configure']) {
      expect(
        (
          await fetch(`${opsUrl}/api/v1/plugins${path}`, {
            method: path ? 'POST' : 'GET',
            headers: headers('viewer'),
            ...(path ? { body: '{}' } : {}),
          })
        ).status,
      ).toBe(403);
    }
    expect((await fetch(`${opsUrl}/api/v1/plugins`, { headers: headers('manager') })).status).toBe(
      200,
    );
    for (const base of [publicUrl, opsUrl]) {
      expect(
        (
          await fetch(`${base}/api/v1/runs/replay`, {
            method: 'POST',
            headers: headers('business'),
            body: JSON.stringify({ runId: randomUUID() }),
          })
        ).status,
      ).toBe(404);
    }
    expect(() =>
      loadConfig({
        NODE_ENV: 'test',
        OPS_ENABLED: 'true',
        OPS_API_KEYS: JSON.stringify({
          viewer: { tenantId: 'demo', userId: 'reviewer', permissions: [], inspectRuns: true },
        }),
      }),
    ).not.toThrow();
  });
  it('isolates credentials, listener and tenant scopes before reading storage', async () => {
    const { h, call, publicUrl } = await setup();
    const read = vi.spyOn(h.ctx.storage, 'listRuns');
    for (const token of ['customer', 'business', 'invalid'])
      expect((await call('access', undefined, token)).status).toBe(401);
    expect((await call('access', undefined, 'incomplete')).status).toBe(403);
    expect(await (await call('access')).json()).toEqual({ tenantIds: ['platform', 'demo'] });
    expect((await call('list', { tenantId: 'demo' }, 'scoped')).status).toBe(403);
    expect((await call('detail', { tenantId: 'other', runId: randomUUID() })).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect((await call('list', { tenantId: 'demo' }, 'operator', publicUrl)).status).toBe(404);
    expect(
      (await call('detail', { tenantId: 'demo', runId: randomUUID() }, 'operator', publicUrl))
        .status,
    ).toBe(404);
    expect((await call('list', { tenantId: 'demo', limit: 101 })).status).toBe(400);
    expect((await call('list', { tenantId: 'demo', offset: -1 })).status).toBe(400);
    expect((await call('detail', { tenantId: 'demo', runId: randomUUID() })).status).toBe(404);
  });

  it('lists successful and failed questions, reads ordered redacted events, and logs inspection', async () => {
    const { h, call, principal } = await setup();
    const result = await h.ctx.agent.run({
      conversationId: randomUUID(),
      message: '你好',
      principal,
    });
    const decide = vi
      .spyOn(h.ctx.decision, 'decide')
      .mockRejectedValueOnce(new Error('private provider failure'));
    const conversationId = randomUUID();
    await expect(
      h.ctx.agent.run({ conversationId, message: '失败的问题', principal }),
    ).rejects.toThrow();
    decide.mockRestore();
    const log = vi.spyOn(h.ctx.telemetry, 'log');
    const first = await (await call('list', { tenantId: 'demo', limit: 1 })).json();
    expect(first.runs).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    const next = await (await call('list', { tenantId: 'demo', limit: 1, offset: 1 })).json();
    expect(next.runs).toHaveLength(1);
    expect(next.hasMore).toBe(false);
    expect(first.runs[0].runId).not.toBe(next.runs[0].runId);
    const failed = await (
      await call('list', { tenantId: 'demo', status: 'failed', conversationId })
    ).json();
    expect(failed.runs).toHaveLength(1);
    expect(failed.runs[0].question).toBe('失败的问题');
    const failedDetail = await (
      await call('detail', { tenantId: 'demo', runId: failed.runs[0].runId })
    ).json();
    expect(
      failedDetail.events.find((e: { type: string }) => e.type === 'error').payload,
    ).toMatchObject({ phase: 'decision', step: 1, durationMs: expect.any(Number) });
    const recovered = await h.ctx.eventStore.recover(result.runId, 'demo');
    await h.ctx.eventStore.append(recovered!, 'demo', 'tool_result', {
      api_key: 'sensitive',
      nested: { authorization: 'Bearer abc' },
      result: 'operator',
      useful: 'visible',
    });
    const response = await call('detail', { tenantId: 'demo', runId: result.runId });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const detail = await response.json();
    expect(detail.run.runId).toBe(result.runId);
    expect(detail.events.at(-1).payload).toEqual({
      api_key: '[REDACTED]',
      nested: { authorization: '[REDACTED]' },
      result: '[REDACTED]',
      useful: 'visible',
    });
    expect(
      detail.events.some(
        (e: { type: string; payload: { phase?: string } }) =>
          e.type === 'execution_span' && e.payload.phase === 'guard',
      ),
    ).toBe(true);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ops.runs.read',
        actor_user_id: 'operator',
        tenant_id: 'demo',
        run_id: result.runId,
        action: 'detail',
        allowed: true,
      }),
      'run inspection',
    );
    expect((await h.ctx.eventStore.replay(result.runId, 'demo')).at(-1)?.payload).toMatchObject({
      api_key: 'sensitive',
    });
  });

  it('filters memory runs by tenant, IDs and dates without exposing state payloads', async () => {
    const storage = new InMemoryStorage();
    const id = randomUUID();
    await storage.saveRun(state(id), 'demo');
    await storage.saveRun(state(randomUUID()), 'other');
    const q = { tenantId: 'demo', limit: 30, offset: 0 };
    const rows = await storage.listRuns(q);
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('observations');
    expect(await storage.listRuns({ ...q, runId: randomUUID() })).toEqual([]);
    expect(await storage.listRuns({ ...q, since: '2999-01-01T00:00:00.000Z' })).toEqual([]);
    expect(await storage.listRuns({ ...q, until: '2000-01-01T00:00:00.000Z' })).toEqual([]);
    expect(
      await storage.listRuns({ ...q, runId: id, conversationId: 'conversation' }),
    ).toHaveLength(1);
  });

  it('filters secrets and reasoning recursively and bounds large trace fields', () => {
    expect(
      redactTrace(
        {
          access_token: 'a',
          reasoning_content: 'hidden',
          data: ['Bearer abc', 'https://u:p@example.com/?token=abc', 'known-key'],
        },
        ['known-key'],
      ),
    ).toEqual({
      access_token: '[REDACTED]',
      reasoning_content: '[REDACTED]',
      data: ['Bearer [REDACTED]', 'https://[REDACTED]@example.com/?token=[REDACTED]', '[REDACTED]'],
    });
    expect(String(redactTrace('x'.repeat(20000))).length).toBeLessThan(16100);
    expect(redactTrace(Array.from({ length: 101 }, () => 'x'))).toHaveLength(101);
  });
});
