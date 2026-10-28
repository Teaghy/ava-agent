import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentClient } from '../src/index.js';
afterEach(() => vi.unstubAllGlobals());
describe('AgentClient', () => {
  it('shares base URL, auth, and response validation across clients', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ conversations: [] }))
      .mockResolvedValueOnce(Response.json({ messages: [], limit: 100 }))
      .mockResolvedValueOnce(Response.json({ chunks: 2 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new AgentClient({ baseURL: 'http://localhost:3000/', token: 'secret' });
    expect(await client.conversations()).toEqual([]);
    expect(await client.history('conv')).toEqual({ messages: [], limit: 100 });
    expect(
      await client.knowledge.ingest({ id: 'v1', title: 'SOP', content: 'E102', metadata: {} }),
    ).toEqual({ chunks: 2 });
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'http://localhost:3000/api/v1/conversations',
      'http://localhost:3000/api/v1/conversations/history',
      'http://localhost:3000/api/v1/knowledge',
    ]);
    expect(new Headers(fetcher.mock.calls[2]?.[1]?.headers).get('authorization')).toBe(
      'Bearer secret',
    );
  });
  it('surfaces safe API errors and rejects malformed requests before HTTP', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { message: '拒绝访问' } }, { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const client = new AgentClient();
    await expect(client.conversations()).rejects.toMatchObject({
      status: 403,
      message: '拒绝访问',
    });
    fetcher.mockClear();
    await expect(client.history('../other')).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
