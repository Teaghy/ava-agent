import { afterEach, expect, it, vi } from 'vitest';
import { AgentClient } from '../src/client.js';

afterEach(() => vi.unstubAllGlobals());
it('uses shared authentication for members and validates identity requests and public responses', async () => {
  const identity = {
    tenantId: 'demo',
    userId: 'alice',
    displayName: 'Alice',
    role: 'agent',
    manageMembers: false,
    manageKnowledge: false,
  };
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      Response.json({ identity, expiresAt: '2030-01-01T00:00:00Z', token: 'must-not-reach-UI' }),
    )
    .mockResolvedValueOnce(Response.json({ members: [], next: 'alice' }));
  vi.stubGlobal('fetch', fetcher);
  const client = new AgentClient({ baseURL: 'https://example.test', token: 'bootstrap' });
  const result = await client.identity.login({
    tenantId: 'demo',
    userId: 'alice',
    password: 'test-password-123',
  });
  expect(result.identity.userId).toBe('alice');
  expect(result).not.toHaveProperty('token');
  expect(await client.identity.members()).toEqual({ members: [], next: 'alice' });
  expect(fetcher.mock.calls[1]?.[0]).toBe('https://example.test/api/v1/members/list');
  expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
    'Bearer bootstrap',
  );
  fetcher.mockClear();
  await expect(
    client.identity.createMember({
      userId: 'alice',
      displayName: 'Alice',
      role: 'agent',
      password: 'short',
    }),
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
