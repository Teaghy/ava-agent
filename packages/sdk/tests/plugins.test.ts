import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentClient } from '../src/index.js';

afterEach(() => vi.unstubAllGlobals());
const snapshot = { enabled: true, safeMode: false, plugins: [], providers: [] };
describe('Plugin management client', () => {
  it('uploads a ZIP as binary with credentials, cancellation and a size guard', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(snapshot));
    vi.stubGlobal('fetch', fetcher);
    const client = new AgentClient({ token: 'platform-token' });
    const file = new Blob(['zip-test']);
    const signal = new AbortController().signal;
    expect(await client.plugins.upload(file, signal)).toEqual(snapshot);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/v1/plugins/upload');
    expect(init?.body).toBe(file);
    expect(init?.signal).toBe(signal);
    expect(new Headers(init?.headers).get('content-type')).toBe('application/zip');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer platform-token');
    await expect(client.plugins.upload(new Blob())).rejects.toThrow();
    await expect(
      client.plugins.upload(new Blob([new Uint8Array(10 * 1024 * 1024 + 1)])),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('uses the platform endpoints with authentication and cancellation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(snapshot));
    vi.stubGlobal('fetch', fetcher);
    const client = new AgentClient({ baseURL: 'http://localhost:3000/', token: 'platform-token' });
    const signal = new AbortController().signal;
    expect(await client.plugins.list(signal)).toEqual(snapshot);
    await client.plugins.install(
      {
        name: 'Orders',
        entry: 'C:/plugins/orders/dist/index.js',
        kind: 'provider',
        slot: 'decision',
        config: { question: '订单号？' },
      },
      signal,
    );
    await client.plugins.action(
      { id: '11111111-1111-4111-8111-111111111111', action: 'disable' },
      signal,
    );
    await client.plugins.configure(
      { id: '11111111-1111-4111-8111-111111111111', config: { question: '新的问题' } },
      signal,
    );
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      'http://localhost:3000/api/v1/plugins',
      'http://localhost:3000/api/v1/plugins/install',
      'http://localhost:3000/api/v1/plugins/action',
      'http://localhost:3000/api/v1/plugins/configure',
    ]);
    const init = fetcher.mock.calls[1]![1]!;
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(signal);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer platform-token');
    expect(JSON.parse(String(init.body))).toEqual({
      name: 'Orders',
      entry: 'C:/plugins/orders/dist/index.js',
      kind: 'provider',
      slot: 'decision',
      config: { question: '订单号？' },
      enabled: true,
    });
  });

  it('rejects a provider with no slot before making an HTTP request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetcher);
    const client = new AgentClient();
    await expect(
      client.plugins.install({ name: 'Orders', entry: '/plugins/orders.js', kind: 'provider' }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('validates server snapshots rather than rendering a malformed plugin list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ enabled: true, plugins: 'bad' })),
    );
    await expect(new AgentClient().plugins.list()).rejects.toThrow();
  });
});
