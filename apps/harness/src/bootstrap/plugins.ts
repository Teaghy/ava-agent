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
export async function createHarness(config: Config, options: { quiet?: boolean } = {}) {
  const ctx = createContext();
  const mock = config.APP_MODE === 'mock';
  const external = config.APP_MODE === 'live' || config.INFRA_MODE === 'external';
  const prompt = await readFile(new URL('../prompts/system.md', import.meta.url), 'utf8');
  const auth = {
    keys: config.API_KEYS,
    allowAnonymous:
      mock && config.NODE_ENV !== 'production' && Object.keys(config.API_KEYS).length === 0,
  };
  try {
    // Cordis owns scheduling, service activation, dependency invalidation and disposal.
    const fibers = [
      ctx.plugin(observabilityPlugin, {
        enabled: config.OTEL_ENABLED,
        endpoint: config.OTEL_EXPORTER_OTLP_ENDPOINT,
        ...options,
      }),
      external
        ? ctx.plugin(storagePostgresPlugin, { url: config.DATABASE_URL })
        : ctx.plugin(storageMemoryPlugin),
      external
        ? ctx.plugin(cacheRedisPlugin, { url: config.REDIS_URL })
        : ctx.plugin(cacheMemoryPlugin),
      external
        ? ctx.plugin(vectorQdrantPlugin, {
            url: config.QDRANT_URL,
            apiKey: config.QDRANT_API_KEY,
            collection: config.QDRANT_COLLECTION,
            dimensions: mock ? 64 : config.EMBEDDING_DIMENSIONS,
          })
        : ctx.plugin(vectorMemoryPlugin),
      mock
        ? ctx.plugin(modelMockPlugin)
        : ctx.plugin(modelOpenAIPlugin, {
            baseURL: config.LLM_BASE_URL,
            apiKey: config.LLM_API_KEY,
            model: config.LLM_MODEL,
          }),
      ctx.plugin(embeddingPlugin, {
        mock,
        baseURL: config.EMBEDDING_BASE_URL,
        apiKey: config.EMBEDDING_API_KEY,
        model: config.EMBEDDING_MODEL,
        dimensions: config.EMBEDDING_DIMENSIONS,
      }),
      ctx.plugin(rerankerPlugin),
      ctx.plugin(eventStorePlugin),
      ctx.plugin(sessionsPlugin),
      ctx.plugin(toolsPlugin),
      ctx.plugin(knowledgeRegistryPlugin),
      ctx.plugin(knowledgeQdrantPlugin),
      ctx.plugin(knowledgeCasesPlugin),
      ctx.plugin(ragPlugin),
      config.MEM0_ENABLED
        ? ctx.plugin(memoryMem0Plugin, { url: config.MEM0_URL, apiKey: config.MEM0_API_KEY })
        : ctx.plugin(memoryPlugin),
      ctx.plugin(knowledgeToolPlugin),
      ctx.plugin(mockBusinessToolsPlugin),
      ctx.plugin(guardPlugin),
      ctx.plugin(mainModelDecisionPlugin, {
        systemPrompt: prompt,
        contextTokens: config.CONTEXT_TOKEN_BUDGET,
      }),
      ctx.plugin(agentLoopPlugin, {
        maxSteps: config.MAX_AGENT_STEPS,
        maxToolCalls: config.MAX_TOOL_CALLS,
        maxRagSearches: config.MAX_RAG_SEARCHES,
        runTimeoutMs: config.RUN_TIMEOUT_MS,
      }),
      ctx.plugin(httpH3Plugin),
      ctx.plugin(chatApiPlugin, auth),
      ctx.plugin(knowledgeApiPlugin, auth),
      ctx.plugin(conversationsApiPlugin, auth),
      ctx.plugin(webStaticPlugin, {
        mode: config.APP_MODE,
        authRequired: !auth.allowAnonymous,
        memoryProvider: config.MEM0_ENABLED ? 'mem0-oss-rest' : 'storage',
        persistence: external ? 'postgres' : 'memory',
      }),
    ];
    await Promise.all(fibers);
    if (config.SEED_KNOWLEDGE) await ctx.rag.ingest(demoKnowledge, config.SEED_TENANT_ID);
    ctx.http.get('/health', async () => ({ body: { status: 'ok', mode: config.APP_MODE } }));
    return {
      ctx,
      start: () => ctx.http.start(config.PORT, config.HOST),
      stop: () => ctx.fiber.dispose(),
    };
  } catch (error) {
    await ctx.fiber.dispose();
    throw error;
  }
}
