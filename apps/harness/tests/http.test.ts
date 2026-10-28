import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness } from './helpers.js';
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup(keys?: string) {
  const h = await makeHarness({ PORT: '0', ...(keys ? { API_KEYS: keys } : {}) });
  harnesses.push(h);
  return { h, url: `http://127.0.0.1:${await h.start()}` };
}
describe('H3 chat transport', () => {
  it('finishes the response successfully even if optional summary storage fails', async () => {
    const { h, url } = await setup();
    vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'ask_user',
      question: '请提供订单号。',
    });
    vi.spyOn(h.ctx.sessions, 'summarize').mockRejectedValue(new Error('private summary failure'));
    const response = await fetch(`${url}/api/v1/chat`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'http-summary-failure', message: 'hello' }),
    });
    const body = await response.text();
    expect(body).toContain('event: answer.completed');
    expect(body).not.toContain('event: error');
    expect(body).not.toContain('private summary failure');
    expect(
      (await h.ctx.sessions.recent('http-summary-failure')).filter((m) => m.role === 'assistant'),
    ).toHaveLength(1);
  });

  it('reports audit failure through SSE without repeating the action or exposing private details', async () => {
    const { h, url } = await setup(
      JSON.stringify({ writer: { tenantId: 't', userId: 'u', permissions: ['READ', 'WRITE'] } }),
    );
    vi.spyOn(h.ctx.storage, 'audit').mockRejectedValue(new Error('private audit failure'));
    const execute = vi.spyOn(h.ctx.tools, 'execute');
    const decide = vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'tool_call',
      tool: 'create_ticket',
      arguments: { description: '请创建新的工单。' },
    });
    const response = await fetch(`${url}/api/v1/chat`, {
      method: 'POST',
      headers: { authorization: 'Bearer writer' },
      body: JSON.stringify({ conversationId: 'http-audit-failure', message: 'submit' }),
    });
    const body = await response.text();
    expect(body).toContain('event: error');
    expect(body).toContain('TOOL_AUDIT_FAILED');
    expect(body).not.toContain('private audit failure');
    expect(body).not.toContain('event: answer.completed');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(decide).toHaveBeenCalledTimes(1);
  });

  it('returns safe SSE errors and rejects oversized bodies', async () => {
    const { h, url } = await setup();
    vi.spyOn(h.ctx.model, 'structuredOutput').mockRejectedValue(
      new Error('secret-provider-detail'),
    );
    const response = await fetch(`${url}/api/v1/chat`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'safe-error', message: 'E102' }),
    });
    const body = await response.text();
    expect(body).toContain('event: error');
    expect(body).not.toContain('secret-provider-detail');
    const large = await fetch(`${url}/api/v1/chat`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'large', message: 'x'.repeat(70000) }),
    });
    expect(large.status).toBe(413);
  });
  it('propagates browser disconnect to the in-flight Agent and releases its lock', async () => {
    const { h, url } = await setup();
    const controller = new AbortController();
    let cancelled = false;
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(
      async (_schema, request) =>
        new Promise<never>((_resolve, reject) => {
          request.signal?.addEventListener(
            'abort',
            () => {
              cancelled = true;
              reject(new Error('disconnect'));
            },
            { once: true },
          );
        }),
    );
    const response = await fetch(`${url}/api/v1/chat`, {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({ conversationId: 'disconnect', message: 'E102' }),
    });
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => {});
    await vi.waitFor(async () => {
      expect(cancelled).toBe(true);
      expect(await h.ctx.cache.get('conversation-lock:disconnect')).toBeUndefined();
    });
  });
  it('serves health and complete SSE event sequence with citations', async () => {
    const { url } = await setup();
    expect((await fetch(`${url}/health`)).status).toBe(200);
    const response = await fetch(`${url}/api/v1/chat`, {
      method: 'POST',
      body: JSON.stringify({
        conversationId: 'http-e102',
        message: 'VCD-2000 E102 更换耗材后报警',
      }),
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('event: rag.completed');
    expect(text).toContain('event: answer.completed');
    expect(text).toContain('"citations"');
    expect(text).not.toContain('event: error');
  });
  it('validates requests and prevents callers from supplying tool permissions', async () => {
    const { url } = await setup();
    const response = await fetch(`${url}/api/v1/chat`, {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'x', message: 'hello', permissions: ['WRITE'] }),
    });
    expect(response.status).toBe(400);
    expect((await fetch(`${url}/api/v1/knowledge`, { method: 'POST', body: '{}' })).status).toBe(
      403,
    );
    expect((await fetch(`${url}/api/v1/chat`, { method: 'POST', body: 'bad json' })).status).toBe(
      400,
    );
  });
  it('uses server-side identity and prevents cross-user access', async () => {
    const { url } = await setup(
      JSON.stringify({
        alice: { tenantId: 't', userId: 'a', permissions: ['READ'] },
        bob: { tenantId: 't', userId: 'b', permissions: ['READ'] },
      }),
    );
    const request = (token?: string) =>
      fetch(`${url}/api/v1/chat`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ conversationId: 'owned-http', message: 'E102' }),
      });
    expect((await request()).status).toBe(401);
    expect((await request('toString')).status).toBe(401);
    await (await request('alice')).text();
    expect((await request('bob')).status).toBe(403);
  });
});
