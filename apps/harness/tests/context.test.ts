import { describe, expect, it } from 'vitest';
import { ContextBuilder } from '../src/core/agent/context-builder.js';
import { decisionSchema } from '../src/core/agent/agent-decision.js';
import type { AgentState } from '../src/core/agent/agent.types.js';
describe('Context builder and decisions', () => {
  it('budgets system and live tool observations before low-priority memory', () => {
    const state: AgentState = {
      runId: 'r',
      conversationId: 'c',
      entities: {},
      step: 1,
      status: 'running',
      observations: [{ tool: 'device_status', result: 'REALTIME' }],
      toolCalls: [],
      retrievedDocuments: [],
    };
    const messages = new ContextBuilder('RULES', 1000).build({
      state,
      message: 'E102',
      recent: [],
      memories: [
        {
          id: 'm',
          tenantId: 't',
          userId: 'u',
          category: 'fact',
          content: 'x'.repeat(4000),
          createdAt: '',
        },
      ],
      tools: [],
    });
    expect(messages[1]?.content).toContain('REALTIME');
    expect(messages[1]?.content).not.toContain('xxxx');
    expect(messages.reduce((n, m) => n + Buffer.byteLength(m.content), 0)).toBeLessThan(1000);
  });
  it('rejects hidden reasoning fields and malformed decisions', () => {
    expect(
      decisionSchema.safeParse({ type: 'final_answer', answer: 'x', reasoning: 'secret' }).success,
    ).toBe(false);
    expect(
      decisionSchema.safeParse({ type: 'tool_call', tool: 'knowledge_search', arguments: 'bad' })
        .success,
    ).toBe(false);
  });
});
