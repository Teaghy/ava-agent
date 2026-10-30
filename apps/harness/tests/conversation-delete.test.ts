import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness, principal } from './helpers.js';
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});

describe('Deleting personal conversations', () => {
  it('removes messages and summaries but retains Ops traces, ownership and unrelated conversations', async () => {
    const h = await makeHarness({
      PORT: '0',
      API_KEYS: JSON.stringify({
        alice: principal,
        bob: { ...principal, userId: 'bob', admin: true },
        other: { ...principal, tenantId: 'other' },
      }),
    });
    harnesses.push(h);
    const url = `http://127.0.0.1:${await h.start()}`;
    const result = await h.ctx.agent.run({
      conversationId: 'delete-me',
      message: 'VCD-2000 E102',
      principal,
    });
    await h.ctx.storage.ensureConversation('keep-me', principal);
    await h.ctx.storage.saveSummary({
      conversationId: 'delete-me',
      summary: 'old-summary',
      confirmedFacts: [],
      executedActions: [],
      pendingItems: [],
      updatedAt: new Date().toISOString(),
    });
    const remove = (token: string, id = 'delete-me') =>
      fetch(`${url}/api/v1/conversations/delete`, {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ conversationId: id }),
      });
    expect((await remove('')).status).toBe(401);
    expect((await remove('bob')).status).toBe(403);
    expect((await remove('other')).status).toBe(403);
    expect((await h.ctx.storage.messages('delete-me', 100)).length).toBeGreaterThan(0);
    await h.ctx.cache.acquire('conversation-lock:delete-me', 'running', 120);
    expect((await remove('alice')).status).toBe(409);
    await h.ctx.cache.release('conversation-lock:delete-me', 'running');
    expect((await remove('alice')).status).toBe(200);
    expect((await h.ctx.storage.listConversations(principal, 100)).map((c) => c.id)).toEqual([
      'keep-me',
    ]);
    expect(await h.ctx.storage.messages('delete-me', 100)).toEqual([]);
    expect(await h.ctx.storage.summary('delete-me')).toBeUndefined();
    await h.ctx.storage.saveSummary({
      conversationId: 'delete-me',
      summary: 'late-summary',
      confirmedFacts: [],
      executedActions: [],
      pendingItems: [],
      updatedAt: new Date().toISOString(),
    });
    expect(await h.ctx.storage.summary('delete-me')).toBeUndefined();
    await expect(h.ctx.storage.assertConversation('delete-me', principal)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(h.ctx.storage.ensureConversation('delete-me', principal)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const history = await fetch(`${url}/api/v1/conversations/history`, {
      method: 'POST',
      headers: { authorization: 'Bearer alice' },
      body: JSON.stringify({ conversationId: 'delete-me' }),
    });
    expect(history.status).toBe(404);
    expect(
      (await h.ctx.eventStore.replay(result.runId, principal.tenantId)).length,
    ).toBeGreaterThan(0);
    expect((await remove('alice')).status).toBe(404);
    expect(await h.ctx.cache.acquire('conversation-lock:delete-me', 'released', 5)).toBe(true);
  });
});
