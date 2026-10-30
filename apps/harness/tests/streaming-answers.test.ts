import { streamEventSchema } from '@ava/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, principal } from './helpers.js';
import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';
import { AppError } from '../src/core/errors.js';
import type { StreamEvent } from '../src/core/http/http.types.js';

const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(preset = 'chat') {
  const h = await createHarness(
    loadConfig({
      NODE_ENV: 'test',
      PORT: '0',
      API_KEYS: JSON.stringify({ 'stream-token': principal }),
      APP_PRESET: preset,
      SEED_KNOWLEDGE: 'false',
    }),
    { quiet: true, demoTools: false },
  );
  harnesses.push(h);
  vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({ type: 'answer_ready', citations: [] });
  return h;
}

describe('Final answer generation and delivery', () => {
  it('flushes answer deltas over HTTP while the provider is still generating', async () => {
    const h = await setup();
    const finish = deferred();
    vi.spyOn(h.ctx.model, 'stream').mockImplementation(async function* () {
      yield { text: 'first-visible-text' };
      await finish.promise;
      yield { text: 'last-visible-text' };
    });
    const port = await h.start();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chat`, {
      method: 'POST',
      headers: { authorization: 'Bearer stream-token', 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'http-live', message: 'hello' }),
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    try {
      while (!text.includes('first-visible-text')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
      }
      expect(text).toContain('event: answer.delta');
      expect(text).not.toContain('event: answer.completed');
    } finally {
      finish.resolve();
    }
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    expect(text).toContain('last-visible-text');
    expect(text).toContain('event: answer.completed');
  });

  it('runs wording-dependent industry checks against the completed answer rather than a placeholder', async () => {
    const h = await setup();
    h.ctx.guard.register({
      name: 'required-wording',
      validate(text) {
        if (!text.includes('审核用语')) throw new AppError('REVIEW_REQUIRED', '缺少审核用语', 422);
      },
    });
    vi.spyOn(h.ctx.model, 'stream').mockImplementation(async function* () {
      yield { text: '审核用语：请以官方政策为准。' };
    });
    const result = await h.ctx.agent.run({
      conversationId: 'mandatory-wording',
      message: 'hello',
      principal,
    });
    expect(result.answer).toContain('审核用语');
  });

  it('buffers answers after a business tool has run', async () => {
    const h = await setup();
    const produced = deferred(),
      finish = deferred();
    const events: StreamEvent[] = [];
    const { z } = await import('zod');
    h.ctx.tools.register({
      name: 'order_lookup',
      description: '查询订单',
      permission: 'READ',
      inputSchema: z.object({}),
      async execute() {
        return { status: 'shipped' };
      },
    });
    vi.spyOn(h.ctx.decision, 'decide')
      .mockResolvedValueOnce({ type: 'tool_call', tool: 'order_lookup', arguments: {} })
      .mockResolvedValue({ type: 'answer_ready', citations: [] });
    vi.spyOn(h.ctx.model, 'stream').mockImplementation(async function* () {
      yield { text: '订单' };
      produced.resolve();
      await finish.promise;
      yield { text: '已发货' };
    });
    const running = h.ctx.agent.run(
      { conversationId: 'business-buffer', message: 'hello', principal },
      async (event) => {
        events.push(event);
      },
    );
    await produced.promise;
    expect(events.some((e) => e.type === 'answer.delta')).toBe(false);
    finish.resolve();
    expect((await running).answer).toBe('订单已发货');
  });

  it('delivers the first model delta before generation completes and saves exactly one final answer', async () => {
    const h = await setup();
    const first = deferred(),
      finish = deferred();
    const events: StreamEvent[] = [];
    vi.spyOn(h.ctx.model, 'stream').mockImplementation(async function* () {
      yield { text: '第一段' };
      await finish.promise;
      yield { text: '，第二段。' };
    });
    const running = h.ctx.agent.run(
      { conversationId: 'live', message: 'hello', principal },
      async (event) => {
        events.push(event);
        if (event.type === 'answer.delta') first.resolve();
      },
    );
    await first.promise;
    expect(events.some((e) => e.type === 'answer.completed')).toBe(false);
    expect((await h.ctx.sessions.recent('live')).some((m) => m.role === 'assistant')).toBe(false);
    finish.resolve();
    const result = await running;
    expect(result.answer).toBe('第一段，第二段。');
    expect(
      events
        .filter((e) => e.type === 'answer.delta')
        .map((e) => {
          const parsed = streamEventSchema.parse(e);
          return parsed.type === 'answer.delta' ? parsed.data.text : '';
        })
        .join(''),
    ).toBe(result.answer);
    expect(
      (await h.ctx.sessions.recent('live')).filter((m) => m.role === 'assistant'),
    ).toHaveLength(1);
    const trace = await h.ctx.eventStore.replay(result.runId, 'demo');
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'execution_span',
        payload: expect.objectContaining({ phase: 'answer', delivery: 'stream' }),
      }),
    );
  });

  it('buffers replies protected by an industry policy and releases nothing when it rejects', async () => {
    const h = await setup();
    const producing = deferred(),
      finish = deferred();
    h.ctx.guard.register({
      name: 'review',
      validate(text) {
        if (text.includes('禁止')) throw new AppError('REVIEW_REQUIRED', '需要审核', 422);
      },
    });
    vi.spyOn(h.ctx.model, 'stream').mockImplementation(async function* () {
      yield { text: '禁止' };
      producing.resolve();
      await finish.promise;
      yield { text: '发布' };
    });
    const events: StreamEvent[] = [];
    const running = h.ctx.agent.run(
      { conversationId: 'review', message: 'hello', principal },
      async (e) => {
        events.push(e);
      },
    );
    const rejected = expect(running).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    await producing.promise;
    expect(events.some((e) => e.type === 'answer.delta')).toBe(false);
    finish.resolve();
    await rejected;
    expect(events.some((e) => e.type === 'answer.completed')).toBe(false);
    expect((await h.ctx.sessions.recent('review')).some((m) => m.role === 'assistant')).toBe(false);
  });

  it('does not generate text when citation or evidence preflight fails', async () => {
    const h = await setup('customer-service');
    const stream = vi.spyOn(h.ctx.model, 'stream');
    const result = await h.ctx.agent.run({ conversationId: 'scope', message: 'hello', principal });
    expect(result.status).toBe('ask_user');
    expect(result.answer).toContain('服务范围');
    expect(stream).not.toHaveBeenCalled();
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'answer_ready',
      citations: [{ documentId: 'fake', chunkId: 'fake', title: 'fake' }],
    });
    await expect(
      h.ctx.agent.run({ conversationId: 'bad-reference', message: 'hello', principal }),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
    expect(stream).not.toHaveBeenCalled();
  });

  it('marks a partially delivered stream failed without storing it as a successful answer', async () => {
    const h = await setup();
    const events: StreamEvent[] = [];
    vi.spyOn(h.ctx.model, 'stream').mockImplementation(async function* () {
      yield { text: '尚未完成的内容' };
      throw new AppError('MODEL_STREAM_INCOMPLETE', '连接中断', 502);
    });
    await expect(
      h.ctx.agent.run({ conversationId: 'broken', message: 'hello', principal }, async (e) => {
        events.push(e);
      }),
    ).rejects.toMatchObject({ code: 'MODEL_STREAM_INCOMPLETE' });
    expect(events.filter((e) => e.type === 'answer.delta')).toHaveLength(1);
    expect(events.some((e) => e.type === 'answer.completed')).toBe(false);
    const started = events.find((e) => e.type === 'agent.started');
    if (started?.type !== 'agent.started') throw new Error('Missing start');
    const trace = await h.ctx.eventStore.replay(
      streamEventSchema.options[0].parse(started).data.runId,
      'demo',
    );
    expect(trace).toContainEqual(
      expect.objectContaining({
        type: 'error',
        payload: expect.objectContaining({ phase: 'answer', partialAnswer: true }),
      }),
    );
    expect((await h.ctx.sessions.recent('broken')).some((m) => m.role === 'assistant')).toBe(false);
    expect(await h.ctx.cache.acquire('conversation-lock:broken', 'next', 5)).toBe(true);
  });

  it('cancels upstream generation and never reports a partial answer as complete', async () => {
    const h = await setup();
    const controller = new AbortController();
    const events: StreamEvent[] = [];
    vi.spyOn(h.ctx.model, 'stream').mockImplementation(async function* () {
      yield { text: '第一段' };
      yield { text: '不应显示' };
    });
    await expect(
      h.ctx.agent.run(
        { conversationId: 'cancel-stream', message: 'hello', principal, signal: controller.signal },
        async (e) => {
          events.push(e);
          if (e.type === 'answer.delta') controller.abort();
        },
      ),
    ).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    expect(events.filter((e) => e.type === 'answer.delta')).toHaveLength(1);
    expect(events.some((e) => e.type === 'answer.completed')).toBe(false);
  });
});
