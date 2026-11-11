import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, principal } from './helpers.js';
import type { StreamEvent } from '../src/core/http/http.types.js';
import { AppError } from '../src/core/errors.js';
import { MainModelDecisionService } from '../src/plugins/decision-main-model/main-model-decision.service.js';

const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup(overrides = {}) {
  const h = await makeHarness({ SEED_KNOWLEDGE: 'false', ...overrides });
  harnesses.push(h);
  return h;
}
describe('Required retrieval before terminal knowledge replies', () => {
  it('does not replay a successful business tool or substitute retrieval for its invalid citation', async () => {
    const h = await setup();
    vi.spyOn(h.ctx.decision, 'decide')
      .mockResolvedValueOnce({
        type: 'tool_call',
        tool: 'device_status',
        arguments: { id: 'VCD-2000' },
      })
      .mockRejectedValueOnce(new AppError('INVALID_CITATION', '答案引用无法验证。', 422));
    const execute = vi.spyOn(h.ctx.tools, 'execute');
    const search = vi.spyOn(h.ctx.rag, 'search');
    await expect(
      h.ctx.agent.run({ conversationId: 'business-citation', message: '设备状态', principal }),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
  });
  it('honors cancellation before recovering a rejected citation', async () => {
    const h = await setup();
    const controller = new AbortController();
    vi.spyOn(h.ctx.decision, 'decide').mockImplementation(async () => {
      controller.abort();
      throw new AppError('INVALID_CITATION', '答案引用无法验证。', 422);
    });
    const execute = vi.spyOn(h.ctx.tools, 'execute');
    await expect(
      h.ctx.agent.run({
        conversationId: 'cancelled-citation',
        message: '保修',
        principal,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(['final_answer', 'answer_ready'] as const)(
    'recovers a premature %s rejected by citation hydration before the terminal gate',
    async (type) => {
      const h = await setup({ APP_PRESET: 'knowledge' });
      await h.ctx.rag.ingest(
        { id: 'guide', title: '保修规则', content: '产品保修期为两年。', metadata: {} },
        'demo',
      );
      const search = vi.spyOn(h.ctx.rag, 'search');
      const service = new MainModelDecisionService(h.ctx.model, h.ctx.telemetry, {
        systemPrompt: '客服',
        contextTokens: 12000,
        streamAnswers: type === 'answer_ready',
      });
      vi.spyOn(h.ctx.decision, 'decide').mockImplementationOnce((input, context) =>
        service.decide(input, context),
      );
      const model = vi
        .spyOn(h.ctx.model, 'structuredOutput')
        .mockImplementationOnce(async (schema) =>
          schema.parse({
            type,
            ...(type === 'final_answer' ? { answer: '不应输出的无依据回答' } : {}),
            citations: [{ documentId: 'made-up-document', chunkId: 'made-up-chunk' }],
          }),
        );
      const emitted: StreamEvent[] = [];
      const result = await h.ctx.agent.run(
        { conversationId: `premature-citation-${type}`, message: '保修期多久', principal },
        async (event) => {
          emitted.push(event);
        },
      );
      expect(search).toHaveBeenCalledTimes(1);
      expect(model).toHaveBeenCalledTimes(2);
      expect(result.answer).toContain('两年');
      expect(result.answer).not.toContain('不应输出');
      expect(result.citations).toMatchObject([{ documentId: 'guide', title: '保修规则' }]);
      const trace = await h.ctx.eventStore.replay(result.runId, 'demo');
      expect(trace.find((event) => event.type === 'agent_decision')?.payload).toMatchObject({
        type: 'tool_call',
        tool: 'knowledge_search',
        step: 1,
        routing: {
          reason: 'knowledge_search_required',
          rejectedDecision: { code: 'INVALID_CITATION' },
        },
      });
      expect(trace.some((event) => event.type === 'error')).toBe(false);
      expect(JSON.stringify(trace)).not.toMatch(/made-up-document|made-up-chunk|不应输出/);
      expect(emitted.findIndex((event) => event.type === 'rag.completed')).toBeLessThan(
        emitted.findIndex((event) => event.type === 'answer.delta'),
      );
      expect((await h.ctx.eventStore.recover(result.runId, 'demo'))?.step).toBe(2);
    },
  );
  it('still rejects invalid citations after successful relevant retrieval', async () => {
    const h = await setup();
    await h.ctx.rag.ingest(
      { id: 'guide', title: '保修规则', content: '保修两年', metadata: {} },
      'demo',
    );
    const search = vi.spyOn(h.ctx.rag, 'search');
    const model = vi.spyOn(h.ctx.model, 'structuredOutput');
    model.mockImplementationOnce(async (schema) =>
      schema.parse({ type: 'tool_call', tool: 'knowledge_search', arguments: { query: '保修' } }),
    );
    model.mockImplementationOnce(async (schema) =>
      schema.parse({
        type: 'final_answer',
        answer: '伪造回答',
        citations: [{ documentId: 'foreign', chunkId: 'foreign-chunk' }],
      }),
    );
    const emitted: StreamEvent[] = [];
    await expect(
      h.ctx.agent.run(
        { conversationId: 'after-retrieval', message: '保修', principal },
        async (event) => {
          emitted.push(event);
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
    expect(search).toHaveBeenCalledTimes(1);
    expect(model).toHaveBeenCalledTimes(2);
    expect(emitted.some((event) => event.type.startsWith('answer.'))).toBe(false);
  });
  it('does not repeat failed retrieval when citation hydration also fails on the next decision', async () => {
    const h = await setup();
    const search = vi
      .spyOn(h.ctx.rag, 'search')
      .mockRejectedValue(new AppError('RETRIEVAL_UNAVAILABLE', '检索不可用', 503));
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(async (schema) =>
      schema.parse({
        type: 'final_answer',
        answer: '伪造回答',
        citations: [{ documentId: 'foreign', chunkId: 'foreign-chunk' }],
      }),
    );
    const emitted: StreamEvent[] = [];
    await expect(
      h.ctx.agent.run(
        { conversationId: 'failed-retrieval-citation', message: '保修', principal },
        async (event) => {
          emitted.push(event);
        },
      ),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SEARCH_FAILED' });
    expect(search).toHaveBeenCalledTimes(1);
    expect(emitted.some((event) => event.type.startsWith('answer.'))).toBe(false);
  });
  it('retains permissions, step budgets and free-chat behavior for citation rejection recovery', async () => {
    const h = await setup({ MAX_AGENT_STEPS: '1' });
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(async (schema) =>
      schema.parse({
        type: 'final_answer',
        answer: '伪造回答',
        citations: [{ documentId: 'foreign', chunkId: 'foreign-chunk' }],
      }),
    );
    const search = vi.spyOn(h.ctx.rag, 'search');
    await expect(
      h.ctx.agent.run({
        conversationId: 'citation-denied',
        message: '保修',
        principal: { ...principal, permissions: [] },
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SEARCH_REQUIRED' });
    expect(search).not.toHaveBeenCalled();
    await expect(
      h.ctx.agent.run({ conversationId: 'citation-budget', message: '保修', principal }),
    ).rejects.toMatchObject({ code: 'STEP_LIMIT' });
    expect(search).toHaveBeenCalledTimes(1);
    const [run] = await h.ctx.storage.listRuns({
      tenantId: 'demo',
      conversationId: 'citation-budget',
      limit: 1,
      offset: 0,
    });
    expect(run?.step).toBe(1);
    const chat = await setup({ APP_PRESET: 'chat' });
    vi.spyOn(chat.ctx.decision, 'decide').mockRejectedValue(
      new AppError('INVALID_CITATION', '答案引用无法验证。', 422),
    );
    const chatSearch = vi.spyOn(chat.ctx.rag, 'search');
    await expect(
      chat.ctx.agent.run({ conversationId: 'chat-citation', message: '你好', principal }),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
    expect(chatSearch).not.toHaveBeenCalled();
  });
  it.each(['ask_user', 'final_answer', 'answer_ready'] as const)(
    'routes a premature %s through a real audited knowledge search',
    async (type) => {
      const h = await setup({ APP_PRESET: 'knowledge' });
      await h.ctx.rag.ingest(
        { id: 'guide', title: '保修规则', content: '产品保修期为两年。', metadata: {} },
        'demo',
      );
      const search = vi.spyOn(h.ctx.rag, 'search');
      const decide = vi.spyOn(h.ctx.decision, 'decide');
      decide.mockResolvedValueOnce(
        type === 'ask_user'
          ? { type, question: '知识库里没有相关信息。' }
          : type === 'final_answer'
            ? { type, answer: '知识库里没有相关信息。' }
            : { type },
      );
      const emitted: StreamEvent[] = [];
      const result = await h.ctx.agent.run(
        { conversationId: type, message: '产品保修期多久', principal },
        async (event) => {
          emitted.push(event);
        },
      );
      expect(result.answer).toContain('两年');
      expect(result.answer).not.toContain('没有相关信息');
      expect(result.citations[0]?.documentId).toBe('guide');
      expect(search).toHaveBeenCalledTimes(1);
      const trace = await h.ctx.eventStore.replay(result.runId, 'demo');
      expect(trace.find((event) => event.type === 'agent_decision')?.payload).toMatchObject({
        type: 'tool_call',
        tool: 'knowledge_search',
        step: 1,
        routing: { reason: 'knowledge_search_required', proposedDecision: { type } },
      });
      expect(trace.map((event) => event.type)).toEqual(
        expect.arrayContaining(['tool_call', 'rag_search', 'rag_result', 'tool_result']),
      );
      expect(emitted.findIndex((event) => event.type === 'rag.completed')).toBeLessThan(
        emitted.findIndex((event) => event.type === 'answer.delta'),
      );
    },
  );
  it('allows an insufficient-evidence reply only after a successful empty retrieval', async () => {
    const h = await setup();
    vi.spyOn(h.ctx.rag, 'search').mockResolvedValue([]);
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '本次检索未找到依据，请提供产品型号。',
    });
    const result = await h.ctx.agent.run({
      conversationId: 'empty',
      message: '未知产品',
      principal,
    });
    const trace = await h.ctx.eventStore.replay(result.runId, 'demo');
    expect(result.status).toBe('ask_user');
    expect(trace.find((event) => event.type === 'tool_result')?.payload).toMatchObject({
      status: 'completed',
      result: { documents: [] },
    });
  });
  it('never describes failed retrieval as a successful miss and does not retry the failed tool', async () => {
    const h = await setup();
    const search = vi
      .spyOn(h.ctx.rag, 'search')
      .mockRejectedValue(new AppError('RETRIEVAL_UNAVAILABLE', '检索不可用。', 503));
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '知识库里没有。',
    });
    const events: StreamEvent[] = [];
    await expect(
      h.ctx.agent.run(
        { conversationId: 'failed-search', message: '保修', principal },
        async (event) => {
          events.push(event);
        },
      ),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SEARCH_FAILED' });
    expect(search).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type.startsWith('answer.'))).toBe(false);
    expect(
      (await h.ctx.sessions.recent('failed-search')).some(
        (message) => message.role === 'assistant',
      ),
    ).toBe(false);
  });
  it('retains tool permissions and step budgets when enforcing retrieval', async () => {
    const h = await setup({ MAX_AGENT_STEPS: '1' });
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '知识库里没有。',
    });
    await expect(
      h.ctx.agent.run({
        conversationId: 'no-read',
        message: '保修',
        principal: { ...principal, permissions: [] },
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_SEARCH_REQUIRED' });
    await expect(
      h.ctx.agent.run({ conversationId: 'budget', message: '保修', principal }),
    ).rejects.toMatchObject({ code: 'STEP_LIMIT' });
    const [run] = await h.ctx.storage.listRuns({
      tenantId: 'demo',
      conversationId: 'budget',
      limit: 1,
      offset: 0,
    });
    expect(run?.step).toBe(1);
  });
  it('keeps free chat free of forced searches', async () => {
    const h = await setup({ APP_PRESET: 'chat' });
    const search = vi.spyOn(h.ctx.rag, 'search');
    await h.ctx.agent.run({ conversationId: 'chat', message: '你好', principal });
    expect(search).not.toHaveBeenCalled();
  });
});
