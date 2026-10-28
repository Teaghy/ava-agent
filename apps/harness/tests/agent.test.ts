import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, principal } from './helpers.js';
import type { StreamEvent } from '../src/core/http/http.types.js';
import { z } from 'zod';
import { AppError } from '../src/core/errors.js';
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
  it('applies industry policies to questions before persistence and streaming', async () => {
    const h = await setup({ SEED_KNOWLEDGE: 'false' });
    const review = vi.fn(async () => {
      throw new AppError('REVIEW_REQUIRED', '需要人工审核。', 422);
    });
    h.ctx.guard.register({ name: 'question-review', validate: review });
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '保证退款，请确认账号。',
    });
    const events: StreamEvent[] = [];
    await expect(
      h.ctx.agent.run(
        { conversationId: 'question-policy', message: 'hello', principal },
        async (event) => {
          events.push(event);
        },
      ),
    ).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    expect(review).toHaveBeenCalledTimes(1);
    expect(events.some((event) => event.type.startsWith('answer.'))).toBe(false);
    expect(
      (await h.ctx.sessions.recent('question-policy')).some((m) => m.role === 'assistant'),
    ).toBe(false);
  });

  it('blocks unexecuted business claims even when they are returned as a question', async () => {
    const h = await setup({ SEED_KNOWLEDGE: 'false' });
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '工单已创建，编号 T1',
    });
    await expect(
      h.ctx.agent.run({ conversationId: 'question-claim', message: 'hello', principal }),
    ).rejects.toMatchObject({ code: 'TOOL_INCONSISTENT' });
  });

  it('allows genuine questions without evidence, including after retrieval', async () => {
    const h = await setup();
    const review = vi.fn();
    h.ctx.guard.register({ name: 'question-review', validate: review });
    const decide = vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '请确认设备型号。',
    });
    expect(
      (await h.ctx.agent.run({ conversationId: 'plain-question', message: 'hello', principal }))
        .status,
    ).toBe('ask_user');
    decide.mockResolvedValueOnce({
      type: 'tool_call',
      tool: 'knowledge_search',
      arguments: { query: 'E102' },
    });
    const result = await h.ctx.agent.run({
      conversationId: 'retrieval-question',
      message: 'E102',
      principal,
    });
    expect(result).toMatchObject({ status: 'ask_user', citations: [] });
    expect(review).toHaveBeenCalledTimes(2);
    expect(review.mock.calls.map((call) => call[4])).toEqual(['ask_user', 'ask_user']);
  });

  it('keeps a completed answer successful when optional summary storage fails', async () => {
    const h = await setup({ SEED_KNOWLEDGE: 'false' });
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '请提供订单号。',
    });
    vi.spyOn(h.ctx.sessions, 'summarize').mockRejectedValue(new Error('private summary failure'));
    const log = vi.spyOn(h.ctx.telemetry, 'log');
    const events: StreamEvent[] = [];
    const result = await h.ctx.agent.run(
      { conversationId: 'summary-failure', message: 'hello', principal },
      async (event) => {
        events.push(event);
      },
    );
    expect(result.status).toBe('ask_user');
    expect(events.at(-1)).toMatchObject({ type: 'answer.completed', data: result });
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'summary.failed', run_id: result.runId }),
        expect.any(String),
      ),
    );
    expect((await h.ctx.eventStore.recover(result.runId, principal.tenantId))?.status).toBe(
      'completed',
    );
    expect(
      (await h.ctx.eventStore.replay(result.runId, principal.tenantId)).some(
        (event) => event.type === 'error',
      ),
    ).toBe(false);
    expect(
      (await h.ctx.sessions.recent('summary-failure')).filter((m) => m.role === 'assistant'),
    ).toHaveLength(1);
  });

  it('does not delay answers or hold the conversation lock for background summaries', async () => {
    const h = await setup({ SEED_KNOWLEDGE: 'false' });
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '请提供订单号。',
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let summarySignal: AbortSignal | undefined;
    const summarize = vi
      .spyOn(h.ctx.sessions, 'summarize')
      .mockImplementationOnce(async (_id, signal) => {
        summarySignal = signal;
        await waiting;
      })
      .mockResolvedValue(undefined);
    let answered = false;
    const first = h.ctx.agent
      .run({ conversationId: 'slow-summary', message: 'hello', principal })
      .then((result) => {
        answered = true;
        return result;
      });
    try {
      await vi.waitFor(() => expect(summarize).toHaveBeenCalledTimes(1));
      await vi.waitFor(() => expect(answered).toBe(true), { timeout: 500 });
      expect(await h.ctx.cache.get('conversation-lock:slow-summary')).toBeUndefined();
      const second = await h.ctx.agent.run({
        conversationId: 'slow-summary',
        message: 'again',
        principal,
      });
      expect(second.status).toBe('ask_user');
      expect(summarize).toHaveBeenCalledTimes(1);
      release();
      await vi.waitFor(() => expect(summarize).toHaveBeenCalledTimes(2));
      await h.stop();
      expect(summarySignal?.aborted).toBe(true);
    } finally {
      release();
      await first;
    }
  });

  it.each([false, true])(
    'stops after an audit failure without retrying even if cancelled: %s',
    async (cancelled) => {
      const h = await setup({ SEED_KNOWLEDGE: 'false' });
      const execute = vi.fn(async () => ({ ticketId: 'T1' }));
      h.ctx.tools.register({
        name: 'submit_ticket',
        description: 'create a ticket',
        permission: 'WRITE',
        inputSchema: z.object({}),
        execute,
      });
      const controller = new AbortController();
      vi.spyOn(h.ctx.storage, 'audit').mockImplementation(async () => {
        if (cancelled) controller.abort();
        throw new Error('private audit failure');
      });
      const decide = vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
        type: 'tool_call',
        tool: 'submit_ticket',
        arguments: {},
      });
      let runId = '';
      const events: StreamEvent[] = [];
      await expect(
        h.ctx.agent.run(
          {
            conversationId: 'audit-failure',
            message: 'submit',
            signal: controller.signal,
            principal: { ...principal, permissions: ['READ', 'WRITE'] },
          },
          async (event) => {
            events.push(event);
            if (event.type === 'agent.started') runId = (event.data as { runId: string }).runId;
          },
        ),
      ).rejects.toMatchObject({ code: 'TOOL_AUDIT_FAILED', status: 503 });
      expect(execute).toHaveBeenCalledTimes(1);
      expect(decide).toHaveBeenCalledTimes(1);
      expect(events.some((event) => event.type.startsWith('answer.'))).toBe(false);
      const checkpoint = await h.ctx.eventStore.recover(runId, principal.tenantId);
      expect(checkpoint).toMatchObject({
        status: 'failed',
        toolCalls: [{ tool: 'submit_ticket', status: 'completed' }],
        observations: [{ tool: 'submit_ticket', result: { ticketId: 'T1' } }],
      });
      expect(await h.ctx.cache.get('conversation-lock:audit-failure')).toBeUndefined();
    },
  );

  it('cancels background summary work and waits for its cleanup before stopping', async () => {
    const h = await setup({ SEED_KNOWLEDGE: 'false' });
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '请提供订单号。',
    });
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    const summarize = vi
      .spyOn(h.ctx.sessions, 'summarize')
      .mockImplementation(async (_id, summarySignal) => {
        signal = summarySignal;
        await waiting;
      });
    await h.ctx.agent.run({ conversationId: 'stop-summary', message: 'hello', principal });
    await vi.waitFor(() => expect(summarize).toHaveBeenCalledTimes(1));
    let stopped = false;
    const stopping = h.stop().then(() => {
      stopped = true;
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(signal?.aborted).toBe(true);
      expect(stopped).toBe(false);
    } finally {
      release();
      await stopping;
    }
  });

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
