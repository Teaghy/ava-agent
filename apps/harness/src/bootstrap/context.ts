import { Context } from 'cordis';
export type { Context, Plugin } from 'cordis';
import type { KnowledgeSource, KnowledgeRegistryService } from '../core/rag/knowledge-source.js';
import type * as C from '../core/index.js';
declare module 'cordis' {
  interface Context {
    agent: C.AgentService;
    decision: C.DecisionService;
    model: C.ModelService;
    tools: C.ToolService;
    sessions: C.SessionService;
    storage: C.StorageService;
    cache: C.CacheService;
    vector: C.VectorService;
    embedding: C.EmbeddingService;
    reranker: C.RerankerService;
    rag: C.RagService;
    knowledge: KnowledgeRegistryService;
    qdrantKnowledge: KnowledgeSource;
    memory: C.MemoryService;
    eventStore: C.EventStoreService;
    guard: C.GuardService;
    http: C.HttpService;
    telemetry: C.TelemetryService;
  }
  interface Events {
    'harness/event'(event: C.AgentEvent): void;
  }
}
export function createContext(): Context {
  return new Context();
}
