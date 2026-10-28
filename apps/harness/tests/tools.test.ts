import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../src/plugins/tools/index.js';
import { principal, silentTelemetry } from './helpers.js';
import type { AgentState } from '../src/core/agent/agent.types.js';
import type { AuditLog } from '../src/core/tools/tool.types.js';
import type { ToolContext } from '../src/core/tools/tool-context.js';
const state: AgentState = {
  runId: 'run',
  conversationId: 'conv',
  entities: {},
  observations: [],
  toolCalls: [],
  retrievedDocuments: [],
  step: 1,
  status: 'running',
};
const context: ToolContext = {
  principal,
  state,
  signal: new AbortController().signal,
  emit: async () => {},
};
describe('Tool registry', () => {
  it('validates inputs, denies unauthorized writes, audits and disposes registrations', async () => {
    const audits: AuditLog[] = [];
    let calls = 0;
    const registry = new ToolRegistry(async (log) => {
      audits.push(log);
    }, silentTelemetry);
    const off = registry.register({
      name: 'write',
      description: 'write',
      permission: 'WRITE',
      inputSchema: z.object({ count: z.number().positive() }).strict(),
      async execute(input) {
        calls++;
        return input.count;
      },
    });
    await expect(registry.execute('write', { count: 1 }, context)).rejects.toMatchObject({
      code: 'TOOL_FORBIDDEN',
    });
    expect(calls).toBe(0);
    expect(audits[0]?.status).toBe('denied');
    const writer = {
      ...context,
      principal: { ...principal, permissions: ['WRITE'] as const as ['WRITE'] },
    };
    await expect(registry.execute('write', { count: -1 }, writer)).rejects.toThrow();
    expect(audits[1]?.status).toBe('failed');
    expect(await registry.execute('write', { count: 2 }, writer)).toBe(2);
    expect(registry.get('write')?.parameters).toBeDefined();
    off();
    expect(registry.list()).toEqual([]);
  });
});
