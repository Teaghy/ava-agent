import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { z } from 'zod';
import { OpenAICompatibleModelService } from '../src/plugins/model-openai/index.js';
import { OpenAIEmbedding } from '../src/plugins/embedding-openai/index.js';
import { Mem0Memory } from '../src/plugins/memory-mem0/index.js';
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((resolve, reject) => {
          s.close((e) => (e ? reject(e) : resolve()));
          s.closeAllConnections();
        }),
    ),
  );
});
async function fixture(
  handler: (
    path: string,
    body: Record<string, unknown>,
    headers: Record<string, string | string[] | undefined>,
  ) => unknown,
) {
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += String(chunk);
    const result = handler(
      request.url ?? '',
      raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      request.headers,
    );
    if (typeof result === 'string') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(result);
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  return `http://127.0.0.1:${address.port}`;
}
describe('Provider wire contracts', () => {
  it('uses OpenAI compatible JSON decisions, normal chat, streaming and validates schema', async () => {
    let valid = true;
    let calls = 0;
    const logs: Record<string, unknown>[] = [];
    const url = await fixture((_path, body, headers) => {
      calls++;
      expect(headers.authorization).toBe('Bearer test-key');
      if (body.stream)
        return 'data: {"id":"s","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n';
      return {
        id: 'test',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: body.response_format
                ? JSON.stringify(valid ? { answer: 'ok' } : { wrong: true })
                : 'hello',
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
      };
    });
    const model = new OpenAICompatibleModelService(
      { baseURL: `${url}/v1`, apiKey: 'test-key', model: 'test' },
      {
        span: (_n, _a, fn) => fn(),
        log(data) {
          logs.push(data);
        },
      },
    );
    const r = {
      messages: [{ role: 'user' as const, content: 'hello' }],
      runId: 'r',
      conversationId: 'c',
    };
    expect((await model.chat(r)).text).toBe('hello');
    expect(await model.structuredOutput(z.object({ answer: z.string() }).strict(), r)).toEqual({
      answer: 'ok',
    });
    const deltas = [];
    for await (const delta of model.stream(r)) deltas.push(delta.text);
    expect(deltas.join('')).toBe('hello');
    valid = false;
    await expect(model.structuredOutput(z.object({ answer: z.string() }), r)).rejects.toMatchObject(
      { code: 'INVALID_MODEL_OUTPUT' },
    );
    expect(calls).toBe(4);
    expect(logs[0]).toMatchObject({ run_id: 'r', input_tokens: 11, output_tokens: 7 });
  });
  it('preserves embedding order and rejects wrong dimensions', async () => {
    let valid = true;
    const url = await fixture(() => ({
      object: 'list',
      data: valid
        ? [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ]
        : [{ index: 0, embedding: [1] }],
      usage: { prompt_tokens: 2, total_tokens: 2 },
    }));
    const embedding = new OpenAIEmbedding({
      baseURL: `${url}/v1`,
      apiKey: 'test',
      model: 'test',
      dimensions: 2,
    });
    expect(await embedding.embedMany(['a', 'b'])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    valid = false;
    await expect(embedding.embed('a')).rejects.toThrow('Embedding shape mismatch');
  });
  it('uses Mem0 OSS endpoints, X-API-Key and tenant/user scoped search and deletion', async () => {
    const scope = JSON.stringify(['t', 'u']);
    let deleted = false;
    const url = await fixture((path, body, headers) => {
      expect(headers['x-api-key']).toBe('mem0-key');
      if (path === '/search') {
        expect(body.filters).toEqual({ user_id: scope });
        expect(body.top_k).toBe(3);
        return { results: [{ id: 'm1', memory: 'VCD-2000', metadata: { category: 'device' } }] };
      }
      if (path === '/memories') {
        expect(body.user_id).toBe(scope);
        expect(body.infer).toBe(false);
        return { results: [{ id: 'm1', memory: 'VCD-2000', event: 'ADD' }] };
      }
      if (!deleted) {
        deleted = true;
        return { user_id: scope };
      }
      return { message: 'deleted' };
    });
    const memory = new Mem0Memory({ url, apiKey: 'mem0-key' });
    expect(
      (
        await memory.remember({
          tenantId: 't',
          userId: 'u',
          category: 'device',
          content: 'VCD-2000',
        })
      ).id,
    ).toBe('m1');
    expect((await memory.recall('VCD', { tenantId: 't', userId: 'u', limit: 3 }))[0]?.content).toBe(
      'VCD-2000',
    );
    await memory.forget('m1', { tenantId: 't', userId: 'u' });
  });
  it('never deletes a Mem0 record owned by another principal', async () => {
    let calls = 0;
    const url = await fixture(() => {
      calls++;
      return { user_id: 'someone-else' };
    });
    await expect(
      new Mem0Memory({ url, apiKey: '' }).forget('m', { tenantId: 't', userId: 'u' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(calls).toBe(1);
  });
});
