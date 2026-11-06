import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';
import { storageMemoryPlugin } from '../src/plugins/storage-memory/index.js';
import { cacheMemoryPlugin } from '../src/plugins/cache-memory/index.js';
import { vectorMemoryPlugin } from '../src/plugins/vector-memory/index.js';
import { MockEmbedding } from '../src/plugins/embedding-openai/index.js';
import {
  buildModelContext,
  defaultContextService,
  type ContextBuildRequest,
} from '../src/core/agent/context.service.js';
import type { HarnessOptions } from '../src/bootstrap/extensions.js';
import type { ModelMessage } from '../src/core/model/model.types.js';
import { principal } from './helpers.js';
import { makeHarness } from './helpers.js';

const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
    ),
  );
});

interface RecordedRequest {
  model: string;
  messages: ModelMessage[];
  stream?: boolean;
  response_format?: unknown;
  stream_options?: unknown;
  authorization?: string;
}
async function modelServer() {
  const calls: RecordedRequest[] = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const part of request) raw += part.toString();
    const body = JSON.parse(raw);
    calls.push({ ...body, authorization: request.headers.authorization });
    if (body.model === 'broken-decision') {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'model unavailable' } }));
      return;
    }
    const content = body.model.includes('decision')
      ? JSON.stringify({ type: 'answer_ready', citations: [] })
      : body.model.includes('summary')
        ? '本地摘要：用户询问了产品情况。'
        : '回答模型生成的正文。';
    if (body.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [delta, finish_reason] of [
        [{ content }, null],
        [{}, 'stop'],
      ])
        response.write(
          `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      response.end('data: [DONE]\n\n');
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        }),
      );
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server');
  return { url: `http://127.0.0.1:${address.port}/v1`, calls };
}

async function liveHarness(env: NodeJS.ProcessEnv, options: HarnessOptions = {}) {
  const h = await createHarness(
    loadConfig({
      NODE_ENV: 'test',
      APP_MODE: 'live',
      APP_PRESET: 'chat',
      SEED_KNOWLEDGE: 'false',
      API_KEYS: JSON.stringify({ token: principal }),
      ...env,
    }),
    {
      quiet: true,
      ...options,
      providers: {
        storage: storageMemoryPlugin,
        cache: cacheMemoryPlugin,
        vector: vectorMemoryPlugin,
        embedding: {
          name: 'test-embedding',
          provide: ['embedding'],
          apply(ctx) {
            ctx.provide('embedding', new MockEmbedding());
          },
        },
        ...options.providers,
      },
    },
  );
  harnesses.push(h);
  return h;
}
function routes(url: string) {
  return Object.fromEntries(
    ['DECISION', 'ANSWER', 'SUMMARY'].flatMap((role) => [
      [`${role}_LLM_BASE_URL`, url],
      [`${role}_LLM_MODEL`, `${role.toLowerCase()}-model`],
      [`${role}_LLM_API_KEY`, `local-${role.toLowerCase()}`],
    ]),
  );
}

describe('Role models and replaceable context', () => {
  it('keeps mock deployments offline even with complete live role connections', async () => {
    const server = await modelServer();
    const h = await makeHarness({
      ...routes(server.url),
      APP_PRESET: 'chat',
      SEED_KNOWLEDGE: 'false',
    });
    harnesses.push(h);
    expect(h.ctx.modelRouter.get('decision')).toBe(h.ctx.model);
    await h.ctx.agent.run({ conversationId: 'mock-roles', message: 'hello', principal });
    expect(server.calls).toEqual([]);
  });
  it.each(['true', 'false'])(
    'uses independent decision, answer and summary endpoints (streaming=%s)',
    async (streaming) => {
      const server = await modelServer();
      const purposes: string[] = [];
      const h = await liveHarness(
        {
          ...routes(server.url),
          ANSWER_STREAMING: streaming,
          SESSION_SUMMARY_MODE: 'model',
          DECISION_LLM_JSON_OUTPUT: 'prompt',
          ANSWER_LLM_STREAM_USAGE: 'disabled',
        },
        {
          providers: {
            contextBuilder: {
              name: 'test-context',
              provide: ['contextBuilder'],
              apply(ctx) {
                ctx.provide('contextBuilder', {
                  build(input) {
                    purposes.push(input.purpose);
                    return defaultContextService.build(input);
                  },
                });
              },
            },
          },
        },
      );
      const result = await h.ctx.agent.run({
        conversationId: 'roles',
        message: 'hello',
        principal,
      });
      expect(result.answer).toBe('回答模型生成的正文。');
      for (let i = 0; i < 20; i++)
        await h.ctx.sessions.add('summary', i % 2 ? 'assistant' : 'user', `history-${i}`);
      await h.ctx.sessions.summarize('summary');
      expect((await h.ctx.sessions.summary('summary'))?.summary).toContain('本地摘要');
      expect(purposes).toEqual(['decision', 'answer', 'summary']);
      expect(server.calls.map((call) => call.model)).toEqual([
        'decision-model',
        'answer-model',
        'summary-model',
      ]);
      expect(server.calls.map((call) => call.authorization)).toEqual([
        'Bearer local-decision',
        'Bearer local-answer',
        'Bearer local-summary',
      ]);
      expect(server.calls[0]?.response_format).toBeUndefined();
      expect(server.calls[1]?.stream_options).toBeUndefined();
      expect(!!server.calls[1]?.stream).toBe(streaming === 'true');
      expect(server.calls[2]?.stream).toBeUndefined();
      expect(
        server.calls[2]?.messages.some((message) => message.content.includes('history-19')),
      ).toBe(false);
      expect(await h.ctx.storage.recall(principal)).toEqual([]);
    },
  );

  it('resolves unassigned roles against the current default and never silently falls back after a role failure', async () => {
    const server = await modelServer();
    const h = await liveHarness({
      LLM_BASE_URL: server.url,
      LLM_MODEL: 'default-answer',
      LLM_API_KEY: 'default-key',
      DECISION_LLM_BASE_URL: server.url,
      DECISION_LLM_MODEL: 'broken-decision',
      DECISION_LLM_API_KEY: 'local',
    });
    expect(h.ctx.modelRouter.get('answer')).toBe(h.ctx.model);
    expect(h.ctx.modelRouter.get('summary')).toBe(h.ctx.model);
    await expect(
      h.ctx.agent.run({ conversationId: 'failure', message: 'hello', principal }),
    ).rejects.toMatchObject({ code: 'MODEL_REQUEST_REJECTED' });
    expect(server.calls.map((call) => call.model)).toEqual(['broken-decision']);
  });

  it('keeps the previous summary on cancellation and never promotes generated text to authoritative facts', async () => {
    const server = await modelServer();
    const h = await liveHarness(
      { ...routes(server.url) },
      {
        providers: {
          summarizer: {
            name: 'test-summary',
            provide: ['summarizer'],
            apply(ctx) {
              ctx.provide('summarizer', {
                async summarize(input) {
                  input.previous?.confirmedFacts.push('forged-fact');
                  input.messages[0]!.content = 'mutated';
                  return 'untrusted background text';
                },
              });
            },
          },
        },
      },
    );
    for (let i = 0; i < 20; i++) await h.ctx.sessions.add('summary', 'user', `message-${i}`);
    await h.ctx.storage.saveSummary({
      conversationId: 'summary',
      summary: 'previous',
      confirmedFacts: ['verified'],
      executedActions: ['action'],
      pendingItems: [],
      updatedAt: '',
    });
    await h.ctx.sessions.summarize('summary');
    expect(await h.ctx.sessions.summary('summary')).toMatchObject({
      summary: 'untrusted background text',
      confirmedFacts: ['verified'],
      executedActions: ['action'],
    });
    expect((await h.ctx.storage.messages('summary', 20))[0]?.content).toBe('message-0');
    const controller = new AbortController();
    vi.spyOn(h.ctx.summarizer, 'summarize').mockImplementation(async () => {
      controller.abort();
      return 'cancelled summary';
    });
    await expect(h.ctx.sessions.summarize('summary', controller.signal)).rejects.toBeDefined();
    expect((await h.ctx.sessions.summary('summary'))?.summary).toBe('untrusted background text');
  });

  it('snapshots context inputs and rejects invalid or oversized plugin output before model invocation', async () => {
    const request: ContextBuildRequest = {
      purpose: 'answer',
      systemPrompt: 'rules',
      tokenBudget: 1000,
      message: 'hello',
      tools: [],
      recent: [],
      memories: [],
      state: {
        observations: [{ tool: 'lookup', result: { status: 'verified' } }],
        retrievedDocuments: [],
      },
    };
    const messages = await buildModelContext(
      {
        build(input) {
          input.state.observations[0]!.result = { status: 'forged' };
          return [{ role: 'user', content: 'safe' }];
        },
      },
      request,
    );
    expect(messages).toEqual([{ role: 'user', content: 'safe' }]);
    expect(request.state.observations[0]?.result).toEqual({ status: 'verified' });
    await expect(buildModelContext({ build: () => [] }, request)).rejects.toMatchObject({
      code: 'INVALID_CONTEXT',
    });
    await expect(
      buildModelContext({ build: () => [{ role: 'user', content: 'x'.repeat(1000) }] }, request),
    ).rejects.toMatchObject({ code: 'CONTEXT_BUDGET' });
    await expect(
      buildModelContext(
        {
          build: () =>
            Array.from({ length: 100 }, () => ({
              role: 'user' as const,
              content: '',
            })),
        },
        request,
      ),
    ).rejects.toMatchObject({ code: 'CONTEXT_BUDGET' });
    const controller = new AbortController();
    await expect(
      buildModelContext(
        {
          build: () => {
            controller.abort();
            return [{ role: 'user', content: 'cancelled' }];
          },
        },
        { ...request, signal: controller.signal },
      ),
    ).rejects.toBeDefined();
  });

  it('rejects incomplete role connections rather than borrowing credentials from the default endpoint', () => {
    expect(() => loadConfig({ DECISION_LLM_BASE_URL: 'http://127.0.0.1:8000/v1' })).toThrow(
      /configured together/,
    );
    expect(() => loadConfig({ ANSWER_LLM_MODEL: 'local' })).toThrow(/configured together/);
  });
});
