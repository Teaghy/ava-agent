import type { CacheService } from '../cache/cache.service.js';
import type { DecisionService } from '../decision/decision.service.js';
import type { EventStoreService } from '../event/event-store.service.js';
import type { GuardService } from '../guard/guard.service.js';
import type { MemoryService } from '../memory/memory.service.js';
import type { TelemetryService } from '../observability/telemetry.service.js';
import type { KnowledgeRegistryService } from '../rag/knowledge-source.js';
import type { SessionService } from '../session/session.service.js';
import type { ToolService } from '../tools/tool.js';
import type { AnswerService } from '../answer/answer.service.js';

/** The default runtime's domain dependencies; no plugin framework or provider SDK. */
export interface AgentDependencies {
  decision: DecisionService;
  knowledge: KnowledgeRegistryService;
  tools: ToolService;
  sessions: SessionService;
  eventStore: EventStoreService;
  cache: CacheService;
  telemetry: TelemetryService;
  guard: GuardService;
  getAnswer?: () => AnswerService | undefined;
  memory?: MemoryService;
}
