import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { makeHarness } from './helpers.js';
import {
  credentialHash,
  ApplicationAccessService,
} from '../src/core/applications/application.service.js';
import { applicationKeySchema } from '../src/core/http/application-auth.js';
import { redactTrace } from '../src/plugins/ops-console/redact.js';
import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';
import { InMemoryStorage } from '../src/plugins/storage-memory/index.js';
import { cacheMemoryPlugin } from '../src/plugins/cache-memory/index.js';
import { vectorMemoryPlugin } from '../src/plugins/vector-memory/index.js';
import { modelMockPlugin } from '../src/plugins/model-mock/index.js';
import type { Context } from 'cordis';
import type { Principal } from '../src/core/common.types.js';

const admin: Principal = {
  tenantId: 'company',
  userId: 'admin',
  permissions: ['READ'],
  admin: true,
};
const envSecret = 'test-initial-environment-application-key-000';
const environment = {
  [envSecret]: { tenantId: 'company', applicationId: 'device', knowledgeSpaceId: 'manuals' },
};
const harnesses: Awaited<ReturnType<typeof makeHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
async function setup() {
  const h = await makeHarness({
    PORT: '0',
    LOCAL_AUTH_ENABLED: 'true',
    APPLICATION_KEYS: JSON.stringify(environment),
    API_KEYS: JSON.stringify({
      admin,
      other: { ...admin, tenantId: 'other' },
      user: { ...admin, admin: false },
    }),
    SEED_KNOWLEDGE: 'false',
  });
  harnesses.push(h);
  const url = `http://127.0.0.1:${await h.start()}`;
  const post = (path: string, input: unknown, token = 'admin') =>
    fetch(`${url}/api/v1/applications${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
  const access = (token: string) =>
    fetch(`${url}/api/v1/conversations`, { headers: { authorization: `Bearer ${token}` } });
  const issue = async (applicationId = 'device', input = {}) => {
    const response = await post('/keys/issue', {
      applicationId,
      label: 'Test credential',
      ...input,
    });
    expect(response.status).toBe(201);
    return response.json() as Promise<{ secret: string; key: { id: string } }>;
  };
  return { h, url, post, access, issue };
}

describe('online application management', () => {
  it('validates live authentication after reading persisted credentials instead of requiring their plaintext in env', async () => {
    const storage = new InMemoryStorage();
    const providers = {
      storage: {
        name: 'test-storage',
        provide: ['storage'],
        apply(ctx: Context) {
          ctx.provide('storage', storage);
        },
      },
      cache: cacheMemoryPlugin,
      vector: vectorMemoryPlugin,
      model: modelMockPlugin,
      embedding: {
        name: 'test-embedding',
        provide: ['embedding'],
        apply(ctx: Context) {
          ctx.provide('embedding', {
            embed: async () => [1],
            embedMany: async (texts: string[]) => texts.map(() => [1]),
          });
        },
      },
    };
    const config = loadConfig({ APP_MODE: 'live', PORT: '0', SEED_KNOWLEDGE: 'false' });
    await expect(createHarness(config, { quiet: true, providers })).rejects.toMatchObject({
      code: 'MISSING_AUTH_CREDENTIALS',
    });
    const persisted = new ApplicationAccessService(storage.applications);
    await persisted.create(admin, {
      applicationId: 'persisted',
      knowledgeSpaceId: 'manuals',
      name: 'Persisted',
    });
    const issued = await persisted.issue(admin, {
      applicationId: 'persisted',
      label: 'Stored only',
    });
    await expect(
      createHarness(
        { ...config, API_KEYS: { [issued.secret]: admin } },
        { quiet: true, providers },
      ),
    ).rejects.toMatchObject({ code: 'APPLICATION_KEY_REUSED' });
    const h = await createHarness(config, { quiet: true, providers });
    harnesses.push(h);
    expect((await h.ctx.applicationAccess.resolve(issued.secret))?.applicationId).toBe('persisted');
  });
  it('applies same-origin checks to cookie-authenticated management requests', async () => {
    const { h, url, post } = await setup();
    await h.ctx.identity.create(admin, {
      userId: 'admin',
      displayName: 'Admin',
      role: 'tenant-admin',
      password: 'management-test-password',
    });
    const login = await fetch(`${url}/api/v1/auth/login`, {
      method: 'POST',
      headers: { origin: url },
      body: JSON.stringify({
        tenantId: 'company',
        userId: 'admin',
        password: 'management-test-password',
      }),
    });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const body = JSON.stringify({
      applicationId: 'cookie-app',
      name: 'Cookie app',
      knowledgeSpaceId: 'manuals',
    });
    expect(
      (
        await fetch(`${url}/api/v1/applications/create`, {
          method: 'POST',
          headers: { cookie },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/v1/applications/create`, {
          method: 'POST',
          headers: { cookie, origin: 'https://evil.test' },
          body,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(`${url}/api/v1/applications/create`, {
          method: 'POST',
          headers: { cookie, origin: url },
          body,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await post('/create', {
          applicationId: 'device',
          name: 'Duplicate',
          knowledgeSpaceId: 'manuals',
        })
      ).status,
    ).toBe(409);
  });
  it('issues usable credentials immediately, only exposes the secret once and stores only its hash', async () => {
    const { h, post, access, issue } = await setup();
    const created = await post('/create', {
      applicationId: 'vcd55',
      knowledgeSpaceId: 'vcd55',
      name: 'VCD 5.5',
    });
    expect(created.status).toBe(201);
    expect(created.headers.get('cache-control')).toBe('no-store');
    const issued = await issue('vcd55');
    await expect(h.ctx.applicationAccess.assertSeparateKeys([issued.secret])).rejects.toMatchObject(
      { code: 'APPLICATION_KEY_REUSED' },
    );
    expect(issued.secret).toMatch(/^ava_app_[A-Za-z0-9_-]{43}$/);
    expect((await access(issued.secret)).status).toBe(200);
    const stored = await h.ctx.storage.applications!.credential(credentialHash(issued.secret));
    expect(stored?.hash).toHaveLength(64);
    expect(JSON.stringify(stored)).not.toContain(issued.secret);
    const view = await (await post('/keys/list', { applicationId: 'vcd55' })).json();
    expect(view.keys[0].id).toBe(issued.key.id);
    expect(JSON.stringify(view)).not.toContain(issued.secret);
    expect(JSON.stringify(view)).not.toContain('hash');
    expect(redactTrace(`copied key ${issued.secret}`)).toBe('copied key [REDACTED]');
  });
  it('revokes immediately across service instances and does not resurrect environment keys on re-import', async () => {
    const { h, post, access } = await setup();
    expect((await access(envSecret)).status).toBe(200);
    const key = (await (await post('/keys/list', { applicationId: 'device' })).json()).keys[0];
    expect((await post('/keys/revoke', { applicationId: 'device', keyId: key.id })).status).toBe(
      200,
    );
    expect((await access(envSecret)).status).toBe(401);
    const fresh = new ApplicationAccessService(h.ctx.storage.applications);
    await fresh.importEnvironment({
      [envSecret]: applicationKeySchema.parse(environment[envSecret]),
    });
    await expect(fresh.resolve(envSecret)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect((await post('/keys/revoke', { applicationId: 'device', keyId: key.id })).status).toBe(
      200,
    );
    const listing = await (await post('/keys/list', { applicationId: 'device' })).json();
    expect(listing.keys).toHaveLength(1);
    expect(listing.keys[0].revokedAt).toBeTruthy();
  });
  it('disables all keys instantly, keeps rotation ownership and prevents stale edits or knowledge re-binding', async () => {
    const { h, post, access, issue } = await setup();
    const oldPrincipal = await h.ctx.applicationAccess.resolve(envSecret);
    await h.ctx.storage.ensureConversation('rotation-owned', oldPrincipal!);
    const rotated = await issue();
    expect((await (await access(rotated.secret)).json()).conversations[0].id).toBe(
      'rotation-owned',
    );
    expect(
      (await post('/update', { applicationId: 'device', version: 0, active: false })).status,
    ).toBe(200);
    expect((await access(envSecret)).status).toBe(401);
    expect((await access(rotated.secret)).status).toBe(401);
    await h.ctx.applicationAccess.importEnvironment({
      [envSecret]: applicationKeySchema.parse(environment[envSecret]),
    });
    expect((await access(envSecret)).status).toBe(401);
    expect((await post('/keys/issue', { applicationId: 'device', label: 'Disabled' })).status).toBe(
      409,
    );
    expect(
      (await post('/update', { applicationId: 'device', version: 0, active: true })).status,
    ).toBe(409);
    expect(
      (await post('/update', { applicationId: 'device', version: 1, active: true })).status,
    ).toBe(200);
    expect((await access(rotated.secret)).status).toBe(200);
    expect(
      (
        await post('/update', {
          applicationId: 'device',
          version: 2,
          active: true,
          knowledgeSpaceId: 'other',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post('/keys/issue', {
          applicationId: 'device',
          label: 'Past',
          expiresAt: '2000-01-01T00:00:00Z',
        })
      ).status,
    ).toBe(400);
  });
  it('enforces tenant ownership, administrator rights and strict inputs for each action', async () => {
    const { post, issue } = await setup();
    const key = await issue();
    for (const token of ['user', envSecret, key.secret])
      expect((await post('/list', {}, token)).status).toBe(403);
    expect((await (await post('/list', {}, 'other')).json()).applications).toEqual([]);
    expect((await post('/keys/list', { applicationId: 'device' }, 'other')).status).toBe(404);
    expect(
      (await post('/keys/revoke', { applicationId: 'device', keyId: key.key.id }, 'other')).status,
    ).toBe(404);
    expect(
      (await post('/keys/revoke', { applicationId: 'device', keyId: randomUUID() })).status,
    ).toBe(404);
    expect(
      (
        await post('/create', {
          applicationId: 'stolen',
          knowledgeSpaceId: 'manuals',
          name: 'Stolen',
          tenantId: 'other',
        })
      ).status,
    ).toBe(400);
    expect(
      (await post('/keys/issue', { applicationId: 'device', label: 'Escalate', admin: true }))
        .status,
    ).toBe(400);
    expect(
      (
        await post('/keys/issue', {
          applicationId: 'device',
          label: 'Empty',
          allowChat: false,
          manageKnowledge: false,
        })
      ).status,
    ).toBe(400);
  });
  it('retains imported database authority and fails closed on a changed environment binding', async () => {
    const { h } = await setup();
    const fresh = new ApplicationAccessService(h.ctx.storage.applications);
    await fresh.importEnvironment({
      [envSecret]: applicationKeySchema.parse({
        ...environment[envSecret],
        permissions: ['READ', 'WRITE'],
        manageKnowledge: true,
      }),
    });
    expect((await fresh.resolve(envSecret))?.permissions).toEqual(['READ']);
    expect((await fresh.resolve(envSecret))?.manageKnowledge).toBe(false);
    await expect(
      fresh.importEnvironment({
        [envSecret]: applicationKeySchema.parse({
          ...environment[envSecret],
          knowledgeSpaceId: 'changed',
        }),
      }),
    ).rejects.toMatchObject({ code: 'APPLICATION_BINDING_CONFLICT' });
  });
});
