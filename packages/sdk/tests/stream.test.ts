import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseSse, AgentClient } from '../src/index.js';
import { safeSource } from '@ava/shared';
function stream(text: string, chunkSize = 1) {
  const encoded = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < encoded.length; offset += chunkSize)
        controller.enqueue(encoded.slice(offset, offset + chunkSize));
      controller.close();
    },
  });
}
afterEach(() => vi.unstubAllGlobals());
describe('Browser SSE protocol', () => {
  it('decodes split UTF-8 and CRLF, ignores heartbeats, handles multiline data', async () => {
    const body = stream(
      ': keepalive\r\nevent: ping\r\ndata: {}\r\n\r\nevent: answer.delta\r\ndata: {\r\ndata: "text": "真空状态异常"}\r\n\r\nevent: future.event\ndata: {}\n\n',
    );
    const events = [];
    for await (const event of parseSse(body)) events.push(event);
    expect(events).toEqual([{ type: 'answer.delta', data: { text: '真空状态异常' } }]);
  });
  it('rejects malformed known events and does not commit incomplete frames', async () => {
    const malformed = async () => {
      for await (const _event of parseSse(stream('event: answer.delta\ndata: {"text":42}\n\n'))) {
        void _event;
      }
    };
    await expect(malformed()).rejects.toThrow('格式');
    const events = [];
    for await (const event of parseSse(
      stream('event: answer.delta\ndata: {"text":"incomplete"}\n'),
    ))
      events.push(event);
    expect(events).toEqual([]);
  });
  it('requires final completion and sends POST auth without persisting credentials', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(stream('event: answer.delta\ndata: {"text":"partial"}\n\n'), {
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);
    await expect(
      (async () => {
        for await (const event of new AgentClient({ token: 'private-token' }).chat.stream(
          { conversationId: 'conv', message: 'E102' },
          new AbortController().signal,
        )) {
          void event;
        }
      })(),
    ).rejects.toThrow('连接已中断');
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/chat',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ conversationId: 'conv', message: 'E102' }),
      }),
    );
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe(
      'Bearer private-token',
    );
  });
  it('allows only http(s) citation targets', () => {
    expect(safeSource('javascript:alert(1)')).toBeUndefined();
    expect(safeSource('data:text/html,test')).toBeUndefined();
    expect(safeSource('https://example.com/manual')).toBe('https://example.com/manual');
  });
});
