import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig } from '../src/config/index.js';
import { createHarness } from '../src/bootstrap/plugins.js';
import { demoKnowledge } from '../src/fixtures/knowledge.js';
import type { Principal } from '../src/core/common.types.js';
import { IdentityService } from '../src/core/identity/identity.service.js';
import { PostgresIdentityStore } from '../src/plugins/storage-postgres/identity-store.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../src/plugins/storage-postgres/schema/index.js';
import { applicationKeySchema, applicationPrincipal } from '../src/core/http/application-auth.js';
import {
  ApplicationAccessService,
  credentialHash,
} from '../src/core/applications/application.service.js';
import { PostgresApplicationStore } from '../src/plugins/storage-postgres/application-store.js';
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
    const query = { tenantId: tenant, runId: result.runId, limit: 30, offset: 0 };
    const runs = await harness.ctx.storage.listRuns(query);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      runId: result.runId,
      conversationId,
      status: 'completed',
      userId: principal.userId,
    });
    expect(Number.isFinite(Date.parse(runs[0]!.updatedAt))).toBe(true);
    expect(await harness.ctx.storage.listRuns({ ...query, tenantId: 'other' })).toEqual([]);
    expect(await harness.ctx.storage.listRuns({ ...query, status: 'failed' })).toEqual([]);
    expect(
      await harness.ctx.storage.listRuns({ ...query, since: '2999-01-01T00:00:00.000Z' }),
    ).toEqual([]);
    expect(await harness.ctx.storage.listRuns({ ...query, offset: 1 })).toEqual([]);
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
  it('scans published knowledge with a stable global cursor for vector rebuilds', async () => {
    const expected = await harness.ctx.storage.knowledgeChunks(demoKnowledge.id, tenant);
    const seen = new Set<string>();
    const own: string[] = [];
    let after: string | undefined;
    for (;;) {
      const page = await harness.ctx.storage.scanKnowledgeChunks!(after, 17);
      if (!page.length) break;
      expect(page.length).toBeLessThanOrEqual(17);
      for (const chunk of page) {
        expect(seen.has(chunk.id)).toBe(false);
        seen.add(chunk.id);
        if (chunk.tenantId === tenant) own.push(chunk.id);
      }
      after = page.at(-1)!.id;
    }
    expect(own.sort()).toEqual(expected.map((chunk) => chunk.id).sort());
  });
  it('deletes owned chat data atomically while keeping append-only traces and preventing late summaries', async () => {
    const conversationId = randomUUID();
    const result = await harness.ctx.agent.run({
      conversationId,
      message: 'VCD-2000 E102',
      principal,
    });
    await expect(
      harness.ctx.storage.deleteConversation(conversationId, { ...principal, userId: 'other' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const summary = {
      conversationId,
      summary: 'to be removed',
      confirmedFacts: [],
      executedActions: [],
      pendingItems: [],
      updatedAt: new Date().toISOString(),
    };
    await Promise.all([
      harness.ctx.storage.saveSummary(summary),
      harness.ctx.storage.deleteConversation(conversationId, principal),
    ]);
    expect(await harness.ctx.storage.messages(conversationId, 100)).toEqual([]);
    expect(await harness.ctx.storage.summary(conversationId)).toBeUndefined();
    await harness.ctx.storage.saveSummary(summary);
    expect(await harness.ctx.storage.summary(conversationId)).toBeUndefined();
    expect(
      (await harness.ctx.storage.listConversations(principal, 100)).some(
        (c) => c.id === conversationId,
      ),
    ).toBe(false);
    await expect(
      harness.ctx.storage.ensureConversation(conversationId, principal),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await harness.ctx.eventStore.replay(result.runId, tenant)).length).toBeGreaterThan(0);
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
  it('persists identity and sessions across connections, isolates tenants and rejects concurrent stale updates', async () => {
    const identity = new IdentityService(harness.ctx.storage.identity!, harness.ctx.cache);
    const owner = { ...principal, admin: true };
    const password = 'integration-password-123456';
    await identity.create(owner, {
      userId: owner.userId,
      displayName: 'Integration admin',
      role: 'tenant-admin',
      password,
    });
    await identity.create(
      { ...owner, tenantId: `${tenant}-other` },
      { userId: owner.userId, displayName: 'Other tenant', role: 'tenant-admin', password },
    );
    const login = await identity.login(tenant, owner.userId, password);
    const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
    try {
      const store = new PostgresIdentityStore(drizzle(pool, { schema }));
      const reconnected = new IdentityService(store, harness.ctx.cache);
      expect((await reconnected.resolve(login.token)).principal).toMatchObject({
        tenantId: tenant,
        userId: owner.userId,
        admin: true,
      });
      expect(
        (await store.members(`${tenant}-other`, undefined, 50)).map((m) => m.displayName),
      ).toEqual(['Other tenant']);
      const updates = await Promise.all([
        store.update(tenant, owner.userId, 0, { role: 'agent' }),
        store.update(tenant, owner.userId, 0, { active: false }),
      ]);
      expect(updates.filter(Boolean)).toHaveLength(1);
      await expect(reconnected.resolve(login.token)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      expect((await store.account(`${tenant}-other`, owner.userId))?.version).toBe(0);
    } finally {
      await pool.end();
    }
  });
  it('persists application ownership and isolates private knowledge in SQL and Qdrant while retaining legacy data', async () => {
    const a = applicationPrincipal(
      applicationKeySchema.parse({
        tenantId: tenant,
        applicationId: 'vcd86-a',
        knowledgeSpaceId: 'vcd86',
      }),
    );
    const b = applicationPrincipal(
      applicationKeySchema.parse({
        tenantId: tenant,
        applicationId: 'vcd86-b',
        knowledgeSpaceId: 'vcd86',
      }),
    );
    const conversationId = randomUUID();
    await harness.ctx.storage.ensureConversation(conversationId, a);
    await harness.ctx.sessions.add(conversationId, 'user', 'private device conversation');
    const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
    try {
      const { PostgresStorage } = await import('../src/plugins/storage-postgres/db.js');
      const storage = new PostgresStorage(drizzle(pool, { schema }));
      await expect(storage.assertConversation(conversationId, { ...a })).resolves.toBeUndefined();
      await expect(storage.assertConversation(conversationId, b)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        storage.deleteConversation(conversationId, { ...a, applicationId: undefined }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(
        storage.assertConversation(conversationId, { ...a, knowledgeSpaceId: 'vcd55' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      expect((await storage.listConversations(a, 100))[0]?.id).toBe(conversationId);
      expect(await storage.listConversations(b, 100)).toEqual([]);
      expect(
        (
          await pool.query('select 1 from users where tenant_id=$1 and external_id=$2', [
            tenant,
            a.userId,
          ])
        ).rowCount,
      ).toBe(0);
    } finally {
      await pool.end();
    }
    const doc = {
      id: 'shared-document-id',
      title: 'Legacy',
      content: 'E102 legacy document.',
      metadata: {},
    };
    await harness.ctx.rag.ingest(doc, tenant);
    await harness.ctx.rag.ingest(
      {
        ...doc,
        knowledgeSpaceId: 'vcd86',
        title: 'VCD86',
        content: 'E102 VCD86 private document.',
      },
      tenant,
    );
    await harness.ctx.rag.ingest(
      {
        ...doc,
        knowledgeSpaceId: 'vcd55',
        title: 'VCD55',
        content: 'E102 VCD55 private document.',
      },
      tenant,
    );
    const vector = await harness.ctx.embedding.embed('E102');
    for (const space of [undefined, 'vcd86', 'vcd55']) {
      const sql = await harness.ctx.storage.keywordSearch('E102', tenant, {}, 100, space);
      const vectors = await harness.ctx.vector.search(vector, tenant, {}, 100, undefined, space);
      const rag = await harness.ctx.rag.search({
        query: 'E102',
        tenantId: tenant,
        knowledgeSpaceId: space,
      });
      for (const documents of [sql, vectors, rag]) {
        expect(documents.length).toBeGreaterThan(0);
        expect(documents.every((d) => d.knowledgeSpaceId === space)).toBe(true);
      }
      const published = await harness.ctx.storage.knowledgeChunks(doc.id, tenant, space);
      expect(published).toHaveLength(1);
      expect(published[0]?.knowledgeSpaceId).toBe(space);
    }
  });
  it('persists online credentials and shares immediate revocation and application state across database connections', async () => {
    const owner = { ...principal, admin: true };
    const service = harness.ctx.applicationAccess;
    await service.create(owner, {
      applicationId: 'managed',
      knowledgeSpaceId: 'manuals',
      name: 'Managed application',
    });
    const issued = await service.issue(owner, {
      applicationId: 'managed',
      label: 'Integration credential',
    });
    const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
    try {
      const store = new PostgresApplicationStore(drizzle(pool, { schema }));
      const reconnected = new ApplicationAccessService(store);
      expect((await reconnected.resolve(issued.secret))?.knowledgeSpaceId).toBe('manuals');
      expect(JSON.stringify(await store.credential(credentialHash(issued.secret)))).not.toContain(
        issued.secret,
      );
      const outcomes = await Promise.all([
        store.update(tenant, 'managed', 0, false),
        store.update(tenant, 'managed', 0, false),
      ]);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
      await expect(service.resolve(issued.secret)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      await reconnected.update(owner, { applicationId: 'managed', version: 1, active: true });
      expect((await service.resolve(issued.secret))?.applicationId).toBe('managed');
      await reconnected.revoke(owner, 'managed', issued.key.id);
      await expect(service.resolve(issued.secret)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      const environmentSecret = `integration-environment-${randomUUID()}`;
      const environment = {
        [environmentSecret]: applicationKeySchema.parse({
          tenantId: tenant,
          applicationId: 'managed',
          knowledgeSpaceId: 'manuals',
        }),
      };
      await reconnected.importEnvironment(environment);
      const saved = await store.credential(credentialHash(environmentSecret));
      await reconnected.revoke(owner, 'managed', saved!.id);
      await new ApplicationAccessService(
        new PostgresApplicationStore(drizzle(pool, { schema })),
      ).importEnvironment(environment);
      await expect(service.resolve(environmentSecret)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
      const view = await service.keys(owner, 'managed');
      expect(view.keys).toHaveLength(2);
      expect(view.keys.every((key) => !!key.revokedAt)).toBe(true);
    } finally {
      await pool.end();
    }
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
