import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, principal } from './helpers.js';
import { mainModelDecisionPlugin } from '../src/plugins/decision-main-model/index.js';
import { MainModelDecisionService } from '../src/plugins/decision-main-model/main-model-decision.service.js';
import { modelMockPlugin } from '../src/plugins/model-mock/index.js';
import type { DecisionService } from '../src/core/decision/decision.service.js';
import type { StreamEvent } from '../src/core/http/http.types.js';

const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup() {
  const harness = await makeHarness();
  harnesses.push(harness);
  return harness;
}

describe('Decision Service boundary', () => {
  it('uses a short answer-ready decision without composing the final answer in streaming mode', async () => {
    const h = await setup();
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(async (schema) =>
      schema.parse({
        type: 'answer_ready',
        citations: [{ documentId: 'product', chunkId: 'chunk' }],
      }),
    );
    const service = new MainModelDecisionService(h.ctx.model, h.ctx.telemetry, {
      systemPrompt: '客服',
      contextTokens: 12000,
      streamAnswers: true,
    });
    const result = await service.decide(
      { message: 'Price?', entities: {}, availableTools: [], availableKnowledgeSources: [] },
      {
        runId: 'planned',
        conversationId: 'planned',
        step: 2,
        recentMessages: [],
        observations: [],
        memory: [],
        signal: new AbortController().signal,
        retrievedDocuments: [
          {
            id: 'chunk',
            documentId: 'product',
            title: 'Product',
            content: '699',
            tenantId: 'demo',
            metadata: {},
            score: 1,
          },
        ],
      },
    );
    expect(result).toEqual({
      type: 'answer_ready',
      citations: [{ documentId: 'product', chunkId: 'chunk', title: 'Product' }],
    });
  });

  it.each([undefined, 'https://example.com/product'])(
    'resolves citation metadata from retrieved documents (source=%s)',
    async (source) => {
      const h = await setup();
      const document = {
        id: 'chunk-1',
        documentId: 'product-v1',
        title: 'Product',
        content: 'Price: 699',
        source,
        tenantId: 'demo',
        metadata: {},
        score: 1,
      };
      vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(async (schema) =>
        schema.parse({
          type: 'final_answer',
          answer: 'Price: 699',
          citations: [
            {
              chunkId: document.id,
              documentId: document.documentId,
              title: 'Model copied the wrong title',
              source: 'qdrant',
            },
          ],
        }),
      );
      const result = await h.ctx.decision.decide(
        { message: 'Price?', entities: {}, availableTools: [], availableKnowledgeSources: [] },
        {
          runId: 'citation-test',
          conversationId: 'citation-test',
          step: 2,
          recentMessages: [],
          observations: [],
          memory: [],
          retrievedDocuments: [document],
          signal: new AbortController().signal,
        },
      );
      expect(result).toEqual({
        type: 'final_answer',
        answer: 'Price: 699',
        citations: [
          {
            chunkId: 'chunk-1',
            documentId: 'product-v1',
            title: 'Product',
            ...(source ? { source } : {}),
          },
        ],
      });
    },
  );

  it('rejects citation IDs outside this run instead of repairing them', async () => {
    const h = await setup();
    vi.spyOn(h.ctx.model, 'structuredOutput').mockImplementation(async (schema) =>
      schema.parse({
        type: 'final_answer',
        answer: 'Unverified',
        citations: [{ chunkId: 'foreign-chunk', documentId: 'foreign-document', title: 'Unknown' }],
      }),
    );
    await expect(
      h.ctx.decision.decide(
        { message: 'Price?', entities: {}, availableTools: [], availableKnowledgeSources: [] },
        {
          runId: 'citation-test',
          conversationId: 'citation-test',
          step: 2,
          recentMessages: [],
          observations: [],
          memory: [],
          retrievedDocuments: [],
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_CITATION' });
  });

  it('passes the scoped tool/source catalog and run context to the default main-model provider', async () => {
    const h = await setup();
    await h.ctx.memory.remember({
      ...principal,
      content: '默认设备为 VCD-2000',
      category: 'device',
    });
    const decide = vi.spyOn(h.ctx.decision, 'decide');
    const model = vi.spyOn(h.ctx.model, 'structuredOutput');
    const result = await h.ctx.agent.run({
      conversationId: 'decision-main',
      message: 'VCD-2000 E102',
      principal,
    });
    const [input, context] = decide.mock.calls[0]!;
    expect(input.availableTools.some((tool) => tool.name === 'knowledge_search')).toBe(true);
    expect(input.availableTools.some((tool) => tool.permission !== 'READ')).toBe(false);
    expect(input.availableKnowledgeSources.map((source) => source.name)).toContain('qdrant');
    expect(context).toMatchObject({
      conversationId: 'decision-main',
      step: 1,
      memory: [expect.objectContaining({ content: '默认设备为 VCD-2000' })],
    });
    expect(model).toHaveBeenCalledTimes(decide.mock.calls.length);
    expect(model.mock.calls[0]?.[1].signal).toBe(context.signal);
    expect(model.mock.calls[0]?.[1]).toMatchObject({
      runId: result.runId,
      conversationId: 'decision-main',
    });
    const envelope = JSON.parse(model.mock.calls[0]?.[1].messages[1]?.content ?? '{}') as {
      knowledgeSources: { name: string }[];
      task: { goal?: string };
    };
    expect(envelope.knowledgeSources.some((source) => source.name === 'qdrant')).toBe(true);
    expect(envelope.task.goal).toBeUndefined();
  });
  it('replaces the decision plugin and runs without any model service', async () => {
    const h = await setup();
    for (const fiber of h.ctx.registry.get(mainModelDecisionPlugin)!.fibers) await fiber.dispose();
    expect(h.ctx.get('decision')).toBeUndefined();
    const decide = vi
      .fn<DecisionService['decide']>()
      .mockResolvedValue({ type: 'ask_user', question: '请提供设备序列号。' });
    await h.ctx.plugin({
      name: 'decision-test-rules',
      provide: ['decision'],
      apply(ctx) {
        ctx.provide('decision', { decide });
      },
    });
    for (const fiber of h.ctx.registry.get(modelMockPlugin)!.fibers) await fiber.dispose();
    await vi.waitFor(() => expect(h.ctx.get('agent')).toBeDefined());
    expect(h.ctx.get('model')).toBeUndefined();
    const result = await h.ctx.agent.run({
      conversationId: 'decision-custom',
      message: '设备故障',
      principal,
    });
    expect(result).toMatchObject({ status: 'ask_user', answer: '请提供设备序列号。' });
    expect(decide).toHaveBeenCalledTimes(1);
    expect(
      (await h.ctx.eventStore.replay(result.runId, 'demo')).find((e) => e.type === 'agent_decision')
        ?.payload,
    ).toEqual({ type: 'ask_user', question: '请提供设备序列号。' });
  });
  it('rejects hidden reasoning returned by a custom decision provider before any answer event', async () => {
    const h = await setup();
    const events: StreamEvent[] = [];
    vi.spyOn(h.ctx.decision, 'decide').mockImplementation(async () => ({
      type: 'ask_user',
      question: '设备型号？',
      reasoning: 'private-thought',
    }));
    await expect(
      h.ctx.agent.run(
        { conversationId: 'decision-invalid', message: 'E102', principal },
        async (event) => {
          events.push(event);
        },
      ),
    ).rejects.toThrow();
    expect(events.some((event) => event.type.startsWith('answer.'))).toBe(false);
    expect(JSON.stringify(events)).not.toContain('private-thought');
  });
  it('retains server-side permissions even when a decision provider requests a write tool', async () => {
    const h = await setup();
    vi.spyOn(h.ctx.decision, 'decide')
      .mockResolvedValueOnce({
        type: 'tool_call',
        tool: 'create_ticket',
        arguments: { description: '请创建 E102 故障工单。' },
      })
      .mockResolvedValueOnce({ type: 'ask_user', question: '需要授权人员处理。' });
    const result = await h.ctx.agent.run({
      conversationId: 'decision-permission',
      message: 'E102',
      principal,
    });
    const events = await h.ctx.eventStore.replay(result.runId, 'demo');
    expect(events.find((event) => event.type === 'tool_result')?.payload).toMatchObject({
      status: 'failed',
      result: { error: { code: 'TOOL_FORBIDDEN' } },
    });
  });
});
