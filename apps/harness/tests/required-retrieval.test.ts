import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, principal } from './helpers.js';
import type { StreamEvent } from '../src/core/http/http.types.js';
import { AppError } from '../src/core/errors.js';

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
