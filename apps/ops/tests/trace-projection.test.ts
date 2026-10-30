import { describe, expect, it } from 'vitest';
import type { RunDetail, RunEvent } from '@ava/protocol';
import { groupTrace, projectTrace, timelineDomain } from '../src/pages/trace-projection';
const event = (id: string, type: string, seconds: number, payload: unknown = {}): RunEvent => ({
  id,
  type,
  createdAt: new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString(),
  payload,
});
const detail = (events: RunEvent[]): RunDetail => ({
  run: {
    runId: 'run',
    tenantId: 'tenant',
    userId: 'user',
    conversationId: 'conversation',
    question: 'question',
    status: 'completed',
    step: 2,
    createdAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1) + 20000).toISOString(),
  },
  events,
});
describe('Ops trajectory projection', () => {
  it('folds measured decision spans once while preserving ledger IDs, ordering and lane selection', () => {
    const input = detail([
      event('checkpoint', 'checkpoint', 0),
      event('input', 'user_message', 0, { content: 'question' }),
      event('decision', 'agent_decision', 3, { type: 'tool_call', tool: 'knowledge_search' }),
      event('decision-time', 'execution_span', 3.1, {
        phase: 'decision',
        step: 1,
        durationMs: 3000,
      }),
      event('call', 'tool_call', 3.2, { tool: 'knowledge_search' }),
      event('search', 'rag_search', 3.3, { query: 'query' }),
      event('result', 'tool_result', 6, {
        step: 1,
        tool: 'knowledge_search',
        status: 'completed',
        durationMs: 2700,
      }),
      event('next-decision', 'agent_decision', 7, { type: 'answer_ready' }),
      event('next-time', 'execution_span', 7.1, { phase: 'decision', step: 2, durationMs: 900 }),
      event('answer', 'execution_span', 10, {
        phase: 'answer',
        step: 2,
        durationMs: 2900,
        firstTokenMs: 900,
        delivery: 'stream',
      }),
      event('saved', 'assistant_message', 10.1, { answer: 'answer' }),
    ]);
    const original = structuredClone(input);
    const records = projectTrace(input);
    expect(records.map((record) => record.event.id)).toEqual([
      'input',
      'decision',
      'call',
      'search',
      'result',
      'next-decision',
      'answer',
      'saved',
    ]);
    expect(records.map((record) => record.lane)).toEqual([
      'input',
      'model',
      'tool',
      'tool',
      'tool',
      'model',
      'model',
      'model',
    ]);
    expect(records.find((record) => record.event.id === 'decision')).toMatchObject({
      durationMs: 3000,
      step: 1,
      start: Date.UTC(2026, 0, 1) + 100,
      end: Date.UTC(2026, 0, 1) + 3100,
    });
    expect(records.find((record) => record.event.id === 'answer')).toMatchObject({
      step: 2,
      firstTokenMs: 900,
    });
    expect(groupTrace(records).map((group) => group.step)).toEqual([0, 1, 2]);
    expect(projectTrace(input, true)[0]?.event.id).toBe('checkpoint');
    expect(input).toEqual(original);
  });
  it('keeps failed tools and phase-specific errors visible without inventing successful completion', () => {
    const records = projectTrace(
      detail([
        event('tool', 'tool_result', 1, { tool: 'lookup', status: 'failed', durationMs: 100 }),
        event('model-error', 'error', 2, {
          phase: 'decision',
          message: 'Model unavailable',
          code: 'MODEL_UNAVAILABLE',
          durationMs: 500,
        }),
        event('guard-error', 'error', 3, { phase: 'guard', message: 'No evidence' }),
      ]),
    );
    expect(records.every((record) => record.failed)).toBe(true);
    expect(records.map((record) => record.lane)).toEqual(['tool', 'model', 'tool']);
    expect(records[1]?.searchText).toContain('model_unavailable');
    expect(records[2]?.durationMs).toBeUndefined();
  });
  it('supports old and incomplete events without synthesizing durations or dropping unknown events', () => {
    const records = projectTrace(
      detail([
        event('old-decision', 'agent_decision', 1),
        event('unrecognized', 'custom_phase', 30, null),
        {
          ...event('bad-time', 'assistant_message', 31, { answer: 'saved' }),
          createdAt: 'invalid',
        },
        event('bad-duration', 'execution_span', 32, {
          phase: 'answer',
          durationMs: -100,
          firstTokenMs: Infinity,
        }),
        event('orphan', 'execution_span', 33, { phase: 'decision', durationMs: 0, step: 3 }),
      ]),
    );
    expect(records).toHaveLength(5);
    expect(records[0]?.durationMs).toBeUndefined();
    expect(records[1]?.label).toBe('custom_phase');
    expect(records[2]?.start).toBeUndefined();
    expect(records[3]?.durationMs).toBeUndefined();
    expect(records[3]?.firstTokenMs).toBeUndefined();
    expect(records[4]?.durationMs).toBe(0);
    expect(timelineDomain(records, 'sequence')).toEqual({ start: 0, end: 5 });
    expect(timelineDomain(records, 'time')).toEqual({
      start: Date.UTC(2026, 0, 1) + 1000,
      end: Date.UTC(2026, 0, 1) + 33000,
    });
    expect(timelineDomain([], 'time')).toBeUndefined();
  });
  it('preserves recorded order even when older step metadata goes backward', () => {
    const records = projectTrace(
      detail([
        event('a', 'tool_result', 1, { step: 1 }),
        event('b', 'tool_result', 2, { step: 2 }),
        event('c', 'error', 3, { step: 1 }),
      ]),
    );
    const groups = groupTrace(records);
    expect(groups.map((group) => group.step)).toEqual([1, 2, 1]);
    expect(groups.flatMap((group) => group.records.map((record) => record.event.id))).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});
