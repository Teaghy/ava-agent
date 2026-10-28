import { afterEach, describe, expect, it } from 'vitest';
import { createHarness, loadConfig } from '@ava/harness';
import { AppError, type StreamEvent } from '@ava/harness/plugin';
import { createRetailPreset } from '../src/retail.js';
import { demoRetailServices, demoPrincipal } from '../src/demo-data.js';

const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup(reviewAnswer = demoRetailServices.reviewAnswer) {
  const h = await createHarness(loadConfig({ NODE_ENV: 'test', SEED_KNOWLEDGE: 'false' }), {
    ...createRetailPreset({ ...demoRetailServices, reviewAnswer }),
    quiet: true,
  });
  harnesses.push(h);
  return h;
}

describe('Retail plugins through the public API', () => {
  it('replaces the equipment decision and answers an authorized order query', async () => {
    const h = await setup();
    const result = await h.ctx.agent.run({
      conversationId: 'order',
      message: '查询订单 A100',
      principal: demoPrincipal,
    });
    expect(result.answer).toBe('订单 A100 当前状态：已发货。');
    expect(h.ctx.tools.get('create_ticket')).toBeUndefined();
    const events = await h.ctx.eventStore.replay(result.runId, 'shop');
    expect(events.find((e) => e.type === 'tool_call')?.payload).toMatchObject({
      tool: 'order_lookup',
      arguments: { id: 'A100' },
    });
    expect(events.some((e) => e.type === 'agent_decision')).toBe(true);
  });

  it('retrieves its own industry source and returns a verified citation', async () => {
    const h = await setup();
    const result = await h.ctx.agent.run({
      conversationId: 'shipping',
      message: '配送政策是什么',
      principal: demoPrincipal,
    });
    expect(result.answer).toContain('两个工作日');
    expect(result.citations).toEqual([
      {
        documentId: 'retail:shipping',
        chunkId: 'retail:shipping:1',
        title: '配送说明',
        source: 'https://example.com/shipping',
      },
    ]);
  });

  it.each([
    { tenantId: 'shop', userId: 'bob' },
    { tenantId: 'other-shop', userId: 'alice' },
  ])('denies another owner %j even when the backend returns the order', async (owner) => {
    const h = await setup();
    const result = await h.ctx.agent.run({
      conversationId: 'forbidden',
      message: '查询订单 A100',
      principal: { ...demoPrincipal, ...owner },
    });
    expect(result.status).toBe('ask_user');
    expect(result.answer).not.toContain('已发货');
    const events = await h.ctx.eventStore.replay(result.runId, owner.tenantId);
    expect(events.find((e) => e.type === 'tool_result')?.payload).toMatchObject({
      status: 'failed',
      result: { error: { code: 'ORDER_NOT_FOUND' } },
    });
  });

  it('keeps industry answer review in front of persistence and streaming', async () => {
    const h = await setup(async () => {
      throw new AppError('REVIEW_REQUIRED', '需要人工审核。');
    });
    const events: StreamEvent[] = [];
    await expect(
      h.ctx.agent.run(
        { conversationId: 'review', message: '查询订单 A100', principal: demoPrincipal },
        async (event) => {
          events.push(event);
        },
      ),
    ).rejects.toMatchObject({ code: 'REVIEW_REQUIRED' });
    expect(events.some((e) => e.type.startsWith('answer.'))).toBe(false);
    expect((await h.ctx.sessions.recent('review')).some((m) => m.role === 'assistant')).toBe(false);
  });

  it('removes the tools and knowledge source when its extension is unloaded', async () => {
    const preset = createRetailPreset(demoRetailServices);
    const h = await createHarness(loadConfig({ NODE_ENV: 'test', SEED_KNOWLEDGE: 'false' }), {
      ...preset,
      quiet: true,
    });
    harnesses.push(h);
    for (const fiber of h.ctx.registry.get(preset.plugins![0]!)!.fibers) await fiber.dispose();
    expect(h.ctx.tools.get('order_lookup')).toBeUndefined();
    expect(h.ctx.knowledge.get('retail')).toBeUndefined();
  });
});
