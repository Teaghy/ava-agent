import { type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, desc, asc, sql, gte, lte } from 'drizzle-orm';
import type { StorageService } from '../../core/storage/storage.service.js';
import type { Conversation as ConversationInfo, RunQuery, RunSummary } from '@ava/protocol';
import type { Principal, Metadata } from '../../core/common.types.js';
import type { Message, ConversationSummary } from '../../core/session/session.types.js';
import type { AgentState } from '../../core/agent/agent.types.js';
import type { AgentEvent } from '../../core/event/agent-event.js';
import type { AuditLog } from '../../core/tools/tool.types.js';
import type { KnowledgeDocument, RetrievedDocument } from '../../core/rag/retrieval.types.js';
import type { MemoryItem, RecallOptions } from '../../core/memory/memory.types.js';
import { AppError } from '../../core/errors.js';
import * as s from './schema/index.js';
export class PostgresStorage implements StorageService {
  constructor(private db: NodePgDatabase<typeof s>) {}
  async listRuns(q: RunQuery): Promise<RunSummary[]> {
    return this.db
      .select({
        runId: s.runs.id,
        tenantId: s.runs.tenantId,
        conversationId: s.runs.conversationId,
        userId: sql<string>`coalesce(${s.runs.state}->>'userId', '')`,
        question: sql<string>`left(coalesce(${s.runs.state}->>'goal', ''), 300)`,
        status: sql<RunSummary['status']>`${s.runs.state}->>'status'`,
        step: sql<number>`(${s.runs.state}->>'step')::integer`,
        createdAt: s.runs.createdAt,
        updatedAt: sql<string>`coalesce((select created_at from agent_events where run_id = ${s.runs.id} and tenant_id = ${s.runs.tenantId} order by sequence desc limit 1), ${s.runs.createdAt})::text`,
      })
      .from(s.runs)
      .where(
        and(
          eq(s.runs.tenantId, q.tenantId),
          q.runId ? eq(s.runs.id, q.runId) : undefined,
          q.conversationId ? eq(s.runs.conversationId, q.conversationId) : undefined,
          q.status ? sql`${s.runs.state}->>'status' = ${q.status}` : undefined,
          q.since ? gte(s.runs.createdAt, q.since) : undefined,
          q.until ? lte(s.runs.createdAt, q.until) : undefined,
        ),
      )
      .orderBy(desc(s.runs.createdAt), desc(s.runs.id))
      .limit(q.limit)
      .offset(q.offset);
  }
  async assertConversation(id: string, p: Principal): Promise<void> {
    const [row] = await this.db.select().from(s.conversations).where(eq(s.conversations.id, id));
    if (!row) throw new AppError('NOT_FOUND', '会话不存在。', 404);
    if (row.tenantId !== p.tenantId || row.userId !== p.userId)
      throw new AppError('FORBIDDEN', '无权访问此会话。', 403);
  }
  async listConversations(p: Principal, limit: number): Promise<ConversationInfo[]> {
    const updatedAt = sql<string>`coalesce((select max(created_at) from messages where conversation_id = ${s.conversations.id}), ${s.conversations.createdAt})::text`;
    return this.db
      .select({
        id: s.conversations.id,
        createdAt: s.conversations.createdAt,
        updatedAt,
        title: sql<string>`coalesce((select left(content, 60) from messages where conversation_id = ${s.conversations.id} and role = 'user' order by sequence limit 1), '新对话')`,
      })
      .from(s.conversations)
      .where(and(eq(s.conversations.tenantId, p.tenantId), eq(s.conversations.userId, p.userId)))
      .orderBy(desc(updatedAt))
      .limit(limit);
  }
  async ensureConversation(id: string, p: Principal): Promise<void> {
    await this.db
      .insert(s.users)
      .values({
        id: JSON.stringify([p.tenantId, p.userId]),
        tenantId: p.tenantId,
        externalId: p.userId,
      })
      .onConflictDoNothing();
    await this.db
      .insert(s.conversations)
      .values({ id, tenantId: p.tenantId, userId: p.userId })
      .onConflictDoNothing();
    const [row] = await this.db.select().from(s.conversations).where(eq(s.conversations.id, id));
    if (!row || row.tenantId !== p.tenantId || row.userId !== p.userId)
      throw new AppError('FORBIDDEN', '无权访问此会话。', 403);
  }
  async addMessage(m: Message): Promise<void> {
    await this.db.insert(s.messages).values(m);
  }
  async messages(id: string, limit: number): Promise<Message[]> {
    return (
      await this.db
        .select()
        .from(s.messages)
        .where(eq(s.messages.conversationId, id))
        .orderBy(desc(s.messages.sequence))
        .limit(limit)
    ).reverse();
  }
  async summary(id: string): Promise<ConversationSummary | undefined> {
    return (await this.db.select().from(s.summaries).where(eq(s.summaries.conversationId, id)))[0]
      ?.data;
  }
  async saveSummary(data: ConversationSummary): Promise<void> {
    await this.db
      .insert(s.summaries)
      .values({ conversationId: data.conversationId, data })
      .onConflictDoUpdate({ target: s.summaries.conversationId, set: { data } });
  }
  async saveRun(state: AgentState, tenantId: string): Promise<void> {
    await this.db
      .insert(s.runs)
      .values({ id: state.runId, conversationId: state.conversationId, tenantId, state })
      .onConflictDoUpdate({ target: s.runs.id, set: { state } });
  }
  async appendEvent(e: AgentEvent): Promise<void> {
    await this.db.insert(s.events).values(e);
  }
  async events(runId: string, tenantId: string): Promise<AgentEvent[]> {
    const rows = await this.db
      .select()
      .from(s.events)
      .where(and(eq(s.events.runId, runId), eq(s.events.tenantId, tenantId)))
      .orderBy(asc(s.events.sequence));
    return rows.map((r) => ({ ...r, type: r.type as AgentEvent['type'] }));
  }
  async audit(a: AuditLog): Promise<void> {
    await this.db.insert(s.audits).values(a);
  }
  async saveKnowledge(
    d: KnowledgeDocument,
    tenantId: string,
    data: RetrievedDocument[],
  ): Promise<void> {
    const key = JSON.stringify([tenantId, d.id]);
    await this.db.transaction(async (tx) => {
      const values = { ...d, key, tenantId };
      await tx
        .insert(s.documents)
        .values(values)
        .onConflictDoUpdate({ target: s.documents.key, set: values });
      await tx.delete(s.chunks).where(eq(s.chunks.documentKey, key));
      if (data.length)
        await tx.insert(s.chunks).values(
          data.map((c) => ({
            id: c.id,
            documentKey: key,
            tenantId,
            content: c.content,
            metadata: c.metadata,
            data: c,
          })),
        );
    });
  }
  async keywordSearch(
    query: string,
    tenant: string,
    filters: Metadata,
    limit: number,
  ): Promise<RetrievedDocument[]> {
    const terms = query.match(/[a-zA-Z0-9-]+|[\u4e00-\u9fff]{1,2}/g)?.slice(0, 32) ?? [];
    if (!terms.length) return [];
    const scores = terms.map(
      (t) =>
        sql`case when ${s.chunks.content} ilike ${`%${t.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`} then 1 else 0 end`,
    );
    const score = sql<number>`(${sql.join(scores, sql` + `)})`;
    const rows = await this.db
      .select({ data: s.chunks.data, score })
      .from(s.chunks)
      .where(
        and(
          eq(s.chunks.tenantId, tenant),
          sql`${s.chunks.metadata} @> ${JSON.stringify(filters)}::jsonb`,
          sql`${score} > 0`,
        ),
      )
      .orderBy(desc(score))
      .limit(limit);
    return rows.map((r) => ({ ...r.data, score: Number(r.score) / terms.length }));
  }
  async knowledgeChunks(id: string, tenant: string): Promise<RetrievedDocument[]> {
    return (
      await this.db
        .select({ data: s.chunks.data })
        .from(s.chunks)
        .where(
          and(
            eq(s.chunks.tenantId, tenant),
            eq(s.chunks.documentKey, JSON.stringify([tenant, id])),
          ),
        )
    ).map((r) => r.data);
  }
  async remember(data: MemoryItem): Promise<void> {
    await this.db
      .insert(s.memories)
      .values({ id: data.id, tenantId: data.tenantId, userId: data.userId, data });
  }
  async recall(o: RecallOptions): Promise<MemoryItem[]> {
    return (
      await this.db
        .select()
        .from(s.memories)
        .where(and(eq(s.memories.tenantId, o.tenantId), eq(s.memories.userId, o.userId)))
        .limit(100)
    ).map((r) => r.data);
  }
  async forget(id: string, o: RecallOptions): Promise<void> {
    await this.db
      .delete(s.memories)
      .where(
        and(
          eq(s.memories.id, id),
          eq(s.memories.tenantId, o.tenantId),
          eq(s.memories.userId, o.userId),
        ),
      );
  }
}
