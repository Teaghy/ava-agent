import { afterEach, expect, it, vi } from 'vitest';
import { AgentClient } from '../src/client.js';

afterEach(() => vi.unstubAllGlobals());
it('validates application credentials, uses the shared auth transport and keeps hashes out of public metadata', async () => {
  const application = {
    tenantId: 'company',
    applicationId: 'device',
    knowledgeSpaceId: 'manuals',
    name: 'Device',
    active: true,
    version: 0,
    createdAt: '2026-10-30T00:00:00Z',
  };
  const key = {
    id: '423d3fa8-acf1-42a0-a19f-45dcc1a6081b',
    applicationId: 'device',
    label: 'SDK test',
    hint: '••••test',
    permissions: ['READ'],
    allowChat: true,
    manageKnowledge: false,
    expiresAt: null,
    revokedAt: null,
    source: 'managed',
    createdAt: '2026-10-30T00:00:00Z',
    hash: 'must-not-reach-UI',
  };
  const secret = `ava_app_${'x'.repeat(43)}`;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ applications: [application] }))
    .mockResolvedValueOnce(Response.json({ key, secret }))
    .mockResolvedValueOnce(Response.json({ keys: [key] }))
    .mockResolvedValueOnce(Response.json({ revoked: true }));
  vi.stubGlobal('fetch', fetcher);
  const client = new AgentClient({ baseURL: 'https://example.test', token: 'admin' });
  expect((await client.applications.list()).applications[0]?.applicationId).toBe('device');
  const issued = await client.applications.issueKey({ applicationId: 'device', label: 'SDK test' });
  expect(issued.secret).toBe(secret);
  expect(issued.key).not.toHaveProperty('hash');
  expect((await client.applications.keys('device')).keys[0]).not.toHaveProperty('hash');
  expect(await client.applications.revokeKey('device', key.id)).toEqual({ revoked: true });
  expect(fetcher.mock.calls[1]?.[0]).toBe('https://example.test/api/v1/applications/keys/issue');
  expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
    'Bearer admin',
  );
  expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toMatchObject({
    permissions: ['READ'],
    allowChat: true,
    manageKnowledge: false,
  });
  fetcher.mockClear();
  await expect(
    client.applications.create({
      applicationId: 'bad/id',
      knowledgeSpaceId: 'manuals',
      name: 'Invalid',
    }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
