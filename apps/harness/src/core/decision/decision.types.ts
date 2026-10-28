import type { AgentObservation } from '../agent/agent.types.js';
import type { ConversationSummary, Message } from '../session/session.types.js';
import type { MemoryItem } from '../memory/memory.types.js';
import type { RetrievedDocument } from '../rag/retrieval.types.js';
import type { KnowledgeSource } from '../rag/knowledge-source.js';
import type { ToolDescriptor } from '../tools/tool.types.js';

export interface DecisionInput {
  message: string;
  goal?: string;
  intent?: string;
  entities: Record<string, unknown>;
  availableTools: ToolDescriptor[];
  availableKnowledgeSources: Pick<KnowledgeSource, 'name' | 'description' | 'default'>[];
}
export interface DecisionContext {
  runId: string;
  conversationId: string;
  step: number;
  recentMessages: Message[];
  observations: AgentObservation[];
  memory: MemoryItem[];
  summary?: ConversationSummary;
  retrievedDocuments: RetrievedDocument[];
  signal: AbortSignal;
}
