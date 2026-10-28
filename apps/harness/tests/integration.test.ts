import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../src/config/index.js';
import { createHarness } from '../src/bootstrap/plugins.js';
import { demoKnowledge } from '../src/fixtures/knowledge.js';
import type { Principal } from '../src/core/common.types.js';
describe('PostgreSQL + Redis + Qdrant integration (mock LLM, real infrastructure)', () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;
  const tenant = `integration-${randomUUID()}`;
  const principal: Principal = {
    tenantId: tenant,
    userId: 'integration-user',
    permissions: ['READ'],
  };
  beforeAll(async () => {
    const config = loadConfig();
    harness = await createHarness(
      {
        ...config,
        NODE_ENV: 'test',
        APP_MODE: 'mock',
        INFRA_MODE: 'external',
        MEM0_ENABLED: false,
        SEED_KNOWLEDGE: false,
        QDRANT_COLLECTION: 'knowledge_integration_64',
      },
      { quiet: true },
    );
    await harness.ctx.rag.ingest(demoKnowledge, tenant);
  });
  afterAll(async () => {
    await harness?.stop();
  });
  it('runs full Agent→RAG→Qdrant flow and replays persisted SQL events', async () => {
    const conversationId = randomUUID();
    const result = await harness.ctx.agent.run({
      conversationId,
      message: '我的 VCD-2000 更换耗材后 E102，怎么处理？',
      principal,
    });
    expect(result.citations.length).toBeGreaterThan(0);
    expect(
      (await harness.ctx.storage.listConversations(principal, 100)).some(
        (c) => c.id === conversationId,
      ),
    ).toBe(true);
    expect((await harness.ctx.storage.messages(conversationId, 100)).at(-1)?.citations).toEqual(
      result.citations,
    );
    const events = await harness.ctx.eventStore.replay(result.runId, tenant);
    expect(events.map((e) => e.type)).toContain('rag_result');
    expect((await harness.ctx.eventStore.recover(result.runId, tenant))?.status).toBe('completed');
    expect(await harness.ctx.eventStore.replay(result.runId, 'other')).toEqual([]);
  });
  it('Redis locks use owner-checked atomic renewal and release', async () => {
    const cache = harness.ctx.cache;
    const key = `integration-lock:${randomUUID()}`;
    expect(await cache.acquire(key, 'owner', 10)).toBe(true);
    expect(await cache.acquire(key, 'other', 10)).toBe(false);
    await cache.release(key, 'other');
    expect(await cache.renew(key, 'owner', 10)).toBe(true);
    expect(await cache.renew(key, 'other', 10)).toBe(false);
    await cache.release(key, 'owner');
    expect(await cache.acquire(key, 'other', 10)).toBe(true);
    await cache.release(key, 'other');
    const rateKey = `integration-rate:${randomUUID()}`;
    expect(await cache.rateLimit(rateKey, 1, 1)).toBe(true);
    expect(await cache.rateLimit(rateKey, 1, 1)).toBe(false);
  });
  it('stores and deletes scoped long-term facts in PostgreSQL', async () => {
    const item = await harness.ctx.memory.remember({
      tenantId: tenant,
      userId: principal.userId,
      category: 'device',
      content: 'VCD-2000',
    });
    expect((await harness.ctx.memory.recall('VCD', principal)).some((m) => m.id === item.id)).toBe(
      true,
    );
    await harness.ctx.memory.forget(item.id, principal);
    expect(await harness.ctx.memory.recall('VCD', principal)).toEqual([]);
    expect(await harness.ctx.rag.search({ query: 'E102', tenantId: `${tenant}-other` })).toEqual(
      [],
    );
  });
  it('enforces append-only events at the PostgreSQL boundary', async () => {
    const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
    try {
      await expect(
        pool.query('update agent_events set payload = payload where tenant_id = $1', [tenant]),
      ).rejects.toThrow('append-only');
      await expect(
        pool.query('delete from agent_events where tenant_id = $1', [tenant]),
      ).rejects.toThrow('append-only');
    } finally {
      await pool.end();
    }
  });
});
