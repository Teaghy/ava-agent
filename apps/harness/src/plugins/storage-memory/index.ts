import type { Context } from 'cordis';
import type { AgentEvent } from '../../core/event/agent-event.js';
import type { Conversation as ConversationInfo, RunQuery, RunSummary } from '@ava/protocol';
import type { AgentState } from '../../core/agent/agent.types.js';
import type { AuditLog } from '../../core/tools/tool.types.js';
import type { ConversationSummary, Message } from '../../core/session/session.types.js';
import type { KnowledgeDocument, RetrievedDocument } from '../../core/rag/retrieval.types.js';
import type { MemoryItem, RecallOptions } from '../../core/memory/memory.types.js';
import type { Principal, Metadata } from '../../core/common.types.js';
import type { StorageService } from '../../core/storage/storage.service.js';
import { AppError } from '../../core/errors.js';
export class InMemoryStorage implements StorageService {
  readonly conversations = new Map<string, Principal>();
  private conversationDates = new Map<string, string>();
  async listConversations(p: Principal, limit: number): Promise<ConversationInfo[]> {
    return [...this.conversations]
      .filter(([, owner]) => owner.tenantId === p.tenantId && owner.userId === p.userId)
      .map(([id]) => {
        const messages = this.messageRows.filter((m) => m.conversationId === id);
        const createdAt = this.conversationDates.get(id) ?? new Date().toISOString();
        return {
          id,
          title: messages.find((m) => m.role === 'user')?.content.slice(0, 60) ?? '新对话',
          createdAt,
          updatedAt: messages.at(-1)?.createdAt ?? createdAt,
        };
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }
  readonly messageRows: Message[] = [];
  readonly eventRows: AgentEvent[] = [];
  readonly audits: AuditLog[] = [];
  readonly summaries = new Map<string, ConversationSummary>();
  readonly runs = new Map<string, AgentState>();
  private runDates = new Map<string, { tenantId: string; createdAt: string }>();
  readonly chunks = new Map<string, RetrievedDocument[]>();
  readonly memories = new Map<string, MemoryItem>();
  async assertConversation(id: string, p: Principal): Promise<void> {
    const old = this.conversations.get(id);
    if (!old) throw new AppError('NOT_FOUND', '会话不存在。', 404);
    if (old.tenantId !== p.tenantId || old.userId !== p.userId)
      throw new AppError('FORBIDDEN', '无权访问此会话。', 403);
  }
  async ensureConversation(id: string, p: Principal): Promise<void> {
    const old = this.conversations.get(id);
    if (old && (old.tenantId !== p.tenantId || old.userId !== p.userId))
      throw new AppError('FORBIDDEN', '无权访问此会话。', 403);
    this.conversations.set(id, structuredClone(p));
    if (!this.conversationDates.has(id)) this.conversationDates.set(id, new Date().toISOString());
  }
  async addMessage(m: Message): Promise<void> {
    this.messageRows.push(structuredClone(m));
  }
  async messages(id: string, limit: number): Promise<Message[]> {
    return structuredClone(this.messageRows.filter((m) => m.conversationId === id).slice(-limit));
  }
  async summary(id: string): Promise<ConversationSummary | undefined> {
    return structuredClone(this.summaries.get(id));
  }
  async saveSummary(s: ConversationSummary): Promise<void> {
    this.summaries.set(s.conversationId, structuredClone(s));
  }
  async saveRun(s: AgentState, tenantId: string): Promise<void> {
    this.runs.set(s.runId, structuredClone(s));
    if (!this.runDates.has(s.runId))
      this.runDates.set(s.runId, { tenantId, createdAt: new Date().toISOString() });
  }
  async listRuns(q: RunQuery): Promise<RunSummary[]> {
    const rows: RunSummary[] = [];
    for (const [runId, state] of this.runs) {
      const date = this.runDates.get(runId);
      if (
        !date ||
        date.tenantId !== q.tenantId ||
        (q.runId && q.runId !== runId) ||
        (q.conversationId && q.conversationId !== state.conversationId) ||
        (q.status && q.status !== state.status) ||
        (q.since && Date.parse(date.createdAt) < Date.parse(q.since)) ||
        (q.until && Date.parse(date.createdAt) > Date.parse(q.until))
      )
        continue;
      rows.push({
        runId,
        tenantId: date.tenantId,
        conversationId: state.conversationId,
        userId: state.userId ?? '',
        question: (state.goal ?? '').slice(0, 300),
        status: state.status,
        step: state.step,
        createdAt: date.createdAt,
        updatedAt:
          this.eventRows.findLast((e) => e.runId === runId && e.tenantId === q.tenantId)
            ?.createdAt ?? date.createdAt,
      });
    }
    return rows
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId))
      .slice(q.offset, q.offset + q.limit);
  }
  async appendEvent(e: AgentEvent): Promise<void> {
    if (this.eventRows.some((row) => row.id === e.id))
      throw new AppError('DUPLICATE_EVENT', '事件已存在。');
    this.eventRows.push(structuredClone(e));
  }
  async events(id: string, tenant: string): Promise<AgentEvent[]> {
    return structuredClone(this.eventRows.filter((e) => e.runId === id && e.tenantId === tenant));
  }
  async audit(a: AuditLog): Promise<void> {
    this.audits.push(structuredClone(a));
  }
  async saveKnowledge(
    d: KnowledgeDocument,
    tenant: string,
    chunks: RetrievedDocument[],
  ): Promise<void> {
    this.chunks.set(JSON.stringify([tenant, d.id]), structuredClone(chunks));
  }
  async knowledgeChunks(id: string, tenant: string): Promise<RetrievedDocument[]> {
    return structuredClone(this.chunks.get(JSON.stringify([tenant, id])) ?? []);
  }
  async keywordSearch(
    query: string,
    tenant: string,
    filter: Metadata,
    limit: number,
  ): Promise<RetrievedDocument[]> {
    const terms = query.toLowerCase().match(/[a-z0-9-]+|[\u4e00-\u9fff]{1,2}/g) ?? [];
    return [...this.chunks.values()]
      .flat()
      .filter(
        (d) =>
          d.tenantId === tenant && Object.entries(filter).every(([k, v]) => d.metadata[k] === v),
      )
      .map((d) => ({
        ...d,
        score:
          terms.filter((t) => `${d.title} ${d.content}`.toLowerCase().includes(t)).length /
          Math.max(terms.length, 1),
      }))
      .filter((d) => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
  async remember(m: MemoryItem): Promise<void> {
    this.memories.set(m.id, structuredClone(m));
  }
  async recall(o: RecallOptions): Promise<MemoryItem[]> {
    return structuredClone(
      [...this.memories.values()].filter((m) => m.tenantId === o.tenantId && m.userId === o.userId),
    );
  }
  async forget(id: string, o: RecallOptions): Promise<void> {
    const m = this.memories.get(id);
    if (m?.tenantId === o.tenantId && m.userId === o.userId) this.memories.delete(id);
  }
}
export const storageMemoryPlugin = {
  name: 'storage-memory',
  provide: ['storage'],
  apply(ctx: Context) {
    ctx.provide('storage', new InMemoryStorage());
  },
};
