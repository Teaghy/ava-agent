import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeHarness } from './helpers.js';
import { H3HttpService } from '../src/plugins/http-h3/index.js';
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
describe('Web UI hosting and conversation APIs', () => {
  it('serves only public UI files and removes static routes on disposal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ava-web-test-'));
    const http = new H3HttpService();
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Ava</title>');
    await writeFile(join(root, '.env'), 'secret');
    try {
      const dispose = http.static('/', root);
      const url = `http://127.0.0.1:${await http.start(0)}`;
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
      expect((await fetch(`${url}/.env`)).status).toBe(404);
      expect((await fetch(`${url}/package.json`)).status).toBe(404);
      dispose();
      expect((await fetch(url)).status).toBe(404);
    } finally {
      await http.stop();
      await unlink(join(root, 'index.html'));
      await unlink(join(root, '.env'));
      await rmdir(root);
    }
  });
  it('reports actual memory configuration without exposing secrets', async () => {
    const h = await makeHarness({
      PORT: '0',
      MEM0_ENABLED: 'true',
      MEM0_API_KEY: 'private-mem0-key',
      API_KEYS: JSON.stringify({
        'private-api-key': { tenantId: 't', userId: 'a', permissions: ['READ'] },
      }),
    });
    harnesses.push(h);
    const response = await fetch(`http://127.0.0.1:${await h.start()}/api/v1/client-config`);
    const body = await response.json();
    expect(body).toMatchObject({ memoryProvider: 'mem0-oss-rest', authRequired: true });
    expect(JSON.stringify(body)).not.toContain('private-');
  });
  it('persists citations in history and isolates lists by principal', async () => {
    const p = { tenantId: 'demo', userId: 'alice', permissions: ['READ'] as ['READ'] };
    const keys = { alice: p, bob: { ...p, userId: 'bob' } };
    const h = await makeHarness({ PORT: '0', API_KEYS: JSON.stringify(keys) });
    harnesses.push(h);
    const url = `http://127.0.0.1:${await h.start()}`;
    const answer = await h.ctx.agent.run({
      conversationId: 'history-citations',
      message: 'VCD-2000 E102',
      principal: p,
    });
    const list = (await (
      await fetch(`${url}/api/v1/conversations`, { headers: { authorization: 'Bearer alice' } })
    ).json()) as { conversations: { id: string; title: string }[] };
    expect(list.conversations[0]).toMatchObject({
      id: 'history-citations',
      title: 'VCD-2000 E102',
    });
    const history = (token: string, conversationId = 'history-citations') =>
      fetch(`${url}/api/v1/conversations/history`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify({ conversationId }),
      });
    const body = (await (await history('alice')).json()) as {
      messages: { citations?: unknown; runId?: string }[];
    };
    expect(body.messages.at(-1)?.citations).toEqual(answer.citations);
    expect(body.messages.at(-1)?.runId).toBe(answer.runId);
    expect((await history('bob')).status).toBe(403);
    expect((await history('alice', 'missing')).status).toBe(404);
    expect(
      await (
        await fetch(`${url}/api/v1/conversations`, { headers: { authorization: 'Bearer bob' } })
      ).json(),
    ).toEqual({ conversations: [] });
  });
});
