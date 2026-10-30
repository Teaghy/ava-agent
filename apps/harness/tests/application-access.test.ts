import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness } from './helpers.js';
import { loadConfig } from '../src/config/index.js';
import { createHarness } from '../src/bootstrap/plugins.js';
import { InMemoryStorage } from '../src/plugins/storage-memory/index.js';
import type { Context } from 'cordis';
import { applicationKeySchema, applicationPrincipal } from '../src/core/http/application-auth.js';

const keys = {
  old: 'test-vcd86-application-key-old-000000',
  rotated: 'test-vcd86-application-key-new-000000',
  otherDevice: 'test-vcd86-second-device-key-00000000',
  v55: 'test-vcd55-application-key-0000000000',
  writer: 'test-vcd86-knowledge-writer-00000000',
  tenant: 'test-other-tenant-application-key-00',
  expired: 'test-expired-application-key-0000000',
};
const binding = { tenantId: 'company', applicationId: 'vcd86-device-a', knowledgeSpaceId: 'vcd86' };
const mappings = {
  [keys.old]: binding,
  [keys.rotated]: binding,
  [keys.otherDevice]: { ...binding, applicationId: 'vcd86-device-b' },
  [keys.v55]: { ...binding, applicationId: 'vcd55', knowledgeSpaceId: 'vcd55' },
  [keys.writer]: { ...binding, allowChat: false, manageKnowledge: true },
  [keys.tenant]: { ...binding, tenantId: 'other' },
  [keys.expired]: { ...binding, expiresAt: '2000-01-01T00:00:00Z' },
};
const owner = { tenantId: 'company', userId: 'admin', permissions: ['READ'], admin: true };
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup(local = false) {
  const h = await makeHarness({
    PORT: '0',
    SEED_KNOWLEDGE: 'false',
    LOCAL_AUTH_ENABLED: String(local),
    APPLICATION_KEYS: JSON.stringify(mappings),
    API_KEYS: JSON.stringify({ admin: owner, user: { ...owner, admin: false } }),
    OPS_ENABLED: 'true',
    OPS_PORT: '0',
    OPS_API_KEYS: JSON.stringify({ maintainer: { ...owner, managePlugins: true } }),
  });
  harnesses.push(h);
  const url = `http://127.0.0.1:${await h.start()}`;
  const get = (path: string, key: string) =>
    fetch(`${url}${path}`, { headers: { authorization: `Bearer ${key}` } });
  const post = (path: string, key: string, input: unknown) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  const chat = (key: string, conversationId: string, message = '设备 E102 如何处理？') =>
    post('/api/v1/chat', key, { conversationId, message });
  return { h, url, get, post, chat };
}

describe('application keys and caller-owned sessions', () => {
  it('shares the request limit across rotated keys without charging another device for the same knowledge library', async () => {
    const { post, chat } = await setup();
    for (let i = 0; i < 30; i++)
      expect((await post('/api/v1/chat', i % 2 ? keys.old : keys.rotated, {})).status).toBe(400);
    expect((await chat(keys.old, 'limited-old')).status).toBe(429);
    expect((await chat(keys.rotated, 'limited-new')).status).toBe(429);
    const otherDevice = await chat(keys.otherDevice, 'not-limited');
    expect(otherDevice.status).toBe(200);
    await otherDevice.text();
  });
  it('refuses an older storage provider that has not opted into application isolation', async () => {
    await expect(
      createHarness(
        loadConfig({
          APPLICATION_KEYS: JSON.stringify({ [keys.old]: binding }),
          SEED_KNOWLEDGE: 'false',
        }),
        {
          quiet: true,
          providers: {
            storage: {
              name: 'old-storage',
              provide: ['storage'],
              apply(ctx: Context) {
                const storage = new InMemoryStorage();
                Object.defineProperty(storage, 'applicationScopes', { value: false });
                ctx.provide('storage', storage);
              },
            },
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'APPLICATION_STORAGE_UNSUPPORTED' });
  });
  it('owns conversations by stable application, allowing rotation but denying other applications and tenants', async () => {
    const { h, get, post } = await setup();
    const principal = applicationPrincipal(applicationKeySchema.parse(binding));
    await h.ctx.storage.ensureConversation('caller-conversation', principal);
    await h.ctx.sessions.add('caller-conversation', 'user', '设备 A 的问题');
    expect((await get('/api/v1/conversations', keys.rotated)).status).toBe(200);
    expect(
      (await (await get('/api/v1/conversations', keys.rotated)).json()).conversations[0].id,
    ).toBe('caller-conversation');
    expect(
      (
        await post('/api/v1/conversations/history', keys.rotated, {
          conversationId: 'caller-conversation',
        })
      ).status,
    ).toBe(200);
    for (const key of [keys.otherDevice, keys.v55, keys.tenant, 'admin', 'user']) {
      expect((await (await get('/api/v1/conversations', key)).json()).conversations).toEqual([]);
      expect(
        (
          await post('/api/v1/conversations/history', key, {
            conversationId: 'caller-conversation',
          })
        ).status,
      ).toBe(403);
      expect(
        (await post('/api/v1/conversations/delete', key, { conversationId: 'caller-conversation' }))
          .status,
      ).toBe(403);
    }
    await expect(
      h.ctx.storage.ensureConversation('caller-conversation', {
        ...principal,
        knowledgeSpaceId: 'changed',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (
        await post('/api/v1/conversations/delete', keys.rotated, {
          conversationId: 'caller-conversation',
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await post('/api/v1/conversations/history', keys.old, {
          conversationId: 'caller-conversation',
        })
      ).status,
    ).toBe(404);
    expect((await get('/api/v1/conversations', keys.expired)).status).toBe(401);
  });
  it('keeps independent caller conversations separate and does not recall shared personal memory', async () => {
    const { h, chat, post } = await setup();
    const memory = vi.spyOn(h.ctx.memory, 'recall');
    const decision = vi.spyOn(h.ctx.decision, 'decide');
    expect(await (await chat(keys.old, 'alice-conversation', '张三的问题')).text()).toContain(
      'answer.completed',
    );
    expect(await (await chat(keys.rotated, 'bob-conversation', '李四的问题')).text()).toContain(
      'answer.completed',
    );
    expect(memory).not.toHaveBeenCalled();
    const histories = decision.mock.calls
      .filter(([input]) => input.message === '李四的问题')
      .map(([, context]) => JSON.stringify(context.recentMessages));
    expect(histories.length).toBeGreaterThan(0);
    expect(histories.join('')).not.toContain('张三');
    const history = await (
      await post('/api/v1/conversations/history', keys.old, {
        conversationId: 'alice-conversation',
      })
    ).json();
    expect(JSON.stringify(history)).toContain('张三');
    expect(JSON.stringify(history)).not.toContain('李四');
    expect((await chat(keys.otherDevice, 'alice-conversation')).status).toBe(403);
    expect(
      (
        await post('/api/v1/chat', keys.old, {
          conversationId: 'forged',
          message: 'hi',
          userId: 'admin',
          tenantId: 'other',
        })
      ).status,
    ).toBe(400);
    const state = [
      ...(
        h.ctx.storage as import('../src/plugins/storage-memory/index.js').InMemoryStorage
      ).runs.values(),
    ][0]!;
    expect(state.applicationId).toBe(binding.applicationId);
  });
  it('isolates knowledge spaces, permits shared libraries and binds ingestion to the credential scope', async () => {
    const { h, post } = await setup();
    const doc = {
      id: 'same-manual-id',
      title: 'VCD 8.6',
      content: 'E102 设备 8.6 专用步骤。',
      metadata: {},
    };
    expect((await post('/api/v1/knowledge', keys.old, doc)).status).toBe(403);
    expect((await post('/api/v1/knowledge', keys.writer, doc)).status).toBe(201);
    expect(
      (await post('/api/v1/knowledge', keys.writer, { ...doc, knowledgeSpaceId: 'vcd55' })).status,
    ).toBe(403);
    expect(
      (
        await post('/api/v1/knowledge', 'admin', {
          ...doc,
          knowledgeSpaceId: 'vcd55',
          title: 'VCD 5.5',
          content: 'E102 设备 5.5 专用步骤。',
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post('/api/v1/knowledge', 'admin', {
          ...doc,
          title: '旧知识库',
          content: 'E102 原有知识。',
        })
      ).status,
    ).toBe(201);
    for (const [space, title] of [
      ['vcd86', 'VCD 8.6'],
      ['vcd55', 'VCD 5.5'],
      [undefined, '旧知识库'],
    ] as const) {
      const documents = await h.ctx.rag.search({
        query: 'E102',
        tenantId: 'company',
        knowledgeSpaceId: space,
      });
      expect(documents.length).toBeGreaterThan(0);
      expect(documents.every((d) => d.title === title && d.knowledgeSpaceId === space)).toBe(true);
      expect((await h.ctx.storage.knowledgeChunks(doc.id, 'company', space))[0]!.title).toBe(title);
    }
    expect(
      await h.ctx.rag.search({ query: 'E102', tenantId: 'other', knowledgeSpaceId: 'vcd86' }),
    ).toEqual([]);
    const context = {
      principal: applicationPrincipal(applicationKeySchema.parse(mappings[keys.otherDevice])),
      state: {
        runId: crypto.randomUUID(),
        conversationId: 'tool-scope',
        entities: {},
        observations: [],
        toolCalls: [],
        retrievedDocuments: [],
        step: 1,
        status: 'running' as const,
      },
      signal: new AbortController().signal,
      emit: async () => {},
    };
    const result = (await h.ctx.tools.execute(
      'knowledge_search',
      { query: 'E102', filters: { knowledgeSpaceId: 'vcd55' } },
      context,
    )) as { documents: unknown[] };
    expect(result.documents).toEqual([]);
    const shared = (await h.ctx.tools.execute('knowledge_search', { query: 'E102' }, context)) as {
      documents: { title: string }[];
    };
    expect(shared.documents.every((d) => d.title === 'VCD 8.6')).toBe(true);
    expect(shared.documents.length).toBeGreaterThan(0);
  });
  it('does not grant account or Ops access and supports write-only knowledge credentials', async () => {
    const { h, get, post, chat } = await setup(true);
    expect((await post('/api/v1/members/list', keys.old, {})).status).toBe(403);
    expect((await get('/api/v1/auth/me', keys.old)).status).toBe(403);
    expect((await chat(keys.writer, 'writer-conversation')).status).toBe(403);
    expect((await get('/api/v1/conversations', keys.writer)).status).toBe(403);
    expect(
      (
        await fetch(`http://127.0.0.1:${h.opsPort}/api/v1/ops/access`, {
          headers: { authorization: `Bearer ${keys.old}` },
        })
      ).status,
    ).toBe(401);
    const principal = applicationPrincipal(applicationKeySchema.parse(binding));
    await h.ctx.identity.store.create({
      tenantId: principal.tenantId,
      userId: principal.userId,
      displayName: 'unrelated disabled account',
      role: 'agent',
      active: false,
      passwordHash: '',
      version: 0,
      createdAt: new Date().toISOString(),
    });
    expect((await get('/api/v1/conversations', keys.old)).status).toBe(200);
  });
  it('returns answers whose citations belong only to the application knowledge space', async () => {
    const { h, chat } = await setup();
    const doc = {
      id: 'device-manual',
      title: 'VCD 8.6 专用资料',
      content: 'VCD-2000 E102 检查密封，重新安装耗材。',
      source: 'https://example.test/vcd86',
      metadata: {},
    };
    await h.ctx.rag.ingest({ ...doc, knowledgeSpaceId: 'vcd86' }, 'company');
    await h.ctx.rag.ingest(
      { ...doc, title: 'VCD 5.5 禁止引用', knowledgeSpaceId: 'vcd55' },
      'company',
    );
    const response = await chat(keys.old, 'scoped-answer', 'VCD-2000 E102 如何排查？');
    const stream = await response.text();
    expect(stream).toContain('event: answer.completed');
    expect(stream).not.toContain('VCD 5.5 禁止引用');
    const completed = stream
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => JSON.parse(line.slice(6)))
      .find((event) => Array.isArray(event.citations));
    expect(completed.citations.length).toBeGreaterThan(0);
    const ids = (await h.ctx.storage.knowledgeChunks(doc.id, 'company', 'vcd86')).map((d) => d.id);
    expect(
      completed.citations.every((citation: { chunkId: string }) => ids.includes(citation.chunkId)),
    ).toBe(true);
  });
  it('fails closed when an external source or custom RAG provider returns knowledge outside the application space', async () => {
    const { h } = await setup();
    const document = {
      id: 'foreign-chunk',
      documentId: 'foreign-document',
      tenantId: 'company',
      knowledgeSpaceId: 'vcd55',
      title: 'Wrong device',
      content: 'E102 private content',
      metadata: {},
      score: 1,
    };
    h.ctx.knowledge.register({
      name: 'bad-source',
      description: 'scope test',
      search: async () => [document],
    });
    await expect(
      h.ctx.rag.search({
        query: 'E102',
        tenantId: 'company',
        knowledgeSpaceId: 'vcd86',
        sources: ['bad-source'],
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SCOPE' });
    vi.spyOn(h.ctx.rag, 'search').mockResolvedValue([document]);
    const state = {
      runId: crypto.randomUUID(),
      conversationId: 'custom-rag',
      entities: {},
      observations: [],
      toolCalls: [],
      retrievedDocuments: [],
      step: 1,
      status: 'running' as const,
    };
    await expect(
      h.ctx.tools.execute(
        'knowledge_search',
        { query: 'E102' },
        {
          state,
          principal: applicationPrincipal(applicationKeySchema.parse(binding)),
          signal: new AbortController().signal,
          emit: async () => {},
        },
      ),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SCOPE' });
    expect(state.retrievedDocuments).toEqual([]);
  });
  it('rejects ambiguous bindings, elevated flags and key reuse without exposing key values in validation messages', () => {
    const invalid = [
      { [keys.old]: { ...binding, admin: true } },
      { [keys.old]: binding, [keys.rotated]: { ...binding, knowledgeSpaceId: 'vcd55' } },
      { short: binding },
    ];
    for (const keys of invalid)
      expect(() => loadConfig({ APPLICATION_KEYS: JSON.stringify(keys) })).toThrow();
    expect(() =>
      loadConfig({
        APPLICATION_KEYS: JSON.stringify({ [keys.old]: binding }),
        API_KEYS: JSON.stringify({ [keys.old]: owner }),
      }),
    ).toThrow('must not reuse');
    expect(() =>
      loadConfig({
        APPLICATION_KEYS: JSON.stringify({ [keys.old]: binding }),
        OPS_API_KEYS: JSON.stringify({ [keys.old]: owner }),
      }),
    ).toThrow('must not reuse');
    expect(
      loadConfig({ APP_MODE: 'live', APPLICATION_KEYS: JSON.stringify({ [keys.old]: binding }) })
        .APPLICATION_KEYS[keys.old]?.permissions,
    ).toEqual(['READ']);
  });
});
