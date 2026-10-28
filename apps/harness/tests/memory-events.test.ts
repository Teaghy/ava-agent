import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, principal } from './helpers.js';
import { InMemoryStorage } from '../src/plugins/storage-memory/index.js';
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
describe('Memory and event store', () => {
  it('stores long-term facts separately from working state and scopes deletion', async () => {
    const h = await makeHarness();
    harnesses.push(h);
    const item = await h.ctx.memory.remember({
      tenantId: 'demo',
      userId: 'alice',
      category: 'device',
      content: '默认设备为 VCD-2000',
    });
    expect((await h.ctx.memory.recall('VCD', principal))[0]?.id).toBe(item.id);
    expect(await h.ctx.memory.recall('VCD', { ...principal, userId: 'bob' })).toEqual([]);
    await h.ctx.memory.forget(item.id, { ...principal, tenantId: 'other' });
    expect((await h.ctx.memory.recall('VCD', principal)).length).toBe(1);
    await h.ctx.memory.forget(item.id, principal);
    expect(await h.ctx.memory.recall('VCD', principal)).toEqual([]);
  });
  it('append-only events preserve order and cannot be mutated through returned objects', async () => {
    const storage = new InMemoryStorage();
    const event = {
      id: '1',
      runId: 'r',
      conversationId: 'c',
      tenantId: 't',
      type: 'user_message' as const,
      payload: { text: 'original' },
      createdAt: new Date().toISOString(),
    };
    await storage.appendEvent(event);
    event.payload.text = 'changed';
    expect((await storage.events('r', 't'))[0]?.payload).toEqual({ text: 'original' });
    await expect(storage.appendEvent(event)).rejects.toMatchObject({ code: 'DUPLICATE_EVENT' });
  });
  it('summarizes long conversations without treating user claims as verified facts', async () => {
    const h = await makeHarness();
    harnesses.push(h);
    await h.ctx.sessions.open('long', principal);
    for (let i = 0; i < 24; i++)
      await h.ctx.sessions.add('long', i % 2 ? 'assistant' : 'user', `message ${i}`);
    await h.ctx.sessions.summarize('long');
    expect((await h.ctx.sessions.summary('long'))?.summary).toContain('message');
    expect((await h.ctx.sessions.summary('long'))?.confirmedFacts).toEqual([]);
  });
});
