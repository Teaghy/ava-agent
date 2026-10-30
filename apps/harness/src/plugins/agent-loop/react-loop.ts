import type { AgentDependencies } from '../../core/agent/agent-dependencies.js';
import { randomUUID } from 'node:crypto';
import type { AgentService } from '../../core/agent/agent.service.js';
import type { AgentState, AgentInput } from '../../core/agent/agent.types.js';
import type { StreamEvent } from '../../core/http/http.types.js';
import type { AgentResult } from '@ava/protocol';
import type { MemoryItem } from '../../core/memory/memory.types.js';
import { decisionSchema } from '../../core/decision/decision.schema.js';
import { AppError, publicError, checkAbort } from '../../core/errors.js';
import { ToolAuditError } from '../../core/tools/tool-audit-error.js';
export interface AgentConfig {
  maxSteps: number;
  maxToolCalls: number;
  maxRagSearches: number;
  runTimeoutMs: number;
  isPaused?: () => boolean;
  insufficientEvidenceReply?: string;
  streamAnswers?: boolean;
}

export function createAgentService(ctx: AgentDependencies, c: AgentConfig): AgentService {
  const lifetime = new AbortController();
  const active = new Set<Promise<AgentResult>>();
  const summaries = new Map<string, Promise<void>>();
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
      await Promise.allSettled(summaries.values());
    },
  };
  return service;

  function summarize(conversationId: string, runId: string): void {
    // shortcut: summary ordering is local; use a shared queue when running multiple workers.
    const pending = (summaries.get(conversationId) ?? Promise.resolve())
      .then(() => {
        checkAbort(lifetime.signal);
        return ctx.sessions.summarize(conversationId, lifetime.signal);
      })
      .catch(() => {
        if (!lifetime.signal.aborted)
          ctx.telemetry.log(
            { event: 'summary.failed', run_id: runId, conversation_id: conversationId },
            'optional conversation summary unavailable',
          );
      })
      .finally(() => {
        if (summaries.get(conversationId) === pending) summaries.delete(conversationId);
      });
    summaries.set(conversationId, pending);
  }

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
        let phase = 'prepare';
        let phaseStart = performance.now();
        let streamedChars = 0;
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
            phase = 'decision';
            phaseStart = start;
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
            await append('execution_span', {
              phase,
              step: state.step,
              durationMs: performance.now() - start,
            });
            if (decision.type !== 'tool_call') {
              let answer =
                decision.type === 'ask_user'
                  ? decision.question
                  : decision.type === 'answer_ready'
                    ? '根据本次已验证的依据生成答复。'
                    : decision.answer;
              let citations = decision.type === 'ask_user' ? [] : (decision.citations ?? []);
              let responseType: 'final_answer' | 'ask_user' =
                decision.type === 'ask_user' ? 'ask_user' : 'final_answer';
              let fallbackReason: string | undefined;
              const live =
                decision.type === 'answer_ready' &&
                c.streamAnswers === true &&
                ctx.guard.canStream?.() === true &&
                !state.toolCalls.some((call) => call.kind !== 'retrieval');
              phase = 'guard';
              phaseStart = performance.now();
              const validateAnswer = async () => {
                try {
                  await ctx.guard.validate(answer, citations, state, signal, responseType);
                } catch (error) {
                  if (
                    !(error instanceof AppError) ||
                    error.code !== 'LOW_CONFIDENCE' ||
                    streamedChars > 0 ||
                    !c.insufficientEvidenceReply
                  )
                    throw error;
                  answer = c.insufficientEvidenceReply;
                  citations = [];
                  responseType = 'ask_user';
                  fallbackReason = error.code;
                  await ctx.guard.validate(answer, citations, state, signal, responseType);
                }
              };
              if (decision.type !== 'answer_ready' || live) {
                await validateAnswer();
                checkAbort(signal);
                await append('execution_span', {
                  phase,
                  step: state.step,
                  durationMs: performance.now() - phaseStart,
                  ...(fallbackReason ? { outcome: 'scope_reply', reason: fallbackReason } : {}),
                });
              }
              if (decision.type === 'answer_ready' && !fallbackReason) {
                const generator = ctx.getAnswer?.();
                if (!generator)
                  throw new AppError('MODEL_UNAVAILABLE', '当前未配置回答生成模型。', 503);
                phase = 'answer';
                phaseStart = performance.now();
                await emit({ type: 'agent.step', data: { step: state.step, phase } });
                const request = {
                  message: input.message,
                  state: {
                    retrievedDocuments: state.retrievedDocuments.filter((doc) =>
                      citations.some(
                        (citation) =>
                          citation.chunkId === doc.id && citation.documentId === doc.documentId,
                      ),
                    ),
                    observations: state.observations.filter((observation) =>
                      state.toolCalls.some(
                        (call) =>
                          call.tool === observation.tool &&
                          call.kind !== 'retrieval' &&
                          call.status === 'completed',
                      ),
                    ),
                  },
                  recent: recent.slice(0, -1),
                  summary,
                  memories,
                  signal,
                  runId: state.runId,
                  conversationId: state.conversationId,
                };
                answer = '';
                let firstTokenMs: number | undefined;
                for await (const delta of generator.stream(request)) {
                  checkAbort(signal);
                  if (!delta.text) continue;
                  if (answer.length + delta.text.length > 16000)
                    throw new AppError('ANSWER_LIMIT', '回答超过长度上限，请缩小问题范围。', 502);
                  firstTokenMs ??= performance.now() - phaseStart;
                  answer += delta.text;
                  if (live) {
                    streamedChars += delta.text.length;
                    await emit({ type: 'answer.delta', data: { text: delta.text } });
                  }
                }
                checkAbort(signal);
                if (!answer.trim())
                  throw new AppError('INVALID_MODEL_OUTPUT', '模型未生成有效的回答。', 502);
                await append('execution_span', {
                  phase,
                  step: state.step,
                  durationMs: performance.now() - phaseStart,
                  delivery: live ? 'stream' : 'buffered',
                  firstTokenMs,
                  outputChars: answer.length,
                });
                phase = 'guard';
                phaseStart = performance.now();
                await validateAnswer();
                await append('execution_span', {
                  phase,
                  step: state.step,
                  durationMs: performance.now() - phaseStart,
                });
              }
              phase = 'answer';
              phaseStart = performance.now();
              await ctx.sessions.add(state.conversationId, 'assistant', answer, {
                citations,
                runId: state.runId,
              });
              await append('assistant_message', { answer, citations });
              state.status = 'completed';
              await ctx.sessions.checkpoint(state, tenant);
              const result: AgentResult = {
                runId: state.runId,
                answer,
                citations,
                status: responseType === 'ask_user' ? 'ask_user' : 'completed',
              };
              // Buffered/legacy replies are released only after validation; live deltas were already sent.
              for (const text of streamedChars ? [] : (answer.match(/[\s\S]{1,80}/gu) ?? [])) {
                checkAbort(signal);
                await emit({ type: 'answer.delta', data: { text } });
              }
              await emit({ type: 'answer.completed', data: result });
              summarize(state.conversationId, state.runId);
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
            let auditFailure: ToolAuditError | undefined;
            phase = 'tool';
            phaseStart = performance.now();
            try {
              result = await ctx.tools.execute(decision.tool, decision.arguments, {
                principal: input.principal,
                state,
                signal,
                emit,
              });
            } catch (error) {
              if (error instanceof ToolAuditError) {
                auditFailure = error;
                status = error.audit.status === 'completed' ? 'completed' : 'failed';
                result = status === 'completed' ? error.result : { error: publicError(error) };
              } else {
                checkAbort(signal);
                status = 'failed';
                result = { error: publicError(error) };
              }
            }
            state.toolCalls.push({
              tool: decision.tool,
              kind,
              arguments: decision.arguments,
              status,
            });
            state.observations.push({ tool: decision.tool, result });
            if (auditFailure) throw auditFailure;
            state.status = 'running';
            await append('tool_result', {
              tool: decision.tool,
              result,
              status,
              step: state.step,
              durationMs: performance.now() - phaseStart,
            });
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
          const cancelled = signal.aborted && !(error instanceof ToolAuditError);
          const safe = cancelled
            ? { code: 'RUN_CANCELLED', message: '请求已取消或超时。' }
            : publicError(error);
          if (opened) {
            try {
              await append('error', {
                ...safe,
                phase,
                step: state.step,
                durationMs: performance.now() - phaseStart,
                partialAnswer: streamedChars > 0,
                outputChars: streamedChars,
              });
              await ctx.sessions.checkpoint(state, tenant);
            } catch {
              ctx.telemetry.log(
                { run_id: state.runId, event: 'checkpoint.failed' },
                'failed to persist error checkpoint',
              );
            }
          }
          ctx.telemetry.log({ run_id: state.runId, error_code: safe.code }, 'agent failed');
          throw cancelled ? new AppError(safe.code, safe.message, 408) : error;
        } finally {
          await ctx.cache.release(lockKey, state.runId);
        }
      },
    );
  }
}
