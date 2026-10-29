import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHarness } from '../src/bootstrap/plugins.js';
import type { HarnessOptions } from '../src/bootstrap/extensions.js';
import { loadConfig } from '../src/config/index.js';
import { AppError } from '../src/core/errors.js';
import type { AgentState } from '../src/core/agent/agent.types.js';
import { principal } from './helpers.js';

const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup(preset = 'customer-service', options: HarnessOptions = {}, seed = false) {
  const h = await createHarness(
    loadConfig({
      NODE_ENV: 'test',
      PORT: '0',
      API_KEYS: JSON.stringify({ tester: principal }),
      APP_PRESET: preset,
      SEED_KNOWLEDGE: String(seed),
    }),
    { ...options, quiet: true },
  );
  harnesses.push(h);
  return h;
}
const state: AgentState = {
  runId: 'run',
  conversationId: 'conversation',
  entities: {},
  observations: [],
  toolCalls: [],
  retrievedDocuments: [],
  step: 1,
  status: 'running',
};

describe('Application presets and response policies', () => {
  it('retains the customer-service default and rejects unknown presets before startup', async () => {
    expect(loadConfig({}).APP_PRESET).toBe('customer-service');
    expect(() => loadConfig({ APP_PRESET: 'unknown' })).toThrow();
    await expect(
      createHarness(loadConfig({ NODE_ENV: 'test' }), JSON.parse('{"preset":"unknown"}')),
    ).rejects.toMatchObject({ code: 'INVALID_APP_PRESET' });
    const h = await setup();
    expect(h.ctx.tools.get('knowledge_search')).toBeDefined();
    expect(h.ctx.tools.get('create_ticket')).toBeDefined();
  });

  it('answers free chat without retrieval, citations or seeded equipment fixtures', async () => {
    const h = await setup('chat', {}, true);
    const search = vi.spyOn(h.ctx.rag, 'search');
    const result = await h.ctx.agent.run({
      conversationId: 'free-chat',
      message: '解释一下机器学习',
      principal,
    });
    expect(result).toMatchObject({ status: 'completed', citations: [] });
    expect(result.answer).toContain('模拟聊天回复');
    expect(search).not.toHaveBeenCalled();
    expect(h.ctx.tools.list()).toEqual([]);
    expect(await h.ctx.storage.keywordSearch('E102', 'demo', {}, 10)).toEqual([]);
  });

  it('uses knowledge documents and verified citations without demo business tools', async () => {
    const h = await setup('knowledge', {}, true);
    expect(h.ctx.tools.get('knowledge_search')).toBeDefined();
    expect(h.ctx.tools.get('create_ticket')).toBeUndefined();
    expect(await h.ctx.storage.keywordSearch('E102', 'demo', {}, 10)).toEqual([]);
    await h.ctx.rag.ingest(
      { id: 'guide-v1', title: '入门指引', content: '入门时先完成账号注册。', metadata: {} },
      'demo',
    );
    const result = await h.ctx.agent.run({
      conversationId: 'knowledge',
      message: '入门指引',
      principal,
    });
    expect(result.status).toBe('completed');
    expect(result.answer).toContain('账号注册');
    expect(result.citations[0]).toMatchObject({ documentId: 'guide-v1', title: '入门指引' });
  });

  it.each([
    ['customer-service', false, false],
    ['customer-service', true, true],
    ['knowledge', false, false],
    ['knowledge', true, false],
    ['chat', false, true],
    ['chat', true, true],
  ] as const)(
    'enforces the evidence policy for %s with tool evidence %s',
    async (preset, withTool, allowed) => {
      const h = await setup(preset);
      const input = structuredClone(state);
      if (withTool) {
        input.toolCalls.push({ tool: 'lookup', arguments: {}, status: 'completed' });
        input.observations.push({ tool: 'lookup', result: { value: 'confirmed' } });
      }
      const validation = h.ctx.guard.validate('回答', [], input);
      if (allowed) await expect(validation).resolves.toBeUndefined();
      else await expect(validation).rejects.toMatchObject({ code: 'LOW_CONFIDENCE' });
    },
  );

  it('keeps citation validation and industry policies mandatory in free chat', async () => {
    const h = await setup('chat');
    await expect(
      h.ctx.guard.validate(
        '伪造引用',
        [{ documentId: 'fake', chunkId: 'fake', title: 'fake' }],
        state,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
    const retrieved = structuredClone(state);
    retrieved.retrievedDocuments.push({
      id: 'doc:1',
      documentId: 'doc',
      tenantId: 'demo',
      title: '说明',
      content: '内容',
      metadata: {},
      score: 1,
    });
    await expect(h.ctx.guard.validate('缺少引用', [], retrieved)).rejects.toMatchObject({
      code: 'CITATION_REQUIRED',
    });
    h.ctx.guard.register({
      name: 'privacy',
      validate() {
        throw new AppError('REVIEW_REQUIRED', '需要审核。', 422);
      },
    });
    await expect(
      h.ctx.agent.run({ conversationId: 'privacy', message: 'hello', principal }),
    ).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    expect((await h.ctx.sessions.recent('privacy')).some((m) => m.role === 'assistant')).toBe(
      false,
    );
  });

  it('supports custom response-policy providers without exposing authoritative state', async () => {
    const h = await setup('chat', {
      providers: {
        responsePolicy: {
          name: 'custom-response-policy',
          provide: ['responsePolicy'],
          apply(ctx) {
            ctx.provide('responsePolicy', {
              name: 'custom-review',
              validate(_answer, citations, input) {
                citations.push({ documentId: 'fake', chunkId: 'fake', title: 'fake' });
                input.entities.changed = true;
              },
            });
          },
        },
      },
    });
    const input = structuredClone(state);
    const citations: [] = [];
    await h.ctx.guard.validate('回答', citations, input);
    expect(input).toEqual(state);
    expect(citations).toEqual([]);
    expect(
      h.pluginManager.snapshot().providers.find((p) => p.slot === 'responsePolicy'),
    ).toMatchObject({ source: 'application', name: 'custom-response-policy' });
  });

  it('preserves tool authorization when the application permits ungrounded answers', async () => {
    const h = await setup('chat');
    const execute = vi.fn(async () => ({ id: 'T1' }));
    h.ctx.tools.register({
      name: 'restricted_write',
      description: 'restricted',
      permission: 'WRITE',
      inputSchema: z.object({}),
      execute,
    });
    vi.spyOn(h.ctx.decision, 'decide')
      .mockResolvedValueOnce({ type: 'tool_call', tool: 'restricted_write', arguments: {} })
      .mockResolvedValue({ type: 'ask_user', question: '需要授权人员处理。' });
    const result = await h.ctx.agent.run({
      conversationId: 'denied',
      message: '执行写入',
      principal,
    });
    expect(execute).not.toHaveBeenCalled();
    const events = await h.ctx.eventStore.replay(result.runId, 'demo');
    expect(events.find((e) => e.type === 'tool_result')?.payload).toMatchObject({
      status: 'failed',
      result: { error: { code: 'TOOL_FORBIDDEN' } },
    });
  });

  it('reports the server-selected preset and refuses client-side preset or policy overrides', async () => {
    const h = await setup('knowledge', { preset: 'chat' });
    const url = `http://127.0.0.1:${await h.start()}`;
    expect(await (await fetch(`${url}/api/v1/client-config`)).json()).toMatchObject({
      preset: 'chat',
    });
    for (const override of [{ preset: 'chat' }, { responsePolicy: 'optional' }]) {
      const response = await fetch(`${url}/api/v1/chat`, {
        method: 'POST',
        headers: { authorization: 'Bearer tester' },
        body: JSON.stringify({ conversationId: 'override', message: 'hello', ...override }),
      });
      expect(response.status).toBe(400);
    }
  });

  it.each([
    ['customer-service', '你是客服 Agent'],
    ['knowledge', '你是知识库问答助手'],
    ['chat', '你是通用对话助手'],
  ])('supplies the %s prompt to the default model decision', async (preset, role) => {
    const h = await setup(preset);
    const model = vi.spyOn(h.ctx.model, 'structuredOutput');
    await h.ctx.agent.run({ conversationId: 'prompt', message: 'hello', principal });
    const prompt = model.mock.calls[0]![1].messages[0]!.content;
    expect(prompt).toContain(role);
    expect(prompt).toContain('工具权限由服务端决定');
  });
});
