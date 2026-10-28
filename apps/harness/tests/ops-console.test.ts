import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHarness } from '../src/bootstrap/plugins.js';
import { validateExtensions } from '../src/bootstrap/extensions.js';
import { loadConfig } from '../src/config/index.js';
import { H3HttpService } from '../src/plugins/http-h3/http.service.js';
import { principal } from './helpers.js';

const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
});
const settings = {
  NODE_ENV: 'test',
  PORT: '0',
  SEED_KNOWLEDGE: 'false',
  API_KEYS: JSON.stringify({
    customer: principal,
    business: { ...principal, admin: true },
    legacy: { ...principal, admin: true, managePlugins: true },
  }),
  OPS_ENABLED: 'true',
  OPS_PORT: '0',
  OPS_API_KEYS: JSON.stringify({
    maintainer: { ...principal, admin: true, managePlugins: true },
    incomplete: { ...principal, admin: true },
  }),
};
async function setup(env: NodeJS.ProcessEnv = settings) {
  const h = await createHarness(loadConfig(env), { quiet: true });
  harnesses.push(h);
  return h;
}
const authorization = (token: string) => ({ authorization: `Bearer ${token}` });

describe('Built-in Ops maintenance console', () => {
  it('is absent by default, including all management API routes', async () => {
    const h = await setup({ NODE_ENV: 'test', PORT: '0', SEED_KNOWLEDGE: 'false' });
    const url = `http://127.0.0.1:${await h.start()}`;
    expect(h.opsPort).toBeUndefined();
    expect(h.ctx.ops).toBeUndefined();
    await expect(h.start()).rejects.toThrow(/already started/);
    for (const [method, path] of [
      ['GET', ''],
      ['POST', '/install'],
      ['POST', '/action'],
      ['POST', '/configure'],
    ])
      expect((await fetch(`${url}/api/v1/plugins${path}`, { method })).status).toBe(404);
    expect((await fetch(`${url}/health`)).status).toBe(200);
  });

  it('requires separate privileged maintenance credentials before enabling the listener', () => {
    expect(loadConfig({}).OPS_HOST).toBe('127.0.0.1');
    expect(() => loadConfig({ ...settings, OPS_API_KEYS: '{}' })).toThrow(/OPS_API_KEYS/);
    expect(() =>
      loadConfig({
        ...settings,
        OPS_API_KEYS: JSON.stringify({ business: { ...principal, admin: true } }),
      }),
    ).toThrow(/OPS_API_KEYS/);
    expect(() => loadConfig({ ...settings, OPS_API_KEYS: settings.API_KEYS })).toThrow(/reuse/);
  });

  it('serves only maintenance assets and APIs on the dedicated listener, without credential crossover', async () => {
    const h = await setup();
    const publicUrl = `http://127.0.0.1:${await h.start()}`;
    const opsUrl = `http://127.0.0.1:${h.opsPort}`;
    expect(h.opsPort).toBeDefined();
    await expect(h.start()).rejects.toThrow(/already started/);
    const page = await fetch(opsUrl);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Harness Ops');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'self'");
    for (const [method, path] of [
      ['GET', ''],
      ['POST', '/install'],
      ['POST', '/action'],
      ['POST', '/configure'],
    ]) {
      expect(
        (
          await fetch(`${publicUrl}/api/v1/plugins${path}`, {
            method,
            headers: authorization('legacy'),
          })
        ).status,
      ).toBe(404);
      expect((await fetch(`${opsUrl}/api/v1/plugins${path}`, { method })).status).toBe(401);
    }
    for (const token of ['customer', 'business', 'legacy'])
      expect(
        (await fetch(`${opsUrl}/api/v1/plugins`, { headers: authorization(token) })).status,
      ).toBe(401);
    expect(
      (await fetch(`${opsUrl}/api/v1/plugins`, { headers: authorization('incomplete') })).status,
    ).toBe(403);
    const snapshot = await fetch(`${opsUrl}/api/v1/plugins`, {
      headers: authorization('maintainer'),
    });
    expect(snapshot.status).toBe(200);
    expect(await snapshot.json()).toMatchObject({ plugins: [] });
    expect((await fetch(`${opsUrl}/api/v1/chat`, { method: 'POST' })).status).toBe(404);
    expect((await fetch(`${opsUrl}/api/v1/client-config`)).status).toBe(404);
    expect(
      (await fetch(`${publicUrl}/api/v1/conversations`, { headers: authorization('maintainer') }))
        .status,
    ).toBe(401);
    expect(
      (await fetch(`${publicUrl}/api/v1/conversations`, { headers: authorization('customer') }))
        .status,
    ).toBe(200);
    await h.stop();
    expect(h.opsPort).toBeUndefined();
    await expect(fetch(opsUrl)).rejects.toThrow();
  });

  it('reserves the maintenance service against managed plugin replacement', () => {
    expect(() =>
      validateExtensions(
        { plugins: [{ name: 'override-ops', provide: ['ops'], apply() {} }] },
        true,
      ),
    ).toThrow(/不能覆盖 ops/);
  });

  it('closes the Ops listener if the public listener fails to start', async () => {
    const occupied = new H3HttpService();
    const port = await occupied.start(0);
    try {
      const h = await setup({ ...settings, PORT: String(port) });
      const started = vi.spyOn(h.ctx.ops, 'start');
      await expect(h.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      const opsPort = await started.mock.results[0]!.value;
      expect(h.opsPort).toBeUndefined();
      await expect(fetch(`http://127.0.0.1:${opsPort}`)).rejects.toThrow();
    } finally {
      await occupied.stop();
    }
  });

  it('does not open the public listener when the Ops port is occupied', async () => {
    const occupied = new H3HttpService();
    const port = await occupied.start(0);
    try {
      const h = await setup({ ...settings, OPS_PORT: String(port) });
      const publicStart = vi.spyOn(h.ctx.http, 'start');
      await expect(h.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(publicStart).not.toHaveBeenCalled();
      expect(h.opsPort).toBeUndefined();
    } finally {
      await occupied.stop();
    }
  });
});
