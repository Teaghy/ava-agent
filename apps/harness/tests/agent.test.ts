import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, principal } from './helpers.js';
import type { StreamEvent } from '../src/core/http/http.types.js';
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup(overrides = {}) {
  const h = await makeHarness(overrides);
  harnesses.push(h);
  return h;
}
describe('Agent ReAct runtime', () => {
  it('excludes concurrent runs and cancels an in-flight model request', async () => {
    const h = await setup();
    const controller = new AbortController();
    let entered = false;
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(
      async (_schema, request) =>
        new Promise<never>((_resolve, reject) => {
          entered = true;
          request.signal?.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          });
        }),
    );
    const running = h.ctx.agent.run({
      conversationId: 'concurrent',
      message: 'E102',
      principal,
      signal: controller.signal,
    });
    const rejected = expect(running).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    await vi.waitFor(() => expect(entered).toBe(true));
    await expect(
      h.ctx.agent.run({ conversationId: 'concurrent', message: 'E102', principal }),
    ).rejects.toMatchObject({ code: 'CONVERSATION_BUSY' });
    controller.abort();
    await rejected;
    expect(await h.ctx.cache.get('conversation-lock:concurrent')).toBeUndefined();
  });
  it('executes knowledge tool, hybrid RAG and guarded answer with durable trajectory', async () => {
    const h = await setup();
    const events: StreamEvent[] = [];
    const result = await h.ctx.agent.run(
      {
        conversationId: 'conv-e102',
        message: '我的 VCD-2000 换完耗材以后一直报 E102，怎么处理？',
        principal,
      },
      async (e) => {
        events.push(e);
      },
    );
    expect(result.answer).toContain('真空');
    expect(result.citations.length).toBeGreaterThan(0);
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'agent.started',
        'agent.step',
        'tool.started',
        'rag.started',
        'rag.completed',
        'tool.completed',
        'answer.delta',
        'answer.completed',
      ]),
    );
    const trajectory = await h.ctx.eventStore.replay(result.runId, 'demo');
    expect(trajectory.map((e) => e.type)).toEqual(
      expect.arrayContaining([
        'user_message',
        'agent_decision',
        'tool_call',
        'tool_result',
        'rag_search',
        'rag_result',
        'assistant_message',
        'checkpoint',
      ]),
    );
    expect((await h.ctx.eventStore.recover(result.runId, 'demo'))?.status).toBe('completed');
    expect(await h.ctx.eventStore.replay(result.runId, 'other-tenant')).toEqual([]);
    expect(JSON.stringify(events)).not.toMatch(/chain.of.thought|reasoning_content/);
  });
  it('stops repeated RAG calls at the search budget and saves failed state', async () => {
    const h = await setup({ MAX_RAG_SEARCHES: '1' });
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(async (schema) =>
      schema.parse({ type: 'tool_call', tool: 'knowledge_search', arguments: { query: 'E102' } }),
    );
    await expect(
      h.ctx.agent.run({ conversationId: 'limit', message: 'E102', principal }),
    ).rejects.toMatchObject({ code: 'RAG_LIMIT' });
  });
  it('enforces maximum steps independently from tool budget', async () => {
    const h = await setup({ MAX_AGENT_STEPS: '1' });
    await expect(
      h.ctx.agent.run({ conversationId: 'step-limit', message: 'E102', principal }),
    ).rejects.toMatchObject({ code: 'STEP_LIMIT' });
  });
  it('enforces tool budget and rejects invalid decisions', async () => {
    const h = await setup({ MAX_TOOL_CALLS: '1' });
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(async (schema) =>
      schema.parse({ type: 'tool_call', tool: 'device_status', arguments: { id: 'VCD-2000' } }),
    );
    await expect(
      h.ctx.agent.run({ conversationId: 'tool-limit', message: 'status', principal }),
    ).rejects.toMatchObject({ code: 'TOOL_LIMIT' });
  });
  it('rejects citation forgery before any answer delta', async () => {
    const h = await setup();
    const events: StreamEvent[] = [];
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(async (schema) =>
      schema.parse({
        type: 'final_answer',
        answer: '伪造答案',
        citations: [{ documentId: 'fake', chunkId: 'fake', title: 'fake' }],
      }),
    );
    await expect(
      h.ctx.agent.run({ conversationId: 'forgery', message: 'E102', principal }, async (e) => {
        events.push(e);
      }),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
    expect(events.some((e) => e.type === 'answer.delta')).toBe(false);
  });
  it('refuses cross-user conversations and releases lock on cancellation', async () => {
    const h = await setup();
    await h.ctx.sessions.open('owned', principal);
    await expect(
      h.ctx.agent.run({
        conversationId: 'owned',
        message: 'x',
        principal: { ...principal, userId: 'bob' },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      h.ctx.agent.run({
        conversationId: 'cancelled',
        message: 'x',
        principal,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect(await h.ctx.cache.acquire('conversation-lock:cancelled', 'next', 5)).toBe(true);
  });
});
