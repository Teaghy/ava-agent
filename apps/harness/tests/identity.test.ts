import { afterEach, describe, expect, it } from 'vitest';
import { makeHarness } from './helpers.js';
import { sessionHash } from '../src/core/identity/identity.service.js';
import { assertSameOrigin, sessionCookie } from '../src/plugins/local-identity/cookies.js';
import type { HttpRequest } from '../src/core/http/http.types.js';

const password = 'identity-test-password-123';
const admin = { tenantId: 'demo', userId: 'admin', permissions: ['READ'], admin: true };
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup() {
  const h = await makeHarness({
    PORT: '0',
    LOCAL_AUTH_ENABLED: 'true',
    API_KEYS: JSON.stringify({
      bootstrap: admin,
      legacy: { tenantId: 'demo', userId: 'alice', permissions: ['READ'], admin: true },
      other: { ...admin, tenantId: 'other' },
    }),
    OPS_ENABLED: 'true',
    OPS_PORT: '0',
    OPS_API_KEYS: JSON.stringify({ ops: { ...admin, managePlugins: true } }),
  });
  harnesses.push(h);
  const url = `http://127.0.0.1:${await h.start()}`;
  const post = (path: string, body: unknown, cookie?: string, token?: string) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: {
        origin: url,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const create = (userId: string, role = 'agent', token = 'bootstrap') =>
    post(
      '/api/v1/members/create',
      { userId, displayName: userId, role, password },
      undefined,
      token,
    );
  const login = async (userId: string, tenantId = 'demo') => {
    const response = await post('/api/v1/auth/login', { tenantId, userId, password });
    expect(response.status).toBe(200);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, response };
  };
  return { h, url, post, create, login };
}

describe('optional local identity', () => {
  it('requires HTTPS origins and secure session cookies in production', () => {
    const request = (origin: string): HttpRequest => ({
      method: 'POST',
      header: (name) => (name === 'origin' ? origin : name === 'host' ? 'example.test' : undefined),
      body: async () => ({}),
      signal: new AbortController().signal,
    });
    expect(sessionCookie('session', true)).toContain('; Secure;');
    expect(sessionCookie('', true)).toContain('Max-Age=0');
    expect(() => assertSameOrigin(request('https://example.test'), true)).not.toThrow();
    expect(() => assertSameOrigin(request('http://example.test'), true)).toThrow();
    expect(() => assertSameOrigin(request('https://other.test'), true)).toThrow();
  });
  it('paginates tenant members without exposing credentials or skipping the next page', async () => {
    const { h, post } = await setup();
    const store = h.ctx.identity.store;
    for (let i = 0; i < 53; i++)
      await store.create({
        tenantId: 'demo',
        userId: `member-${String(i).padStart(3, '0')}`,
        displayName: `Member ${i}`,
        role: 'agent',
        active: true,
        version: 0,
        createdAt: new Date().toISOString(),
        passwordHash: 'private-test-hash',
      });
    await store.create({
      tenantId: 'other',
      userId: 'hidden-member',
      displayName: 'Hidden',
      role: 'agent',
      active: true,
      version: 0,
      createdAt: new Date().toISOString(),
      passwordHash: 'private-test-hash',
    });
    const first = await (await post('/api/v1/members/list', {}, undefined, 'bootstrap')).json();
    const second = await (
      await post('/api/v1/members/list', { after: first.next }, undefined, 'bootstrap')
    ).json();
    expect(first.members).toHaveLength(50);
    expect(first.next).toBe('member-049');
    expect(second.members.map((m: { userId: string }) => m.userId)).toEqual([
      'member-050',
      'member-051',
      'member-052',
    ]);
    expect(second.next).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain('private-test-hash');
  });
  it('lets a member change their own password and revokes every existing session', async () => {
    const { url, create, login, post } = await setup();
    await create('alice');
    const first = await login('alice');
    const second = await login('alice');
    expect(
      (
        await post(
          '/api/v1/auth/password',
          { currentPassword: 'wrong', newPassword: 'new-password-123456' },
          first.cookie,
        )
      ).status,
    ).toBe(400);
    const changed = await post(
      '/api/v1/auth/password',
      { currentPassword: password, newPassword: 'new-password-123456' },
      first.cookie,
    );
    expect(changed.status).toBe(200);
    expect(changed.headers.get('set-cookie')).toContain('Max-Age=0');
    expect(
      (await fetch(`${url}/api/v1/auth/me`, { headers: { cookie: second.cookie } })).status,
    ).toBe(401);
    expect(
      (
        await post('/api/v1/auth/login', {
          tenantId: 'demo',
          userId: 'alice',
          password: 'new-password-123456',
        })
      ).status,
    ).toBe(200);
  });
  it('preserves existing user ownership and API tokens; stores no plaintext password or session token', async () => {
    const { h, url, create, login, post } = await setup();
    await h.ctx.storage.ensureConversation('existing-alice', {
      tenantId: 'demo',
      userId: 'alice',
      permissions: ['READ'],
    });
    expect((await create('alice')).status).toBe(201);
    const { cookie, response } = await login('alice');
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Strict/);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      identity: { userId: 'alice', role: 'agent', manageMembers: false },
    });
    expect(JSON.stringify(body)).not.toContain(password);
    const account = await h.ctx.identity.store.account('demo', 'alice');
    expect(account!.passwordHash).toMatch(/^scrypt-32768-8-3\$/);
    expect(account!.passwordHash).not.toContain(password);
    const session = await h.ctx.identity.store.session(sessionHash(cookie.split('=')[1]!));
    expect(JSON.stringify(session)).not.toContain(cookie.split('=')[1]!);
    const list = await fetch(`${url}/api/v1/conversations`, { headers: { cookie } });
    expect((await list.json()).conversations[0].id).toBe('existing-alice');
    const chat = await post(
      '/api/v1/chat',
      { conversationId: 'identity-chat', message: 'VCD-2000 E102' },
      cookie,
    );
    expect(chat.status).toBe(200);
    expect(await chat.text()).toContain('event: answer.completed');
    expect((await post('/api/v1/members/list', {}, cookie)).status).toBe(403);
    // A demoted local account cannot retain its former administrator role through a legacy key.
    expect((await post('/api/v1/members/list', {}, undefined, 'legacy')).status).toBe(403);
    expect(
      (await fetch(`${url}/api/v1/conversations`, { headers: { authorization: 'Bearer legacy' } }))
        .status,
    ).toBe(200);
    const bob = await post(
      '/api/v1/members/create',
      {
        userId: 'bob',
        displayName: 'Bob',
        role: 'agent',
        password,
        tenantId: 'other',
        managePlugins: true,
      },
      undefined,
      'bootstrap',
    );
    expect(bob.status).toBe(400);
  });
  it('separates tenant administration, knowledge editing and Ops credentials', async () => {
    const { h, url, create, login, post } = await setup();
    expect((await create('admin', 'tenant-admin')).status).toBe(201);
    expect((await create('editor', 'knowledge-editor')).status).toBe(201);
    expect((await create('agent')).status).toBe(201);
    const editor = await login('editor');
    const agent = await login('agent');
    const manager = await login('admin');
    const document = {
      id: 'identity-doc',
      title: 'Identity FAQ',
      content: 'Only tenant knowledge.',
      metadata: {},
    };
    expect((await post('/api/v1/knowledge', document, editor.cookie)).status).toBe(201);
    expect((await post('/api/v1/knowledge', document, agent.cookie)).status).toBe(403);
    expect((await post('/api/v1/members/list', {}, editor.cookie)).status).toBe(403);
    expect((await post('/api/v1/members/list', {}, manager.cookie)).status).toBe(200);
    const own = await (await post('/api/v1/members/list', {}, manager.cookie)).json();
    expect(JSON.stringify(own)).not.toContain('passwordHash');
    const other = await (await post('/api/v1/members/list', {}, undefined, 'other')).json();
    expect(other.members).toEqual([]);
    expect(
      (
        await post(
          '/api/v1/members/update',
          { userId: 'agent', version: 0, active: false },
          undefined,
          'other',
        )
      ).status,
    ).toBe(404);
    const opsUrl = `http://127.0.0.1:${h.opsPort}`;
    expect(
      (await fetch(`${opsUrl}/api/v1/ops/access`, { headers: { cookie: manager.cookie } })).status,
    ).toBe(401);
    expect(
      (await fetch(`${url}/api/v1/auth/me`, { headers: { authorization: 'Bearer ops' } })).status,
    ).toBe(401);
    expect(
      (await fetch(`${opsUrl}/api/v1/ops/access`, { headers: { authorization: 'Bearer ops' } }))
        .status,
    ).toBe(200);
  });
  it('revokes sessions on password reset, role change, disable and logout, with optimistic concurrency', async () => {
    const { url, create, login, post } = await setup();
    await create('alice');
    const first = await login('alice');
    const second = await login('alice');
    const me = (cookie: string) => fetch(`${url}/api/v1/auth/me`, { headers: { cookie } });
    expect((await post('/api/v1/auth/logout', {}, first.cookie)).status).toBe(200);
    expect((await me(first.cookie)).status).toBe(401);
    expect((await me(second.cookie)).status).toBe(200);
    expect(
      (
        await post(
          '/api/v1/members/update',
          { userId: 'alice', version: 0, role: 'knowledge-editor' },
          undefined,
          'bootstrap',
        )
      ).status,
    ).toBe(200);
    expect((await me(second.cookie)).status).toBe(401);
    expect(
      (
        await post(
          '/api/v1/members/update',
          { userId: 'alice', version: 0, active: false },
          undefined,
          'bootstrap',
        )
      ).status,
    ).toBe(409);
    const third = await login('alice');
    expect(
      (
        await post(
          '/api/v1/members/update',
          { userId: 'alice', version: 1, password: 'changed-password-123456' },
          undefined,
          'bootstrap',
        )
      ).status,
    ).toBe(200);
    expect((await me(third.cookie)).status).toBe(401);
    expect(
      (await post('/api/v1/auth/login', { tenantId: 'demo', userId: 'alice', password })).status,
    ).toBe(401);
    const updated = await post('/api/v1/auth/login', {
      tenantId: 'demo',
      userId: 'alice',
      password: 'changed-password-123456',
    });
    expect(updated.status).toBe(200);
    expect(
      (
        await post(
          '/api/v1/members/update',
          { userId: 'alice', version: 2, active: false },
          undefined,
          'bootstrap',
        )
      ).status,
    ).toBe(200);
    expect((await me(updated.headers.get('set-cookie')!.split(';')[0]!)).status).toBe(401);
    expect(
      (await fetch(`${url}/api/v1/conversations`, { headers: { authorization: 'Bearer legacy' } }))
        .status,
    ).toBe(401);
    expect(
      (
        await post(
          '/api/v1/members/create',
          { userId: 'admin', displayName: 'Admin', role: 'agent', password },
          undefined,
          'bootstrap',
        )
      ).status,
    ).toBe(409);
    await create('admin', 'tenant-admin');
    expect(
      (
        await post(
          '/api/v1/members/update',
          { userId: 'admin', version: 0, active: false },
          undefined,
          'bootstrap',
        )
      ).status,
    ).toBe(409);
  });
  it('rejects expired sessions, invalid explicit bearer tokens, duplicate cookies and cross-origin writes', async () => {
    const { h, url, create, login, post } = await setup();
    await create('alice');
    const { cookie } = await login('alice');
    const loginBody = JSON.stringify({ tenantId: 'demo', userId: 'alice', password });
    expect(
      (await fetch(`${url}/api/v1/auth/login`, { method: 'POST', body: loginBody })).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/v1/auth/login`, {
          method: 'POST',
          headers: { origin: 'https://evil.example' },
          body: loginBody,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/v1/conversations/history`, {
          method: 'POST',
          headers: { cookie },
          body: JSON.stringify({ conversationId: 'any' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/v1/conversations`, {
          headers: { cookie, authorization: 'Bearer invalid' },
        })
      ).status,
    ).toBe(401);
    expect(
      (await fetch(`${url}/api/v1/auth/me`, { headers: { cookie: `${cookie}; ${cookie}` } }))
        .status,
    ).toBe(401);
    const hash = sessionHash(cookie.split('=')[1]!);
    await h.ctx.identity.store.deleteSession(hash);
    await h.ctx.identity.store.saveSession({
      hash,
      tenantId: 'demo',
      userId: 'alice',
      version: 0,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect((await fetch(`${url}/api/v1/conversations`, { headers: { cookie } })).status).toBe(401);
    expect(
      (await post('/api/v1/auth/login', { tenantId: 'demo', userId: 'missing', password })).status,
    ).toBe(401);
  });
  it('limits repeated login attempts and leaves local identity disabled by default', async () => {
    const { h, post, create } = await setup();
    await create('alice');
    for (let i = 0; i < 10; i++)
      await h.ctx.cache.rateLimit(
        `auth:login:${sessionHash(JSON.stringify(['demo', 'alice']))}`,
        10,
        900,
      );
    expect(
      (await post('/api/v1/auth/login', { tenantId: 'demo', userId: 'alice', password })).status,
    ).toBe(429);
    const disabled = await makeHarness({ PORT: '0' });
    harnesses.push(disabled);
    const url = `http://127.0.0.1:${await disabled.start()}`;
    expect((await fetch(`${url}/api/v1/auth/me`)).status).toBe(404);
    expect((await fetch(`${url}/admin/`)).status).toBe(404);
    expect((await (await fetch(`${url}/api/v1/client-config`)).json()).localAuthEnabled).toBe(
      false,
    );
  });
});
