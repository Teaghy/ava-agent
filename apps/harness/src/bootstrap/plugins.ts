import { knowledgeRegistryPlugin } from '../plugins/knowledge-registry/index.js';
import { knowledgeQdrantPlugin } from '../plugins/knowledge-qdrant/index.js';
import { knowledgeCasesPlugin } from '../plugins/knowledge-cases/index.js';
import { readFile } from 'node:fs/promises';
import type { Config } from '../config/index.js';
import { createContext } from './context.js';
import { storageMemoryPlugin } from '../plugins/storage-memory/index.js';
import { storagePostgresPlugin } from '../plugins/storage-postgres/index.js';
import { cacheMemoryPlugin } from '../plugins/cache-memory/index.js';
import { cacheRedisPlugin } from '../plugins/cache-redis/index.js';
import { vectorMemoryPlugin } from '../plugins/vector-memory/index.js';
import { vectorQdrantPlugin } from '../plugins/vector-qdrant/index.js';
import { modelOpenAIPlugin } from '../plugins/model-openai/index.js';
import { modelMockPlugin } from '../plugins/model-mock/index.js';
import { mainModelDecisionPlugin } from '../plugins/decision-main-model/index.js';
import { embeddingPlugin } from '../plugins/embedding-openai/index.js';
import { rerankerPlugin } from '../plugins/reranker/index.js';
import { memoryPlugin } from '../plugins/memory/index.js';
import { memoryMem0Plugin } from '../plugins/memory-mem0/index.js';
import { eventStorePlugin } from '../plugins/event-store/index.js';
import { sessionsPlugin } from '../plugins/sessions/index.js';
import { ragPlugin } from '../plugins/rag/index.js';
import {
  toolsPlugin,
  knowledgeToolPlugin,
  mockBusinessToolsPlugin,
} from '../plugins/tools/index.js';
import { guardPlugin } from '../plugins/guard/index.js';
import { agentLoopPlugin } from '../plugins/agent-loop/index.js';
import { httpH3Plugin } from '../plugins/http-h3/index.js';
import { chatApiPlugin } from '../plugins/chat-api/index.js';
import { knowledgeApiPlugin } from '../plugins/knowledge-api/index.js';
import { observabilityPlugin } from '../plugins/observability/index.js';
import { demoKnowledge } from '../fixtures/knowledge.js';
import { conversationsApiPlugin } from '../plugins/conversations-api/index.js';
import { webStaticPlugin } from '../plugins/web-static/index.js';
import {
  awaitPlugins,
  providerSlots,
  validateExtensions,
  type HarnessOptions,
} from './extensions.js';
import { AppError } from '../core/errors.js';
import { PluginManager } from '../plugins/plugin-manager/manager.js';
import { PluginRuntime, type BaseProvider } from '../plugins/plugin-manager/runtime.js';
import { pluginManagerApiPlugin } from '../plugins/plugin-manager/index.js';
import type { PluginSlot } from '@ava/protocol';
export async function createHarness(config: Config, options: HarnessOptions = {}) {
  const mock = config.APP_MODE === 'mock';
  validateExtensions(options, mock);
  const providers = options.providers ?? {};
  const pluginManager = await PluginManager.prepare(
    options.pluginManagement ?? false,
    options.startupTimeoutMs,
  );
  if (!mock) {
    if (!pluginManager.hasProvider('model') && providers.model === undefined && !config.LLM_API_KEY)
      throw new AppError(
        'MISSING_PROVIDER_CREDENTIALS',
        '默认 live 模型需要 LLM_API_KEY；自定义模型请通过 providers.model 注册。',
      );
    if (
      !pluginManager.hasProvider('embedding') &&
      !providers.embedding &&
      !config.EMBEDDING_API_KEY
    )
      throw new AppError(
        'MISSING_PROVIDER_CREDENTIALS',
        '默认 live Embedding 需要 EMBEDDING_API_KEY；自定义算法请通过 providers.embedding 注册。',
      );
  }
  const ctx = createContext();
  const external = config.APP_MODE === 'live' || config.INFRA_MODE === 'external';
  const prompt =
    options.systemPrompt ??
    (await readFile(new URL('../prompts/system.md', import.meta.url), 'utf8'));
  const auth = {
    keys: config.API_KEYS,
    allowAnonymous:
      mock && config.NODE_ENV !== 'production' && Object.keys(config.API_KEYS).length === 0,
  };
  const base = (
    slot: PluginSlot,
    install: BaseProvider['install'],
    defaultName: string,
  ): BaseProvider => ({
    install,
    source: providers[slot] !== undefined ? 'application' : 'default',
    name: providers[slot] === false ? 'disabled' : (providers[slot]?.name ?? defaultName),
  });
  const runtime = new PluginRuntime(
    ctx,
    {
      model: base(
        'model',
        providers.model === false
          ? undefined
          : providers.model
            ? () =>
                ctx.plugin(providers.model as Exclude<typeof providers.model, false | undefined>)
            : mock
              ? () => ctx.plugin(modelMockPlugin)
              : () =>
                  ctx.plugin(modelOpenAIPlugin, {
                    baseURL: config.LLM_BASE_URL,
                    apiKey: config.LLM_API_KEY,
                    model: config.LLM_MODEL,
                  }),
        mock ? 'model-mock' : 'model-openai',
      ),
      embedding: base(
        'embedding',
        providers.embedding
          ? () => ctx.plugin(providers.embedding!)
          : () =>
              ctx.plugin(embeddingPlugin, {
                mock,
                baseURL: config.EMBEDDING_BASE_URL,
                apiKey: config.EMBEDDING_API_KEY,
                model: config.EMBEDDING_MODEL,
                dimensions: config.EMBEDDING_DIMENSIONS,
              }),
        mock ? 'embedding-mock' : 'embedding-openai',
      ),
      reranker: base(
        'reranker',
        () => ctx.plugin(providers.reranker ?? rerankerPlugin),
        'reranker',
      ),
      memory: base(
        'memory',
        providers.memory
          ? () => ctx.plugin(providers.memory!)
          : config.MEM0_ENABLED
            ? () =>
                ctx.plugin(memoryMem0Plugin, { url: config.MEM0_URL, apiKey: config.MEM0_API_KEY })
            : () => ctx.plugin(memoryPlugin),
        config.MEM0_ENABLED ? 'memory-mem0' : 'memory',
      ),
      rag: base('rag', () => ctx.plugin(providers.rag ?? ragPlugin), 'rag'),
      decision: base(
        'decision',
        providers.decision
          ? () => ctx.plugin(providers.decision!)
          : () =>
              ctx.plugin(mainModelDecisionPlugin, {
                systemPrompt: prompt,
                contextTokens: config.CONTEXT_TOKEN_BUDGET,
              }),
        'decision-main-model',
      ),
    },
    options.startupTimeoutMs ?? 30000,
  );
  try {
    // Cordis owns scheduling, service activation, dependency invalidation and disposal.
    const fibers = [
      ctx.plugin(observabilityPlugin, {
        enabled: config.OTEL_ENABLED,
        endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
        quiet: options.quiet,
      }),
      providers.storage
        ? ctx.plugin(providers.storage)
        : external
          ? ctx.plugin(storagePostgresPlugin, { url: config.DATABASE_URL })
          : ctx.plugin(storageMemoryPlugin),
      providers.cache
        ? ctx.plugin(providers.cache)
        : external
          ? ctx.plugin(cacheRedisPlugin, { url: config.REDIS_URL })
          : ctx.plugin(cacheMemoryPlugin),
      providers.vector
        ? ctx.plugin(providers.vector)
        : external
          ? ctx.plugin(vectorQdrantPlugin, {
              url: config.QDRANT_URL,
              apiKey: config.QDRANT_API_KEY,
              collection: config.QDRANT_COLLECTION,
              dimensions: mock ? 64 : config.EMBEDDING_DIMENSIONS,
            })
          : ctx.plugin(vectorMemoryPlugin),
      ...pluginManager.mount(ctx, runtime),
      ctx.plugin(eventStorePlugin),
      ctx.plugin(sessionsPlugin),
      ctx.plugin(toolsPlugin),
      ctx.plugin(knowledgeRegistryPlugin),
      ctx.plugin(knowledgeQdrantPlugin),
      ctx.plugin(knowledgeCasesPlugin),
      ctx.plugin(knowledgeToolPlugin),
      ctx.plugin(guardPlugin),
      ...((options.demoTools ?? mock) ? [ctx.plugin(mockBusinessToolsPlugin)] : []),
      (() => {
        const fiber = ctx.plugin(agentLoopPlugin, {
          maxSteps: config.MAX_AGENT_STEPS,
          maxToolCalls: config.MAX_TOOL_CALLS,
          maxRagSearches: config.MAX_RAG_SEARCHES,
          runTimeoutMs: config.RUN_TIMEOUT_MS,
          isPaused: () => pluginManager.changing,
        });
        pluginManager.attachAgent(fiber);
        return fiber;
      })(),
      ctx.plugin(httpH3Plugin),
      ctx.plugin(chatApiPlugin, {
        ...auth,
        getAgent: () => ctx.agent,
        isPaused: () => pluginManager.changing,
      }),
      ctx.plugin(pluginManagerApiPlugin, { ...auth, manager: pluginManager }),
      ctx.plugin(knowledgeApiPlugin, auth),
      ctx.plugin(conversationsApiPlugin, auth),
      ctx.plugin(webStaticPlugin, () => ({
        mode: config.APP_MODE,
        authRequired: !auth.allowAnonymous,
        memoryProvider:
          providers.memory || pluginManager.hasProvider('memory')
            ? 'custom'
            : config.MEM0_ENABLED
              ? 'mem0-oss-rest'
              : 'storage',
        persistence: providers.storage ? 'custom' : external ? 'postgres' : 'memory',
      })),
      ...(options.plugins ?? []).map((plugin) => ctx.plugin(plugin)),
    ];
    await awaitPlugins(ctx, fibers, options.startupTimeoutMs ?? 30000);
    await runtime.ready();
    for (const slot of providerSlots) {
      if (
        (providers[slot] !== false || pluginManager.hasProvider(slot)) &&
        ctx.get(slot) === undefined
      )
        throw new AppError('PROVIDER_NOT_READY', `Provider ${slot} 已激活但未发布对应服务。`);
    }
    if (config.SEED_KNOWLEDGE) await ctx.rag.ingest(demoKnowledge, config.SEED_TENANT_ID);
    ctx.effect(() =>
      ctx.http.get('/health', async () => ({ body: { status: 'ok', mode: config.APP_MODE } })),
    );
    let stopping: Promise<void> | undefined;
    return {
      ctx,
      pluginManager,
      start: () => ctx.http.start(config.PORT, config.HOST),
      stop: () =>
        (stopping ??= (async () => {
          try {
            await pluginManager.close();
            await ctx.http.stop();
            await ctx.agent?.stop();
          } finally {
            await ctx.fiber.dispose();
          }
        })()),
    };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}
