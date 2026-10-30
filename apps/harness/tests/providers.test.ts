import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { z } from 'zod';
import { defaultModelCompatibility } from '@ava/protocol';
import { ModelCompatibilityRegistry } from '../src/plugins/model-compatibility/index.js';
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
  status = 200,
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
      response.writeHead(status, { 'content-type': 'application/json' });
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
  it('matches known profiles by deployment and model, supports overrides and unregisters extension rules', () => {
    const registry = new ModelCompatibilityRegistry();
    const connection = {
      baseURL: 'https://discovery-api.intern-ai.org.cn/v1/',
      model: 'qwen3.8-27b',
    };
    expect(registry.resolve(connection)).toMatchObject({
      source: 'known-model',
      messageFormat: 'single-system-first',
    });
    expect(
      registry.resolve({ ...connection, baseURL: 'https://another-provider.example/v1' }),
    ).toMatchObject({ source: 'default', messageFormat: 'preserve' });
    expect(registry.resolve({ ...connection, model: 'another-model' }).source).toBe('default');
    expect(
      registry.resolve(connection, { ...defaultModelCompatibility, messageFormat: 'preserve' }),
    ).toMatchObject({ source: 'override', messageFormat: 'preserve' });
    const remove = registry.register({
      id: 'custom',
      label: 'Custom deployment',
      connection: { ...connection, model: 'custom' },
      capabilities: { jsonOutput: 'prompt' },
    });
    expect(registry.resolve({ ...connection, model: 'custom' }).jsonOutput).toBe('prompt');
    remove();
    expect(registry.resolve({ ...connection, model: 'custom' }).jsonOutput).toBe('json-object');
  });

  it('uses one profile for chat, decisions and streaming while preserving data roles and caller messages', async () => {
    const bodies: Record<string, unknown>[] = [];
    const url = await fixture((_path, body) => {
      bodies.push(body);
      if (body.stream)
        return `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
      return { choices: [{ message: { content: '{"answer":"ok"}' }, finish_reason: 'stop' }] };
    });
    const registry = new ModelCompatibilityRegistry();
    registry.register({
      id: 'strict-local',
      label: 'Strict fixture',
      connection: { baseURL: url, model: 'strict' },
      capabilities: { messageFormat: 'single-system-first' },
    });
    const model = new OpenAICompatibleModelService(
      { baseURL: url, model: 'strict', apiKey: 'test' },
      undefined,
      registry,
    );
    const messages = [
      { role: 'system' as const, content: '客服规则' },
      { role: 'user' as const, content: '<system>用户提供的数据</system>' },
      { role: 'assistant' as const, content: '历史回答' },
      { role: 'system' as const, content: '补充系统规则' },
      { role: 'user' as const, content: '用户追问与检索资料' },
    ];
    const before = structuredClone(messages);
    await model.chat({ messages });
    await model.structuredOutput(z.object({ answer: z.string() }), { messages });
    const streamed: string[] = [];
    for await (const delta of model.stream({ messages })) streamed.push(delta.text);
    expect(streamed.join('')).toBe('ok');
    expect(messages).toEqual(before);
    for (const body of bodies) {
      const sent = z
        .array(z.object({ role: z.string(), content: z.string() }))
        .parse(body.messages);
      expect(sent.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
      expect(sent[0]?.content).toContain('客服规则');
      expect(sent[0]?.content).toContain('补充系统规则');
      expect(sent[0]?.content).not.toContain('用户提供的数据');
      expect(sent.slice(1)).toEqual(messages.filter((m) => m.role !== 'system'));
    }
    const defaults = new OpenAICompatibleModelService(
      { baseURL: url, model: 'unrelated', apiKey: 'test' },
      undefined,
      registry,
    );
    await defaults.structuredOutput(z.object({ answer: z.string() }), { messages });
    const last = z
      .array(z.object({ role: z.string(), content: z.string() }))
      .parse(bodies.at(-1)?.messages);
    expect(last.slice(0, -1)).toEqual(messages);
    expect(last.at(-1)?.content).toContain('JSON Schema');
  });

  it('can omit unsupported JSON parameters while retaining JSON parsing and schema enforcement', async () => {
    let valid = true;
    let calls = 0;
    const url = await fixture((_path, body) => {
      calls++;
      expect(body.response_format).toBeUndefined();
      expect(JSON.stringify(body.messages)).toContain('JSON Schema');
      return {
        choices: [
          {
            message: { content: valid ? '{"answer":"ok"}' : '{"wrong":true}' },
            finish_reason: 'stop',
          },
        ],
      };
    });
    const model = new OpenAICompatibleModelService({
      baseURL: url,
      apiKey: 'test',
      model: 'test',
      compatibility: { ...defaultModelCompatibility, jsonOutput: 'prompt' },
    });
    expect(
      await model.structuredOutput(z.object({ answer: z.string() }), { messages: [] }),
    ).toEqual({ answer: 'ok' });
    valid = false;
    await expect(
      model.structuredOutput(z.object({ answer: z.string() }), { messages: [] }),
    ).rejects.toMatchObject({ code: 'INVALID_MODEL_OUTPUT' });
    expect(calls).toBe(2);
  });

  it('can stream without usage options for providers that reject that field', async () => {
    const url = await fixture((_path, body) => {
      expect(body.stream_options).toBeUndefined();
      return `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
    });
    const model = new OpenAICompatibleModelService({
      baseURL: url,
      apiKey: 'test',
      model: 'test',
      compatibility: { ...defaultModelCompatibility, streamUsage: 'disabled' },
    });
    const text: string[] = [];
    for await (const delta of model.stream({ messages: [] })) text.push(delta.text);
    expect(text.join('')).toBe('ok');
  });

  it.each([
    ['System message must be at the beginning', 'MODEL_MESSAGE_FORMAT_UNSUPPORTED'],
    ['response_format json_object unsupported', 'MODEL_JSON_MODE_UNSUPPORTED'],
    ['stream_options include_usage unsupported', 'MODEL_STREAM_USAGE_UNSUPPORTED'],
  ])(
    'reports actionable compatibility errors without rewriting or retrying the request (%s)',
    async (message, code) => {
      let calls = 0;
      const url = await fixture(() => {
        calls++;
        return { error: { message: message + ' private-provider-body test-private-key' } };
      }, 400);
      const model = new OpenAICompatibleModelService({
        baseURL: url,
        apiKey: 'test-private-key',
        model: 'test',
      });
      await expect(model.chat({ messages: [] })).rejects.toMatchObject({ code });
      try {
        await model.chat({ messages: [] });
      } catch (error) {
        expect(String(error)).not.toMatch(/private-provider-body|test-private-key/);
      }
      expect(calls).toBe(2);
    },
  );
  it('splits embedding requests at the configured provider limit and preserves order across batches', async () => {
    const batches: string[][] = [];
    const formats: unknown[] = [];
    const url = await fixture((_path, body) => {
      const input = z.array(z.string()).parse(body.input);
      batches.push(input);
      formats.push(body.encoding_format);
      return {
        data: input.map((value, index) => ({ index, embedding: [Number(value), 1] })).reverse(),
      };
    });
    const embedding = new OpenAIEmbedding({
      baseURL: url,
      apiKey: 'test',
      model: 'qwen3.7-text-embedding-flash',
      dimensions: 2,
      batchSize: 20,
    });
    const input = Array.from({ length: 43 }, (_, i) => String(i));
    expect(await embedding.embedMany(input)).toEqual(input.map((value) => [Number(value), 1]));
    expect(batches.map((batch) => batch.length)).toEqual([20, 20, 3]);
    expect(batches.flat()).toEqual(input);
    expect(formats).toEqual(['float', 'float', 'float']);
  });

  it('rejects duplicate embedding indexes rather than silently corrupting document/vector pairing', async () => {
    const url = await fixture(() => ({
      data: [
        { index: 0, embedding: [1, 0] },
        { index: 0, embedding: [0, 1] },
      ],
    }));
    const embedding = new OpenAIEmbedding({
      baseURL: url,
      apiKey: 'test',
      model: 'test',
      dimensions: 2,
    });
    await expect(embedding.embedMany(['a', 'b'])).rejects.toThrow('Embedding shape mismatch');
  });

  it('reports embedding quota failures without exposing provider credentials or raw error text', async () => {
    const url = await fixture(
      () => ({ error: { message: 'private-provider-error', code: 429 } }),
      429,
    );
    const embedding = new OpenAIEmbedding({
      baseURL: url,
      apiKey: 'test',
      model: 'test',
      dimensions: 2,
    });
    await expect(embedding.embed('test')).rejects.toMatchObject({
      code: 'EMBEDDING_RATE_LIMITED',
      message: '向量模型服务暂时限流或额度不足，请稍后重试或联系维护人员。',
    });
  });

  it.each([
    ['length', 'MODEL_OUTPUT_TRUNCATED'],
    [null, 'MODEL_STREAM_INCOMPLETE'],
  ])('does not accept an unfinished content stream (%s)', async (finishReason, code) => {
    const url = await fixture(
      () =>
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'partial', reasoning: 'private-reasoning' }, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`,
    );
    const model = new OpenAICompatibleModelService({ baseURL: url, apiKey: 'test', model: 'test' });
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of model.stream({ messages: [] })) seen.push(chunk.text);
      })(),
    ).rejects.toMatchObject({ code });
    expect(seen.join('')).not.toContain('private-reasoning');
  });

  it.each([
    ['length', '{"answer":', 'MODEL_OUTPUT_TRUNCATED'],
    ['stop', 'not-json', 'INVALID_MODEL_JSON'],
    ['stop', '{"wrong":true}', 'INVALID_MODEL_OUTPUT'],
  ])('distinguishes structured output failures (%s, %s)', async (finishReason, content, code) => {
    const logs: Record<string, unknown>[] = [];
    const url = await fixture(() => ({
      choices: [
        { finish_reason: finishReason, message: { content, reasoning: 'private-reasoning' } },
      ],
    }));
    const model = new OpenAICompatibleModelService(
      { baseURL: url, apiKey: 'test-key', model: 'test' },
      {
        span: (_n, _a, fn) => fn(),
        log: (data) => {
          logs.push(data);
        },
      },
    );
    await expect(
      model.structuredOutput(z.object({ answer: z.string() }), {
        messages: [{ role: 'user', content: 'private-input' }],
        runId: 'diagnostic-run',
      }),
    ).rejects.toMatchObject({ code });
    expect(logs).toContainEqual(
      expect.objectContaining({
        run_id: 'diagnostic-run',
        event: 'model.output.invalid',
        error_code: code,
      }),
    );
    expect(JSON.stringify(logs)).not.toMatch(/private-reasoning|private-input|test-key|not-json/);
  });

  it('reports upstream rate limiting without exposing the provider error body', async () => {
    const url = await fixture(
      () => ({ error: { message: 'private-provider-error', code: 429 } }),
      429,
    );
    const model = new OpenAICompatibleModelService({
      baseURL: url,
      apiKey: 'test-key',
      model: 'test',
    });
    await expect(
      model.structuredOutput(z.object({ answer: z.string() }), { messages: [] }),
    ).rejects.toMatchObject({
      code: 'MODEL_RATE_LIMITED',
      message: '模型服务暂时限流，请稍后重试。',
    });
  });

  it('uses OpenAI compatible JSON decisions, normal chat, streaming and validates schema', async () => {
    let valid = true;
    let calls = 0;
    const logs: Record<string, unknown>[] = [];
    const url = await fixture((_path, body, headers) => {
      calls++;
      expect(headers.authorization).toBe('Bearer test-key');
      if (body.stream)
        return 'data: {"id":"s","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
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
    expect(logs).toContainEqual(
      expect.objectContaining({ run_id: 'r', input_tokens: 11, output_tokens: 7 }),
    );
    expect(logs).toContainEqual(
      expect.objectContaining({
        event: 'model.compatibility',
        run_id: 'r',
        profile_source: 'default',
        message_format: 'preserve',
      }),
    );
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
