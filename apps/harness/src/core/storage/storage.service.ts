import type { AgentState } from '../agent/agent.types.js';
import type { Metadata, Principal } from '../common.types.js';
import type { AgentEvent } from '../event/agent-event.js';
import type { MemoryItem, RecallOptions } from '../memory/memory.types.js';
import type { KnowledgeDocument, RetrievedDocument } from '../rag/retrieval.types.js';
import type { ConversationSummary, Message } from '../session/session.types.js';
import type { AuditLog } from '../tools/tool.types.js';
import type { Conversation as ConversationInfo, RunQuery, RunSummary } from '@ava/protocol';
export interface StorageService {
  listRuns(query: RunQuery): Promise<RunSummary[]>;
  listConversations(principal: Principal, limit: number): Promise<ConversationInfo[]>;
  assertConversation(id: string, principal: Principal): Promise<void>;
  ensureConversation(id: string, principal: Principal): Promise<void>;
  addMessage(message: Message): Promise<void>;
  messages(id: string, limit: number): Promise<Message[]>;
  summary(id: string): Promise<ConversationSummary | undefined>;
  saveSummary(summary: ConversationSummary): Promise<void>;
  saveRun(state: AgentState, tenantId: string): Promise<void>;
  appendEvent(event: AgentEvent): Promise<void>;
  events(runId: string, tenantId: string): Promise<AgentEvent[]>;
  audit(log: AuditLog): Promise<void>;
  saveKnowledge(
    document: KnowledgeDocument,
    tenantId: string,
    chunks: RetrievedDocument[],
  ): Promise<void>;
  knowledgeChunks(documentId: string, tenantId: string): Promise<RetrievedDocument[]>;
  keywordSearch(
    query: string,
    tenantId: string,
    filter: Metadata,
    limit: number,
  ): Promise<RetrievedDocument[]>;
  remember(item: MemoryItem): Promise<void>;
  recall(owner: RecallOptions): Promise<MemoryItem[]>;
  forget(id: string, owner: RecallOptions): Promise<void>;
}
