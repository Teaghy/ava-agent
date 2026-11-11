import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHarness, principal } from './helpers.js';
import { streamEventSchema } from '@ava/protocol';
import type { StreamEvent } from '../src/core/http/http.types.js';
import { assessEvidence } from '../src/plugins/response-policy/evidence-relevance.js';

const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup(preset = 'customer-service') {
  const h = await makeHarness({ APP_PRESET: preset, SEED_KNOWLEDGE: 'false' });
  harnesses.push(h);
  await h.ctx.rag.ingest(
    {
      id: 'cf-guide',
      title: 'CF-A200 产品与保修',
      content: 'CF-A200 是空气净化器，保修期两年。滤芯建议每三到六个月检查。',
      metadata: {},
    },
    'demo',
  );
  return h;
}
describe('Knowledge scope before releasing answers', () => {
  it.each(['1+1等于多少', 'vue是什么框架', '今天北京天气怎么样', '如何用Vue编写CF-A200介绍页面'])(
    'refuses an unrelated original question before the next decision or answer generation: %s',
    async (question) => {
      const h = await setup();
      const decision = vi.spyOn(h.ctx.decision, 'decide');
      decision.mockResolvedValueOnce({
        type: 'tool_call',
        tool: 'knowledge_search',
        arguments: { query: 'CF-A200' },
      });
      decision.mockImplementationOnce(async (_input, context) => ({
        type: 'answer_ready',
        citations: context.retrievedDocuments.map(({ id, documentId, title, source }) => ({
          chunkId: id,
          documentId,
          title,
          source,
        })),
      }));
      vi.spyOn(h.ctx.embedding, 'embedMany').mockImplementation(async (texts) =>
        texts.map((_text, index) => (index ? [0, 1] : [1, 0])),
      );
      const generator = vi.spyOn(h.ctx.answer, 'stream');
      const emitted: StreamEvent[] = [];
      const result = await h.ctx.agent.run(
        { conversationId: crypto.randomUUID(), message: question, principal },
        async (event) => {
          emitted.push(event);
        },
      );
      expect(result).toMatchObject({ status: 'ask_user', citations: [] });
      expect(result.answer).toContain('服务范围');
      expect(decision).toHaveBeenCalledTimes(1);
      expect(generator).not.toHaveBeenCalled();
      expect(
        emitted
          .map((event) => streamEventSchema.parse(event))
          .flatMap((event) => (event.type === 'answer.delta' ? [event.data.text] : []))
          .join(''),
      ).toBe(result.answer);
      const trace = await h.ctx.eventStore.replay(result.runId, 'demo');
      expect(trace.find((event) => event.type === 'rag_result')?.payload).toMatchObject({
        documents: expect.arrayContaining([expect.any(String)]),
      });
      expect(trace.some((event) => event.type === 'error')).toBe(false);
      expect(trace.find((event) => event.type === 'assistant_message')?.payload).toMatchObject({
        answer: result.answer,
        citations: [],
      });
    },
  );
  it.each(['final_answer', 'ask_user', 'evidence'] as const)(
    'rejects a valid but irrelevant reference in the %s guard path',
    async (type) => {
      const h = await setup();
      const chunks = await h.ctx.storage.knowledgeChunks('cf-guide', 'demo');
      const state = {
        runId: 'irrelevant-run',
        conversationId: 'irrelevant',
        goal: 'vue是什么框架',
        entities: {},
        observations: [],
        toolCalls: [],
        retrievedDocuments: chunks,
        step: 2,
        status: 'running' as const,
      };
      const citations =
        type === 'ask_user'
          ? []
          : chunks.map(({ id, documentId, title, source }) => ({
              chunkId: id,
              documentId,
              title,
              source,
            }));
      const validation =
        type === 'evidence'
          ? h.ctx.guard.validateEvidence!(citations, state)
          : h.ctx.guard.validate('Vue 是一个框架。', citations, state, undefined, type);
      await expect(validation).rejects.toMatchObject({ code: 'LOW_CONFIDENCE' });
    },
  );
  it('refuses an empty retrieval without asking the model for another answer', async () => {
    const h = await makeHarness({ SEED_KNOWLEDGE: 'false' });
    harnesses.push(h);
    const decide = vi.spyOn(h.ctx.decision, 'decide').mockResolvedValue({
      type: 'tool_call',
      tool: 'knowledge_search',
      arguments: { query: '保修' },
    });
    const result = await h.ctx.agent.run({
      conversationId: 'empty-scope',
      message: '保修',
      principal,
    });
    expect(result).toMatchObject({ status: 'ask_user', citations: [] });
    expect(result.answer).toContain('服务范围');
    expect(decide).toHaveBeenCalledTimes(1);
  });
  it('uses the same bounded refusal in the knowledge preset', async () => {
    const h = await setup('knowledge');
    const result = await h.ctx.agent.run({
      conversationId: crypto.randomUUID(),
      message: 'vue是什么框架',
      principal,
    });
    expect(result).toMatchObject({ status: 'ask_user', citations: [] });
    expect(result.answer).toContain('当前知识库没有足够相关的依据');
  });
  it('keeps grounded answers and reuses assessment for repeated guard checks', async () => {
    const h = await setup();
    const chunks = await h.ctx.storage.knowledgeChunks('cf-guide', 'demo');
    const state = {
      runId: 'scoped-run',
      conversationId: 'scoped',
      goal: 'CF-A200 保修期多久',
      entities: {},
      observations: [],
      toolCalls: [],
      retrievedDocuments: chunks,
      step: 2,
      status: 'running' as const,
    };
    const citations = chunks.map(({ id, documentId, title, source }) => ({
      chunkId: id,
      documentId,
      title,
      source,
    }));
    const embed = vi
      .spyOn(h.ctx.embedding, 'embedMany')
      .mockImplementation(async (texts) => texts.map(() => [1, 0]));
    await h.ctx.guard.validate('保修两年', citations, state);
    await h.ctx.guard.validate('保修两年', citations, state);
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0]?.[0][0]).toBe(state.goal);
  });
  it('checks every cited chunk rather than accepting one relevant citation among unrelated ones', async () => {
    const h = await setup();
    const [document] = await h.ctx.storage.knowledgeChunks('cf-guide', 'demo');
    const embedding = {
      embed: async () => [1, 0],
      embedMany: async () => [
        [1, 0],
        [1, 0],
        [0, 1],
      ],
    };
    const result = await assessEvidence(
      'CF-A200 保修期多久',
      [document!, { ...document!, id: 'unrelated', content: '其他资料' }],
      embedding,
      0.5,
    );
    expect(result).toMatchObject({ supported: false, reason: 'low-similarity' });
  });
  it('does not make topic names a denylist when they are genuinely covered by the knowledge', async () => {
    const h = await setup();
    const [document] = await h.ctx.storage.knowledgeChunks('cf-guide', 'demo');
    const embedding = {
      embed: async () => [1, 0],
      embedMany: async () => [
        [1, 0],
        [1, 0],
      ],
    };
    expect(
      await assessEvidence(
        'vue是什么框架',
        [{ ...document!, title: 'Vue 指引', content: 'Vue 是构建用户界面的 JavaScript 框架。' }],
        embedding,
        0.5,
      ),
    ).toMatchObject({ supported: true });
  });
});
