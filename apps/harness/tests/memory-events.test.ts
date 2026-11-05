import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('uses explicit current-message consent, scoped lookup, and forgetting across conversations', async () => {
    const h = await makeHarness({
      PORT: '0',
      MEMORY_TOOLS_ENABLED: 'true',
      SEED_KNOWLEDGE: 'false',
      API_KEYS: JSON.stringify({ 'memory-test-token': principal }),
    });
    harnesses.push(h);
    const url = `http://127.0.0.1:${await h.start()}/api/v1/chat`;
    const decide = vi.spyOn(h.ctx.decision, 'decide');
    const model = vi.spyOn(h.ctx.model, 'structuredOutput');
    const invoke = async (conversationId: string, message: string, tool: string, args = {}) => {
      model
        .mockResolvedValueOnce({ type: 'tool_call', tool, arguments: args })
        .mockResolvedValueOnce({ type: 'ask_user', question: '已收到请求。' });
      const response = await fetch(url, {
        method: 'POST',
        headers: { authorization: 'Bearer memory-test-token', 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId, message }),
      });
      expect(response.status).toBe(200);
      const completed = (await response.text()).match(
        /event: ?answer\.completed\r?\ndata: ?([^\r\n]+)/u,
      );
      expect(completed).toBeTruthy();
      return JSON.parse(completed![1]!) as { runId: string };
    };

    await invoke('unauthorized-memory', '我喜欢无糖乌龙茶', 'memory_add');
    expect(await h.ctx.memory.recall('乌龙茶', principal)).toEqual([]);
    expect(decide.mock.lastCall?.[1].observations[0]?.result).toMatchObject({
      error: { code: 'MEMORY_CONSENT_REQUIRED' },
    });

    const content = '我喜欢无糖乌龙茶';
    await invoke('save-memory', `请记住：${content}`, 'memory_add', { category: 'preference' });
    const [item] = await h.ctx.memory.recall('我喜欢什么乌龙茶？', principal);
    expect(item).toMatchObject({ content, category: 'preference' });
    expect(await h.ctx.memory.recall('订单运费', principal)).toEqual([]);
    expect(await h.ctx.memory.recall('乌龙茶', { ...principal, userId: 'bob' })).toEqual([]);

    const lookup = await invoke('search-memory', '我喜欢喝什么？', 'memory_search', {
      query: '乌龙茶',
    });
    expect(decide.mock.lastCall?.[1].observations[0]?.result).toMatchObject({
      memories: [{ id: item!.id, content }],
    });
    expect(model.mock.lastCall?.[1].messages[1]?.content).toContain(content);
    const trace = await h.ctx.eventStore.replay(lookup.runId, principal.tenantId);
    expect(trace.some((event) => event.type === 'tool_result')).toBe(true);
    expect(JSON.stringify(trace)).not.toContain(content);
    expect(JSON.stringify(trace)).not.toContain('乌龙茶');
    expect(await h.ctx.eventStore.recover(lookup.runId, principal.tenantId)).toMatchObject({
      toolCalls: [{ tool: 'memory_search', kind: 'memory', arguments: {} }],
    });

    await invoke('forget-memory', `/forget ${item!.id}`, 'memory_forget');
    expect(await h.ctx.memory.recall('乌龙茶', principal)).toEqual([]);
  });

  it('keeps personal tools unavailable to application keys and out of business evidence', async () => {
    const h = await makeHarness({ MEMORY_TOOLS_ENABLED: 'true', SEED_KNOWLEDGE: 'false' });
    harnesses.push(h);
    const recall = vi.spyOn(h.ctx.memory, 'recall');
    const decide = vi.spyOn(h.ctx.decision, 'decide');
    decide
      .mockResolvedValueOnce({
        type: 'tool_call',
        tool: 'memory_search',
        arguments: { query: '政策' },
      })
      .mockResolvedValueOnce({ type: 'ask_user', question: '需要更多信息。' });
    await h.ctx.agent.run({
      conversationId: 'app-memory',
      message: '查找个人记忆',
      principal: { ...principal, applicationId: 'test-app', knowledgeSpaceId: 'test' },
    });
    expect(decide.mock.calls[0]?.[0].availableTools.some((tool) => tool.kind === 'memory')).toBe(
      false,
    );
    expect(decide.mock.lastCall?.[1].observations[0]?.result).toMatchObject({
      error: { code: 'TOOL_FORBIDDEN' },
    });
    expect(recall).not.toHaveBeenCalled();

    await h.ctx.memory.remember({ ...principal, content: '未经验证的退款政策', category: 'fact' });
    decide
      .mockResolvedValueOnce({
        type: 'tool_call',
        tool: 'memory_search',
        arguments: { query: '退款政策' },
      })
      .mockResolvedValueOnce({ type: 'final_answer', answer: '可以退款。' });
    const result = await h.ctx.agent.run({
      conversationId: 'business-memory',
      message: '可以退款吗？',
      principal,
    });
    expect(recall).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: 'ask_user', citations: [] });
    expect(result.answer).not.toContain('可以退款');
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
