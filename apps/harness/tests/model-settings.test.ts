import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { defaultModelCompatibility } from '@ava/protocol';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { ModelSettingsController } from '../src/plugins/model-settings/controller.js';
import { InMemoryStorage } from '../src/plugins/storage-memory/index.js';
import { InMemoryVector } from '../src/plugins/vector-memory/index.js';
import { loadConfig } from '../src/config/index.js';
import { makeHarness, principal, silentTelemetry } from './helpers.js';
import { chunkDocument } from '../src/core/rag/chunker.js';
import { createHarness } from '../src/bootstrap/plugins.js';
import { storageMemoryPlugin } from '../src/plugins/storage-memory/index.js';
import { cacheMemoryPlugin } from '../src/plugins/cache-memory/index.js';

const servers: Server[] = [],
  roots: string[] = [];
const controllers: ModelSettingsController[] = [];
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((c) => c.close()));
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
          server.closeAllConnections();
        }),
    ),
  );
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture root');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  let failEmbedding = false;
  let failStreaming = false;
  const modelRequests: string[] = [];
  const server = createServer(async (request, response) => {
    if (request.url?.startsWith('/collections/')) {
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          status: 'ok',
          time: 0,
          result: request.url.endsWith('/exists')
            ? { exists: true }
            : request.method === 'GET'
              ? { config: { params: { vectors: { size: 2, distance: 'Cosine' } } } }
              : { operation_id: 1, status: 'completed' },
        }),
      );
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    response.setHeader('content-type', 'application/json');
    if (request.url?.endsWith('/embeddings')) {
      if (failEmbedding) {
        response.statusCode = 401;
        response.end(JSON.stringify({ error: { message: 'private-provider-message' } }));
        return;
      }
      response.end(
        JSON.stringify({
          data: body.input.map((_text: string, index: number) => ({
            index,
            embedding: Array(body.dimensions).fill(1),
          })),
        }),
      );
    } else {
      modelRequests.push(body.model);
      if (body.stream) {
        if (failStreaming) {
          response.statusCode = 400;
          response.end(
            JSON.stringify({
              error: { message: 'stream_options unsupported private-stream-error' },
            }),
          );
          return;
        }
        response.setHeader('content-type', 'text/event-stream');
        response.end(
          `data: ${JSON.stringify({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
        );
        return;
      }
      response.end(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
        }),
      );
    }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const root = await mkdtemp(join(tmpdir(), 'ava-models-'));
  roots.push(root);
  const url = `http://127.0.0.1:${address.port}`;
  const config = loadConfig({
    APP_MODE: 'live',
    NODE_ENV: 'test',
    API_KEYS: JSON.stringify({ alice: principal }),
    LLM_BASE_URL: url,
    LLM_MODEL: 'old-llm',
    LLM_API_KEY: 'old-llm-secret',
    EMBEDDING_BASE_URL: url,
    EMBEDDING_MODEL: 'old-embedding',
    EMBEDDING_API_KEY: 'old-embedding-secret',
    EMBEDDING_DIMENSIONS: '2',
  });
  const storage = new InMemoryStorage();
  const vectors = new Map<string, InMemoryVector>();
  const buildVector = async (name: string) => {
    let vector = vectors.get(name);
    if (!vector) {
      vector = new InMemoryVector();
      vectors.set(name, vector);
    }
    return vector;
  };
  const statePath = join(root, 'models.json');
  const controller = await ModelSettingsController.prepare(
    config,
    statePath,
    buildVector,
    () => undefined,
    () => silentTelemetry,
  );
  controllers.push(controller);
  controller.bind(
    () => storage,
    async (operation) => operation(),
  );
  await controller.initializeVector();
  for (const tenant of ['tenant-a', 'tenant-b']) {
    const document = { id: 'guide', title: 'Guide', content: 'Published knowledge', metadata: {} };
    await storage.saveKnowledge(document, tenant, chunkDocument(document, tenant));
  }
  return {
    controller,
    storage,
    vectors,
    config,
    statePath,
    buildVector,
    url,
    modelRequests,
    failStream: () => {
      failStreaming = true;
    },
    fail: () => {
      failEmbedding = true;
    },
  };
}
async function settled(controller: ModelSettingsController) {
  await vi.waitFor(() => expect(['completed', 'failed']).toContain(controller.view().job?.status), {
    timeout: 5000,
  });
  // Let the queue cleanup finish before another apply.
  await new Promise((resolve) => setTimeout(resolve, 0));
}
describe('Ops model settings', () => {
  it('validates streaming after multi-turn decisions and keeps the active configuration if streaming fails', async () => {
    const f = await fixture();
    f.failStream();
    f.controller.apply({ revision: 0, llm: { baseURL: f.url, model: 'new-model' } });
    await settled(f.controller);
    expect(f.controller.view()).toMatchObject({
      revision: 0,
      llm: { model: 'old-llm' },
      job: { status: 'failed', checks: { structuredOutput: true, streaming: false } },
    });
    expect(f.controller.view().job?.error).toContain('流式用量参数');
    expect(f.controller.view().job?.error).not.toContain('private-stream-error');
    await expect(readFile(f.statePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('persists compatibility overrides, preserves them for legacy clients and resets them when switching models', async () => {
    const f = await fixture();
    const compatibility = {
      ...defaultModelCompatibility,
      messageFormat: 'single-system-first' as const,
      jsonOutput: 'prompt' as const,
      streamUsage: 'disabled' as const,
    };
    f.controller.apply({ revision: 0, llm: { baseURL: f.url, model: 'old-llm', compatibility } });
    await settled(f.controller);
    expect(f.controller.view().llm).toMatchObject({
      compatibility,
      effectiveCompatibility: {
        source: 'override',
        messageFormat: 'single-system-first',
        jsonOutput: 'prompt',
        streamUsage: false,
      },
    });
    expect(f.controller.view().job?.checks).toEqual({ structuredOutput: true, streaming: true });
    const restored = await ModelSettingsController.prepare(
      f.config,
      f.statePath,
      f.buildVector,
      () => undefined,
      () => silentTelemetry,
    );
    controllers.push(restored);
    expect(restored.view().llm.compatibility).toEqual(compatibility);
    f.controller.apply({ revision: 1, llm: { baseURL: f.url, model: 'old-llm' } });
    await settled(f.controller);
    expect(f.controller.view().llm.compatibility).toEqual(compatibility);
    f.controller.apply({ revision: 2, llm: { baseURL: f.url, model: 'another-model' } });
    await settled(f.controller);
    expect(f.controller.view().llm.compatibility).toEqual(defaultModelCompatibility);
    const legacy = JSON.parse(await readFile(f.statePath, 'utf8'));
    delete legacy.settings.llm.compatibility;
    await writeFile(f.statePath, JSON.stringify(legacy));
    const migrated = await ModelSettingsController.prepare(
      f.config,
      f.statePath,
      f.buildVector,
      () => undefined,
      () => silentTelemetry,
    );
    controllers.push(migrated);
    expect(migrated.view().llm.compatibility).toEqual(defaultModelCompatibility);
    expect(migrated.view().revision).toBe(3);
  });
  it('acknowledges a live Ops apply and switches the existing provider without restarting HTTP', async () => {
    const f = await fixture();
    const h = await createHarness(
      loadConfig({
        NODE_ENV: 'test',
        APP_MODE: 'live',
        SEED_KNOWLEDGE: 'false',
        PORT: '0',
        OPS_ENABLED: 'true',
        OPS_PORT: '0',
        API_KEYS: JSON.stringify({ business: principal }),
        OPS_API_KEYS: JSON.stringify({ admin: { ...principal, admin: true, managePlugins: true } }),
        LLM_BASE_URL: f.url,
        LLM_API_KEY: 'fixture-key',
        LLM_MODEL: 'old',
        EMBEDDING_BASE_URL: f.url,
        EMBEDDING_API_KEY: 'fixture-embedding',
        EMBEDDING_DIMENSIONS: '2',
        QDRANT_URL: f.url,
      }),
      { quiet: true, providers: { storage: storageMemoryPlugin, cache: cacheMemoryPlugin } },
    );
    harnesses.push(h);
    const port = await h.start();
    const opsPort = h.opsPort;
    const model = h.ctx.model;
    const response = await fetch(`http://127.0.0.1:${opsPort}/api/v1/ops/models/apply`, {
      method: 'POST',
      headers: { authorization: 'Bearer admin', 'content-type': 'application/json' },
      body: JSON.stringify({ revision: 0, llm: { baseURL: f.url, model: 'hot-model' } }),
    });
    expect(response.status).toBe(202);
    expect((await response.json()).job.status).toBe('queued');
    await vi.waitFor(async () => {
      const view = await (
        await fetch(`http://127.0.0.1:${opsPort}/api/v1/ops/models`, {
          headers: { authorization: 'Bearer admin' },
        })
      ).json();
      expect(view.job.status).toBe('completed');
      expect(view.revision).toBe(1);
    });
    expect(h.ctx.model).toBe(model);
    await model.chat({ messages: [] });
    expect(f.modelRequests.at(-1)).toBe('hot-model');
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    expect(h.opsPort).toBe(opsPort);
  });
  it('hot switches the existing model facade without probing an unchanged failing embedding provider', async () => {
    const f = await fixture();
    const service = f.controller.modelService;
    await service.chat({ messages: [{ role: 'user', content: 'before' }] });
    f.fail();
    f.controller.apply({
      revision: 0,
      llm: { baseURL: f.url, model: 'new-llm' },
      embedding: {
        baseURL: f.url,
        model: f.config.EMBEDDING_MODEL,
        dimensions: f.config.EMBEDDING_DIMENSIONS,
        batchSize: f.config.EMBEDDING_BATCH_SIZE,
      },
    });
    await settled(f.controller);
    expect(f.controller.view().job?.status).toBe('completed');
    await service.chat({ messages: [{ role: 'user', content: 'after' }] });
    expect(f.modelRequests).toEqual(['old-llm', 'new-llm', 'new-llm', 'new-llm']);
    expect(f.controller.view().embedding.collection).toBe(f.config.QDRANT_COLLECTION);
  });
  it('restores memory and disk if the execution service fails to resume after applying', async () => {
    const f = await fixture();
    f.controller.bind(
      () => f.storage,
      async (operation) => {
        await operation();
        throw new Error('restart failed');
      },
    );
    f.controller.apply({ revision: 0, llm: { baseURL: f.url, model: 'new-llm' } });
    await settled(f.controller);
    expect(f.controller.view()).toMatchObject({
      revision: 0,
      source: 'env',
      llm: { model: 'old-llm' },
      job: { status: 'failed' },
    });
    await expect(readFile(f.statePath)).rejects.toMatchObject({ code: 'ENOENT' });
    f.controller.bind(
      () => f.storage,
      async (operation) => operation(),
    );
    f.controller.apply({ revision: 0, llm: { baseURL: f.url, model: 'saved-llm' } });
    await settled(f.controller);
    f.controller.bind(
      () => f.storage,
      async (operation) => {
        await operation();
        throw new Error('restart failed');
      },
    );
    f.controller.apply({ revision: 1, llm: { baseURL: f.url, model: 'broken-llm' } });
    await settled(f.controller);
    expect(f.controller.view()).toMatchObject({
      revision: 1,
      source: 'ops',
      llm: { model: 'saved-llm' },
      job: { status: 'failed' },
    });
    expect(JSON.parse(await readFile(f.statePath, 'utf8')).settings.llm.model).toBe('saved-llm');
  });
  it('reindexes every tenant into a new collection and restores saved settings after restart without exposing keys', async () => {
    const f = await fixture();
    const before = f.controller.view();
    expect(before.source).toBe('env');
    expect(JSON.stringify(before)).not.toContain('secret');
    f.controller.apply({
      revision: 0,
      embedding: {
        baseURL: f.url,
        model: 'new-embedding',
        dimensions: 3,
        batchSize: 1,
        apiKey: 'new-embedding-secret',
      },
    });
    await settled(f.controller);
    const next = f.controller.view();
    expect(next.job).toMatchObject({ status: 'completed', processed: 2, total: 2 });
    expect(next.embedding.collection).not.toBe(before.embedding.collection);
    expect(next.embedding.dimensions).toBe(3);
    expect(next.revision).toBe(1);
    expect(f.vectors.get(next.embedding.collection)?.points.size).toBe(2);
    expect(f.vectors.has(before.embedding.collection)).toBe(true);
    expect(
      (await f.controller.vectorService.search([1, 1, 1], 'tenant-a', {}, 10)).map(
        (d) => d.tenantId,
      ),
    ).toEqual(['tenant-a']);
    expect(JSON.stringify(next)).not.toContain('new-embedding-secret');
    const restored = await ModelSettingsController.prepare(
      f.config,
      f.statePath,
      f.buildVector,
      () => undefined,
      () => silentTelemetry,
    );
    controllers.push(restored);
    expect(restored.view().embedding).toEqual(next.embedding);
    expect(restored.view().llm.keyConfigured).toBe(true);
    expect(restored.view().source).toBe('ops');
  });
  it('keeps the active model/index and persisted settings unchanged after validation fails', async () => {
    const f = await fixture();
    const before = f.controller.view();
    f.fail();
    f.controller.apply({
      revision: 0,
      embedding: {
        baseURL: f.url,
        model: 'broken',
        dimensions: 3,
        batchSize: 2,
        apiKey: 'bad-secret',
      },
    });
    await settled(f.controller);
    const after = f.controller.view();
    expect(after.job?.status).toBe('failed');
    expect(after.embedding).toEqual(before.embedding);
    expect(after.revision).toBe(0);
    expect(after.job?.error).not.toContain('private-provider-message');
    await expect(readFile(f.statePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves keys for blank input, supports explicit clearing, and rejects concurrent/stale requests', async () => {
    const f = await fixture();
    const request = { revision: 0, llm: { baseURL: f.url, model: 'new-llm' } };
    f.controller.apply(request);
    expect(() => f.controller.apply(request)).toThrow();
    await settled(f.controller);
    expect(f.controller.view().llm).toMatchObject({ model: 'new-llm', keyConfigured: true });
    expect(() => f.controller.apply(request)).toThrow();
    f.controller.apply({ revision: 1, llm: { baseURL: f.url, model: 'new-llm', apiKey: null } });
    await settled(f.controller);
    expect(f.controller.view().llm.keyConfigured).toBe(false);
    await expect(f.controller.modelService.chat({ messages: [] })).rejects.toMatchObject({
      code: 'MODEL_NOT_CONFIGURED',
    });
  });
  it('does not switch active delegates if saving the prepared configuration fails', async () => {
    const f = await fixture();
    await mkdir(f.statePath);
    f.controller.apply({
      revision: 0,
      embedding: { baseURL: f.url, model: 'new', dimensions: 3, batchSize: 2 },
    });
    await settled(f.controller);
    expect(f.controller.view().job?.status).toBe('failed');
    expect(f.controller.view().embedding.model).toBe('old-embedding');
  });
  it('exposes configuration only on Ops and only to authorized administrators', async () => {
    const h = await makeHarness({
      PORT: '0',
      OPS_ENABLED: 'true',
      OPS_PORT: '0',
      API_KEYS: JSON.stringify({ business: principal }),
      OPS_API_KEYS: JSON.stringify({
        admin: { ...principal, admin: true, managePlugins: true },
        inspector: { ...principal, inspectRuns: true },
      }),
    });
    harnesses.push(h);
    const port = await h.start();
    const ops = `http://127.0.0.1:${h.opsPort}`;
    expect((await fetch(`http://127.0.0.1:${port}/api/v1/ops/models`)).status).toBe(404);
    expect((await fetch(`${ops}/api/v1/ops/models`)).status).toBe(401);
    expect(
      (await fetch(`${ops}/api/v1/ops/models`, { headers: { authorization: 'Bearer inspector' } }))
        .status,
    ).toBe(403);
    const view = await fetch(`${ops}/api/v1/ops/models`, {
      headers: { authorization: 'Bearer admin' },
    });
    expect(view.status).toBe(200);
    expect(JSON.stringify(await view.json())).not.toMatch(/apiKey|old-llm-secret/);
    expect(
      (
        await fetch(`${ops}/api/v1/ops/models/apply`, {
          method: 'POST',
          headers: { authorization: 'Bearer inspector' },
          body: '{}',
        })
      ).status,
    ).toBe(403);
  });
});
