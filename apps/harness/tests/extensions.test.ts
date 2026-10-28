import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'cordis';
import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';
import { mainModelDecisionPlugin } from '../src/plugins/decision-main-model/index.js';
import { modelMockPlugin } from '../src/plugins/model-mock/index.js';
import { guardPlugin } from '../src/plugins/guard/index.js';
import { storageMemoryPlugin } from '../src/plugins/storage-memory/index.js';
import { cacheMemoryPlugin } from '../src/plugins/cache-memory/index.js';
import { vectorMemoryPlugin } from '../src/plugins/vector-memory/index.js';
import { MockEmbedding } from '../src/plugins/embedding-openai/index.js';
import { principal } from './helpers.js';
import type { StreamEvent } from '../src/core/http/http.types.js';
import { z } from 'zod';

const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
const config = () => loadConfig({ NODE_ENV: 'test', SEED_KNOWLEDGE: 'false' });
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup(options: Parameters<typeof createHarness>[1] = {}) {
  const h = await createHarness(config(), { quiet: true, ...options });
  harnesses.push(h);
  return h;
}
const rules = {
  name: 'custom-rules',
  provide: ['decision'],
  apply(ctx: Context) {
    ctx.provide('decision', {
      async decide() {
        return { type: 'ask_user', question: '请提供订单号。' };
      },
    });
  },
};

describe('Harness extension composition', () => {
  it('selects a custom decision before mounting the default provider', async () => {
    const h = await setup({ providers: { decision: rules } });
    expect(h.ctx.registry.has(mainModelDecisionPlugin)).toBe(false);
    const model = vi.spyOn(h.ctx.model, 'structuredOutput');
    const result = await h.ctx.agent.run({ conversationId: 'custom', message: '退款', principal });
    expect(result).toMatchObject({ status: 'ask_user', answer: '请提供订单号。' });
    expect(model).not.toHaveBeenCalled();
  });

  it('runs a rule decision with no model service mounted', async () => {
    const h = await setup({ providers: { decision: rules, model: false } });
    expect(h.ctx.get('model')).toBeUndefined();
    const result = await h.ctx.agent.run({
      conversationId: 'no-model',
      message: '退款',
      principal,
    });
    expect(result.answer).toBe('请提供订单号。');
  });

  it('rejects disabling the model while retaining the default model-based decision', async () => {
    await expect(setup({ providers: { model: false } })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER',
    });
  });

  it('allows custom live algorithms without irrelevant default-provider credentials', async () => {
    const h = await createHarness(
      loadConfig({
        NODE_ENV: 'test',
        APP_MODE: 'live',
        SEED_KNOWLEDGE: 'false',
        API_KEYS: JSON.stringify({ token: principal }),
      }),
      {
        quiet: true,
        providers: {
          model: false,
          decision: rules,
          storage: storageMemoryPlugin,
          cache: cacheMemoryPlugin,
          vector: vectorMemoryPlugin,
          embedding: {
            name: 'custom-embedding',
            provide: ['embedding'],
            apply(ctx) {
              ctx.provide('embedding', new MockEmbedding());
            },
          },
        },
      },
    );
    harnesses.push(h);
    const result = await h.ctx.agent.run({
      conversationId: 'live-rules',
      message: '退款',
      principal,
    });
    expect(result.status).toBe('ask_user');
    expect(h.ctx.get('model')).toBeUndefined();
  });

  it('fails before opening infrastructure when a default live provider has no credentials', async () => {
    await expect(async () =>
      createHarness(
        loadConfig({
          NODE_ENV: 'test',
          APP_MODE: 'live',
          API_KEYS: JSON.stringify({ token: principal }),
        }),
      ),
    ).rejects.toMatchObject({ code: 'MISSING_PROVIDER_CREDENTIALS' });
  });

  it('activates and releases an extension registration with its Cordis lifecycle', async () => {
    const orders = {
      name: 'orders',
      inject: ['tools'],
      apply(ctx: Context) {
        ctx.effect(() =>
          ctx.tools.register({
            name: 'order_lookup',
            description: '查询订单',
            permission: 'READ',
            inputSchema: z.object({ id: z.string() }).strict(),
            async execute(input) {
              return { id: input.id, status: 'shipped' };
            },
          }),
        );
      },
    };
    const h = await setup({ plugins: [orders], demoTools: false });
    const tools = h.ctx.tools;
    expect(tools.get('order_lookup')).toBeDefined();
    expect(tools.get('create_ticket')).toBeUndefined();
    for (const fiber of h.ctx.registry.get(orders)!.fibers) await fiber.dispose();
    expect(tools.get('order_lookup')).toBeUndefined();
  });

  it('rejects a provider that does not declare its selected service', async () => {
    await expect(setup({ providers: { decision: modelMockPlugin } })).rejects.toMatchObject({
      code: 'INVALID_PROVIDER',
    });
  });

  it('rejects attempts to override a managed service through the extension list', async () => {
    await expect(setup({ plugins: [rules] })).rejects.toMatchObject({
      code: 'PLUGIN_SERVICE_CONFLICT',
    });
  });

  it('bounds startup and reports a plugin waiting for a missing dependency', async () => {
    await expect(
      setup({
        startupTimeoutMs: 30,
        plugins: [
          {
            name: 'missing-dependency',
            inject: ['missing-service'],
            apply() {},
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'PLUGIN_NOT_READY' });
  });

  it('fails startup when a selected provider never publishes its declared service', async () => {
    await expect(
      setup({
        startupTimeoutMs: 30,
        providers: {
          decision: {
            name: 'broken-decision',
            provide: ['decision'],
            apply() {},
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'PLUGIN_NOT_READY' });
  });

  it('rejects an unpublished provider even when the selected algorithm does not depend on it', async () => {
    await expect(
      setup({
        providers: {
          decision: rules,
          model: { name: 'unpublished-model', provide: ['model'], apply() {} },
        },
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_NOT_READY' });
  });

  it('times out asynchronous activation and still releases acquired resources', async () => {
    let released = false;
    await expect(
      setup({
        startupTimeoutMs: 10,
        plugins: [
          {
            name: 'slow-start',
            async apply(ctx) {
              ctx.effect(() => () => {
                released = true;
              });
              await new Promise((resolve) => setTimeout(resolve, 40));
            },
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'PLUGIN_STARTUP_TIMEOUT' });
    expect(released).toBe(true);
  });

  it('releases registered effects after another extension fails to start', async () => {
    let released = false;
    await expect(
      setup({
        plugins: [
          {
            name: 'resource',
            apply(ctx) {
              ctx.effect(() => () => {
                released = true;
              });
            },
          },
          {
            name: 'broken',
            apply() {
              throw new Error('extension failed');
            },
          },
        ],
      }),
    ).rejects.toThrow('extension failed');
    expect(released).toBe(true);
  });

  it('never registers demo business tools in live mode', async () => {
    const h = await createHarness(
      loadConfig({
        NODE_ENV: 'test',
        APP_MODE: 'live',
        SEED_KNOWLEDGE: 'false',
        LLM_API_KEY: 'test',
        EMBEDDING_API_KEY: 'test',
        API_KEYS: JSON.stringify({ token: principal }),
      }),
      {
        quiet: true,
        providers: {
          storage: storageMemoryPlugin,
          cache: cacheMemoryPlugin,
          vector: vectorMemoryPlugin,
          model: modelMockPlugin,
        },
      },
    );
    harnesses.push(h);
    expect(h.ctx.tools.list().map((t) => t.name)).toEqual(['knowledge_search', 'case_search']);
  });

  it('rejects explicitly enabling demo tools in live mode before opening infrastructure', async () => {
    await expect(
      createHarness(
        loadConfig({
          NODE_ENV: 'test',
          APP_MODE: 'live',
          LLM_API_KEY: 'test',
          EMBEDDING_API_KEY: 'test',
          API_KEYS: JSON.stringify({ token: principal }),
        }),
        { demoTools: true },
      ),
    ).rejects.toMatchObject({ code: 'DEMO_TOOLS_FORBIDDEN' });
  });

  it('allows a configured system prompt without modifying bundled prompt files', async () => {
    const h = await setup({ systemPrompt: '你是订单客服。' });
    const model = vi.spyOn(h.ctx.model, 'structuredOutput');
    await h.ctx.agent.run({ conversationId: 'prompt', message: '你好', principal });
    expect(model.mock.calls[0]?.[1].messages[0]?.content).toContain('你是订单客服。');
  });
});

describe('Extension execution constraints', () => {
  it('does not expose mutable authorization descriptors to a decision algorithm', async () => {
    const h = await setup();
    vi.spyOn(h.ctx.decision, 'decide').mockImplementation(async (input) => {
      input.availableTools.find((t) => t.name === 'knowledge_search')!.permission = 'WRITE';
      return { type: 'ask_user', question: '请补充信息。' };
    });
    await h.ctx.agent.run({ conversationId: 'catalog-copy', message: '你好', principal });
    expect(h.ctx.tools.get('knowledge_search')!.permission).toBe('READ');
  });

  it('rejects citations injected into a decision context instead of retrieved by a tool', async () => {
    const h = await setup();
    vi.spyOn(h.ctx.decision, 'decide').mockImplementation(async (_input, context) => {
      context.retrievedDocuments.push({
        id: 'injected:1',
        documentId: 'injected',
        tenantId: 'demo',
        title: '伪造依据',
        content: '算法编造的内容',
        metadata: {},
        score: 1,
      });
      return {
        type: 'final_answer',
        answer: '伪造答案',
        citations: [
          {
            documentId: 'injected',
            chunkId: 'injected:1',
            title: '伪造依据',
          },
        ],
      };
    });
    await expect(
      h.ctx.agent.run({ conversationId: 'context-copy', message: '你好', principal }),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
  });

  it('deactivates the default runtime when the required guard is removed', async () => {
    const h = await setup();
    for (const fiber of h.ctx.registry.get(guardPlugin)!.fibers) await fiber.dispose();
    expect(h.ctx.get('agent')).toBeUndefined();
  });

  it('awaits an industry policy and blocks answer output before it rejects', async () => {
    const h = await setup({
      plugins: [
        {
          name: 'industry-policy',
          inject: ['guard'],
          apply(ctx) {
            ctx.effect(() =>
              ctx.guard.register({
                name: 'approval',
                async validate() {
                  await Promise.resolve();
                  throw new Error('需要人工审核');
                },
              }),
            );
          },
        },
      ],
    });
    await h.ctx.rag.ingest(
      { id: 'policy-doc', title: '退款政策', content: '退款需要审核。', metadata: {} },
      'demo',
    );
    const events: StreamEvent[] = [];
    vi.spyOn(h.ctx.decision, 'decide')
      .mockResolvedValueOnce({
        type: 'tool_call',
        tool: 'knowledge_search',
        arguments: { query: '退款' },
      })
      .mockImplementation(async (_input, context) => ({
        type: 'final_answer',
        answer: '可以退款。',
        citations: context.retrievedDocuments.map((d) => ({
          documentId: d.documentId,
          chunkId: d.id,
          title: d.title,
          source: d.source,
        })),
      }));
    await expect(
      h.ctx.agent.run({ conversationId: 'policy', message: '退款', principal }, async (e) => {
        events.push(e);
      }),
    ).rejects.toThrow('需要人工审核');
    expect(events.some((e) => e.type.startsWith('answer.'))).toBe(false);
    const messages = await h.ctx.sessions.recent('policy');
    expect(messages.some((m) => m.role === 'assistant')).toBe(false);
  });

  it('removes an industry policy with its plugin and preserves baseline validation', async () => {
    const policy = {
      name: 'deny-all',
      inject: ['guard'],
      apply(ctx: Context) {
        ctx.effect(() =>
          ctx.guard.register({
            name: 'deny',
            validate() {
              throw new Error('blocked');
            },
          }),
        );
      },
    };
    const h = await setup({ plugins: [policy] });
    const state = {
      runId: 'r',
      conversationId: 'c',
      entities: {},
      observations: [],
      toolCalls: [],
      retrievedDocuments: [
        {
          id: 'doc:1',
          documentId: 'doc',
          tenantId: 'demo',
          title: '文档',
          content: '内容',
          metadata: {},
          score: 1,
        },
      ],
      step: 1,
      status: 'running' as const,
    };
    const citations = [{ documentId: 'doc', chunkId: 'doc:1', title: '文档' }];
    await expect(h.ctx.guard.validate('内容', citations, state)).rejects.toThrow('blocked');
    for (const fiber of h.ctx.registry.get(policy)!.fibers) await fiber.dispose();
    await expect(h.ctx.guard.validate('内容', citations, state)).resolves.toBeUndefined();
    await expect(h.ctx.guard.validate('内容', [], state)).rejects.toMatchObject({
      code: 'CITATION_REQUIRED',
    });
  });

  it('keeps policy-side mutations out of the validated answer and runtime state', async () => {
    const h = await setup();
    h.ctx.guard.register({
      name: 'mutating-review',
      validate(_answer, citations, state) {
        citations.length = 0;
        state.retrievedDocuments.length = 0;
      },
    });
    const document = {
      id: 'd:1',
      documentId: 'd',
      tenantId: 'demo',
      title: '文档',
      content: '内容',
      metadata: {},
      score: 1,
    };
    const state = {
      runId: 'r',
      conversationId: 'c',
      entities: {},
      observations: [],
      toolCalls: [],
      retrievedDocuments: [document],
      step: 1,
      status: 'running' as const,
    };
    const citations = [{ documentId: 'd', chunkId: 'd:1', title: '文档' }];
    await h.ctx.guard.validate('内容', citations, state);
    expect(citations).toEqual([{ documentId: 'd', chunkId: 'd:1', title: '文档' }]);
    expect(state.retrievedDocuments).toEqual([document]);
  });

  it('counts a custom retrieval tool against the retrieval budget', async () => {
    let calls = 0;
    const h = await createHarness(loadConfig({ NODE_ENV: 'test', MAX_RAG_SEARCHES: '1' }), {
      quiet: true,
      plugins: [
        {
          name: 'custom-search',
          inject: ['tools'],
          apply(ctx) {
            ctx.effect(() =>
              ctx.tools.register({
                name: 'custom_search',
                description: '自研检索',
                permission: 'READ',
                kind: 'retrieval',
                inputSchema: z.object({}).strict(),
                async execute() {
                  calls++;
                  return { documents: [] };
                },
              }),
            );
          },
        },
      ],
    });
    harnesses.push(h);
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'tool_call',
      tool: 'custom_search',
      arguments: {},
    });
    await expect(
      h.ctx.agent.run({ conversationId: 'custom-search', message: '搜索', principal }),
    ).rejects.toMatchObject({ code: 'RAG_LIMIT' });
    expect(calls).toBe(1);
  });

  it('does not treat an empty custom retrieval result as evidence for an answer', async () => {
    let calls = 0;
    const h = await setup({
      plugins: [
        {
          name: 'empty-search',
          inject: ['tools'],
          apply(ctx) {
            ctx.effect(() =>
              ctx.tools.register({
                name: 'empty_search',
                description: '检索',
                permission: 'READ',
                kind: 'retrieval',
                inputSchema: z.object({}).strict(),
                async execute() {
                  calls++;
                  return { documents: [] };
                },
              }),
            );
          },
        },
      ],
    });
    vi.spyOn(h.ctx.decision, 'decide')
      .mockResolvedValueOnce({ type: 'tool_call', tool: 'empty_search', arguments: {} })
      .mockResolvedValueOnce({ type: 'final_answer', answer: '没有证据的答案' });
    await expect(
      h.ctx.agent.run({ conversationId: 'empty-search', message: '搜索', principal }),
    ).rejects.toMatchObject({ code: 'LOW_CONFIDENCE' });
    expect(calls).toBe(1);
  });

  it('cancels a running decision and releases its lock before stop resolves', async () => {
    const h = await setup();
    const cache = h.ctx.cache;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(h.ctx.decision, 'decide').mockImplementation(async (_input, context) => {
      started();
      return new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true,
        });
      });
    });
    const result = h.ctx.agent.run({ conversationId: 'stopping', message: '退款', principal });
    const rejected = expect(result).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    await ready;
    await h.stop();
    await rejected;
    expect(await cache.acquire('conversation-lock:stopping', 'next', 5)).toBe(true);
  });
});
