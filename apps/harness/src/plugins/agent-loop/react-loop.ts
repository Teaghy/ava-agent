import type { AgentDependencies } from '../../core/agent/agent-dependencies.js';
import { randomUUID } from 'node:crypto';
import type { AgentService } from '../../core/agent/agent.service.js';
import type { AgentState, AgentInput } from '../../core/agent/agent.types.js';
import type { StreamEvent } from '../../core/http/http.types.js';
import type { AgentResult } from '@ava/protocol';
import type { MemoryItem } from '../../core/memory/memory.types.js';
import { decisionSchema } from '../../core/decision/decision.schema.js';
import { AppError, publicError, checkAbort } from '../../core/errors.js';
export interface AgentConfig {
  maxSteps: number;
  maxToolCalls: number;
  maxRagSearches: number;
  runTimeoutMs: number;
  isPaused?: () => boolean;
}

export function createAgentService(ctx: AgentDependencies, c: AgentConfig): AgentService {
  const lifetime = new AbortController();
  const active = new Set<Promise<AgentResult>>();
  const service: AgentService = {
    async run(input, emit) {
      if (c.isPaused?.())
        throw new AppError('PLUGIN_CHANGE_IN_PROGRESS', '插件正在变更，请稍后重试。', 503);
      if (lifetime.signal.aborted) throw new AppError('AGENT_STOPPED', 'Agent 已停止。', 503);
      const result = execute(input, emit);
      active.add(result);
      try {
        return await result;
      } finally {
        active.delete(result);
      }
    },
    async stop() {
      lifetime.abort();
      await Promise.allSettled(active);
    },
  };
  return service;

  async function execute(
    input: AgentInput,
    emit: (event: StreamEvent) => Promise<void> = async () => {},
  ): Promise<AgentResult> {
    const state: AgentState = {
      runId: randomUUID(),
      conversationId: input.conversationId,
      userId: input.principal.userId,
      goal: input.message,
      entities: {},
      observations: [],
      toolCalls: [],
      retrievedDocuments: [],
      step: 0,
      status: 'running',
    };
    const tenant = input.principal.tenantId;
    const lockKey = `conversation-lock:${input.conversationId}`;
    const signal = AbortSignal.any([
      lifetime.signal,
      AbortSignal.timeout(c.runTimeoutMs),
      ...(input.signal ? [input.signal] : []),
    ]);
    if (!(await ctx.cache.acquire(lockKey, state.runId, 120)))
      throw new AppError('CONVERSATION_BUSY', '此会话正在处理另一个请求。', 409);
    return ctx.telemetry.span(
      'agent.run',
      { run_id: state.runId, conversation_id: state.conversationId },
      async () => {
        let opened = false;
        const append = (
          type: Parameters<AgentDependencies['eventStore']['append']>[2],
          payload: unknown,
        ) => ctx.eventStore.append(state, tenant, type, payload);
        try {
          checkAbort(signal);
          await ctx.sessions.open(state.conversationId, input.principal);
          opened = true;
          await ctx.sessions.checkpoint(state, tenant);
          await ctx.sessions.add(state.conversationId, 'user', input.message);
          await append('user_message', { content: input.message });
          await emit({
            type: 'agent.started',
            data: { runId: state.runId, conversationId: state.conversationId },
          });
          const recent = await ctx.sessions.recent(state.conversationId);
          const summary = await ctx.sessions.summary(state.conversationId);
          let memories: MemoryItem[] = [];
          if (ctx.memory) {
            try {
              memories = await ctx.memory.recall(input.message, {
                ...input.principal,
                limit: 5,
                signal,
              });
              await append('memory_read', { ids: memories.map((m) => m.id) });
            } catch {
              checkAbort(signal);
              ctx.telemetry.log(
                { run_id: state.runId, event: 'memory.unavailable' },
                'optional memory unavailable',
              );
            }
          }
          let ragSearches = 0;
          for (state.step = 1; state.step <= c.maxSteps; state.step++) {
            checkAbort(signal);
            await emit({ type: 'agent.step', data: { step: state.step, phase: 'decision' } });
            const start = performance.now();
            const decision = decisionSchema.parse(
              await ctx.telemetry.span(
                'decision.decide',
                { run_id: state.runId, conversation_id: state.conversationId, step: state.step },
                () =>
                  ctx.decision.decide(
                    structuredClone({
                      message: input.message,
                      goal: state.goal,
                      intent: state.intent,
                      entities: state.entities,
                      availableTools: ctx.tools
                        .list()
                        .filter((tool) => input.principal.permissions.includes(tool.permission)),
                      availableKnowledgeSources: ctx.knowledge.list(),
                    }),
                    {
                      ...structuredClone({
                        runId: state.runId,
                        conversationId: state.conversationId,
                        step: state.step,
                        recentMessages: recent.slice(0, -1),
                        observations: state.observations,
                        memory: memories,
                        summary,
                        retrievedDocuments: state.retrievedDocuments,
                      }),
                      signal,
                    },
                  ),
              ),
            );
            checkAbort(signal);
            ctx.telemetry.log(
              {
                run_id: state.runId,
                step: state.step,
                decision_latency_ms: performance.now() - start,
              },
              'agent decision',
            );
            await append('agent_decision', decision);
            if (decision.type !== 'tool_call') {
              const answer = decision.type === 'ask_user' ? decision.question : decision.answer;
              const citations = decision.type === 'final_answer' ? (decision.citations ?? []) : [];
              if (decision.type === 'final_answer')
                await ctx.guard.validate(answer, citations, state, signal);
              checkAbort(signal);
              await ctx.sessions.add(state.conversationId, 'assistant', answer, {
                citations,
                runId: state.runId,
              });
              await append('assistant_message', { answer, citations });
              state.status = 'completed';
              await ctx.sessions.checkpoint(state, tenant);
              await ctx.sessions.summarize(state.conversationId, signal);
              const result: AgentResult = {
                runId: state.runId,
                answer,
                citations,
                status: decision.type === 'ask_user' ? 'ask_user' : 'completed',
              };
              // Only guarded text is released. Delta segmentation is transport streaming, not raw model reasoning.
              for (const text of answer.match(/[\s\S]{1,80}/gu) ?? []) {
                checkAbort(signal);
                await emit({ type: 'answer.delta', data: { text } });
              }
              await emit({ type: 'answer.completed', data: result });
              return result;
            }
            if (state.toolCalls.length >= c.maxToolCalls)
              throw new AppError('TOOL_LIMIT', '工具调用次数已达上限。', 422);
            const kind = ctx.tools.get(decision.tool)?.kind;
            const isRag = kind === 'retrieval';
            if (isRag && ++ragSearches > c.maxRagSearches)
              throw new AppError('RAG_LIMIT', '知识检索次数已达上限。', 422);
            state.status = 'waiting_tool';
            await ctx.sessions.checkpoint(state, tenant);
            await append('tool_call', decision);
            if (isRag) await append('rag_search', decision.arguments);
            await emit({ type: 'tool.started', data: { tool: decision.tool } });
            let result: unknown;
            let status: 'completed' | 'failed' = 'completed';
            try {
              result = await ctx.tools.execute(decision.tool, decision.arguments, {
                principal: input.principal,
                state,
                signal,
                emit,
              });
            } catch (error) {
              checkAbort(signal);
              status = 'failed';
              result = { error: publicError(error) };
            }
            state.toolCalls.push({
              tool: decision.tool,
              kind,
              arguments: decision.arguments,
              status,
            });
            state.observations.push({ tool: decision.tool, result });
            state.status = 'running';
            await append('tool_result', { tool: decision.tool, result, status });
            if (isRag)
              await append('rag_result', {
                documents: state.retrievedDocuments.map((d) => d.id),
              });
            await ctx.sessions.checkpoint(state, tenant);
            await emit({ type: 'tool.completed', data: { tool: decision.tool, status } });
          }
          throw new AppError('STEP_LIMIT', 'Agent 执行步数已达上限，请补充信息或转人工。', 422);
        } catch (error) {
          state.status = 'failed';
          const safe = signal.aborted
            ? { code: 'RUN_CANCELLED', message: '请求已取消或超时。' }
            : publicError(error);
          if (opened) {
            try {
              await append('error', safe);
              await ctx.sessions.checkpoint(state, tenant);
            } catch {
              ctx.telemetry.log(
                { run_id: state.runId, event: 'checkpoint.failed' },
                'failed to persist error checkpoint',
              );
            }
          }
          ctx.telemetry.log({ run_id: state.runId, error_code: safe.code }, 'agent failed');
          throw signal.aborted ? new AppError(safe.code, safe.message, 408) : error;
        } finally {
          await ctx.cache.release(lockKey, state.runId);
        }
      },
    );
  }
}
