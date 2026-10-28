import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';
import { principal } from './helpers.js';

const roots: string[] = [];
const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture root');
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ava-manager-'));
  roots.push(root);
  return { root, statePath: join(root, 'state', 'plugins.json') };
}
async function moduleFile(root: string, name: string, source: string) {
  const entry = join(root, `${name}.mjs`);
  await writeFile(entry, source);
  return entry;
}
const decisionSource = (answer: string) => `export default {
  name: 'local-decision', provide: ['decision'],
  apply(ctx, config) { ctx.provide('decision', { async decide() {
    return { type: 'ask_user', question: config.question || ${JSON.stringify(answer)} };
  } }); }
};`;
async function setup(statePath?: string, safeMode = false, timeout = 1000) {
  const h = await createHarness(
    loadConfig({
      NODE_ENV: 'test',
      PORT: '0',
      SEED_KNOWLEDGE: 'false',
      API_KEYS: JSON.stringify({
        platform: { ...principal, admin: true, managePlugins: true },
        tenant: { ...principal, admin: true },
        ordinary: principal,
      }),
    }),
    {
      quiet: true,
      startupTimeoutMs: timeout,
      ...(statePath ? { pluginManagement: { statePath, safeMode } } : {}),
    },
  );
  harnesses.push(h);
  const url = `http://127.0.0.1:${await h.start()}`;
  const request = async (path = '', body?: unknown, token: string | null = 'platform') =>
    fetch(`${url}/api/v1/plugins${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  return { h, url, request };
}
async function answer(h: Awaited<ReturnType<typeof createHarness>>) {
  return (
    await h.ctx.agent.run({ conversationId: crypto.randomUUID(), message: 'hello', principal })
  ).answer;
}

describe('Local plugin administration', () => {
  it('is disabled by default and requires a dedicated platform permission before module loading', async () => {
    const { root, statePath } = await fixture();
    const disabled = await setup();
    expect(await (await disabled.request()).json()).toMatchObject({ enabled: false, plugins: [] });
    const { request } = await setup(statePath);
    const marker = join(root, 'imported');
    const entry = await moduleFile(
      root,
      'forbidden',
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); export default { apply() {} };`,
    );
    for (const [token, status] of [
      [null, 401],
      ['invalid', 401],
      ['tenant', 403],
      ['ordinary', 403],
    ] as const) {
      expect(
        (await request('/install', { name: 'forbidden', entry, kind: 'extension' }, token)).status,
      ).toBe(status);
    }
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await request()).status).toBe(200);
  });

  it('installs a real tool extension with native config, unloads it, and restores saved records on restart', async () => {
    const { root, statePath } = await fixture();
    const entry = await moduleFile(
      root,
      'tool',
      `import { z } from ${JSON.stringify(import.meta.resolve('zod'))};
      export const name = 'external-tool'; export const inject = ['tools'];
      export const Config = z.object({ value: z.string().min(1) });
      export function apply(ctx, config) { ctx.effect(() => ctx.tools.register({
        name: 'external_echo', description: 'Echo', permission: 'READ', inputSchema: z.object({}),
        async execute() { return { value: config.value }; }
      })); }
    `,
    );
    const { h, request } = await setup(statePath);
    const installed = await request('/install', {
      name: 'Echo',
      entry,
      kind: 'extension',
      config: { value: 'private-secret' },
    });
    expect(installed.status).toBe(201);
    const snapshot = await installed.json();
    expect(JSON.stringify(snapshot)).not.toContain('private-secret');
    expect(snapshot.plugins[0]).toMatchObject({ enabled: true, status: 'active' });
    const id = snapshot.plugins[0].id;
    expect(
      await h.ctx.tools.execute(
        'external_echo',
        {},
        {
          principal,
          state: { runId: 'test' } as never,
          signal: new AbortController().signal,
          emit: async () => {},
        },
      ),
    ).toEqual({ value: 'private-secret' });
    expect((await answer(h)).length).toBeGreaterThan(0);
    await h.stop();
    const restarted = await setup(statePath);
    expect(restarted.h.ctx.tools.get('external_echo')).toBeDefined();
    expect((await restarted.request('/action', { id, action: 'disable' })).status).toBe(200);
    expect(restarted.h.ctx.tools.get('external_echo')).toBeUndefined();
    expect((await answer(restarted.h)).length).toBeGreaterThan(0);
    expect((await restarted.request('/action', { id, action: 'enable' })).status).toBe(200);
    expect((await restarted.request('/action', { id, action: 'remove' })).status).toBe(200);
    expect(restarted.h.ctx.tools.get('external_echo')).toBeUndefined();
    expect(JSON.parse(await readFile(statePath, 'utf8')).plugins).toEqual([]);
  });

  it('selects one decision provider, restores the base provider, and rolls failed activation back', async () => {
    const { root, statePath } = await fixture();
    const first = await moduleFile(root, 'first', decisionSource('first'));
    const second = await moduleFile(root, 'second', decisionSource('second'));
    const broken = await moduleFile(
      root,
      'broken',
      `export default {name:'broken',provide:['decision'],apply(){throw new Error('private activation failure')}};`,
    );
    const { h, request } = await setup(statePath);
    const install = (entry: string) =>
      request('/install', { name: entry, entry, kind: 'provider', slot: 'decision' });
    let snapshot = await (await install(first)).json();
    const firstId = snapshot.plugins[0].id;
    expect(await answer(h)).toBe('first');
    expect((await install(broken)).status).toBe(400);
    expect(await answer(h)).toBe('first');
    snapshot = await (await request()).json();
    expect(snapshot.plugins).toHaveLength(1);
    expect(snapshot.providers.find((p: { slot: string }) => p.slot === 'decision')).toMatchObject({
      source: 'plugin',
      pluginId: firstId,
    });
    snapshot = await (await install(second)).json();
    const secondId = snapshot.plugins[1].id;
    expect(snapshot.plugins[0]).toMatchObject({ enabled: false, status: 'disabled' });
    expect(await answer(h)).toBe('second');
    expect((await request('/action', { id: firstId, action: 'enable' })).status).toBe(200);
    expect(await answer(h)).toBe('first');
    expect((await request('/action', { id: firstId, action: 'disable' })).status).toBe(200);
    expect(await answer(h)).not.toBe('first');
    expect((await request('/action', { id: secondId, action: 'remove' })).status).toBe(200);
    expect(h.ctx.guard).toBeDefined();
  });

  it('rejects non-local, unbuilt, invalid, or conflicting modules without changing state', async () => {
    const { root, statePath } = await fixture();
    const { request } = await setup(statePath);
    const conflict = await moduleFile(
      root,
      'conflict',
      `export default { provide:['guard'], apply(){} };`,
    );
    const wrong = await moduleFile(
      root,
      'wrong',
      `export default { provide:['model'], apply(){} };`,
    );
    const invalid = await moduleFile(root, 'invalid', `export default 123;`);
    for (const entry of [
      'relative.mjs',
      'https://example.org/plugin.mjs',
      join(root, 'source.ts'),
      root,
      join(root, 'missing.mjs'),
      invalid,
      conflict,
    ]) {
      expect((await request('/install', { name: 'bad', entry, kind: 'extension' })).status).toBe(
        400,
      );
    }
    expect(
      (await request('/install', { name: 'bad', entry: wrong, kind: 'provider', slot: 'decision' }))
        .status,
    ).toBe(400);
    expect(
      (
        await request('/install', {
          name: 'bad',
          entry: conflict,
          kind: 'provider',
          slot: 'storage',
        })
      ).status,
    ).toBe(400);
    expect((await (await request()).json()).plugins).toEqual([]);
  });

  it('rolls runtime back if atomic persistence fails', async () => {
    const { root, statePath } = await fixture();
    const entry = await moduleFile(root, 'decision', decisionSource('persisted'));
    const { h, request } = await setup(statePath);
    const snapshot = await (
      await request('/install', { name: 'decision', entry, kind: 'provider', slot: 'decision' })
    ).json();
    const id = snapshot.plugins[0].id;
    await rm(statePath);
    await mkdir(statePath);
    expect((await request('/action', { id, action: 'disable' })).status).toBe(400);
    expect(await answer(h)).toBe('persisted');
    expect((await (await request()).json()).plugins[0]).toMatchObject({
      enabled: true,
      status: 'active',
    });
  });

  it('drains active work, gates every new run, keeps administration mounted, and resumes the agent', async () => {
    const { root, statePath } = await fixture();
    const { h, request, url } = await setup(statePath);
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.spyOn(h.ctx.decision, 'decide').mockImplementationOnce(async (_input, context) => {
      started();
      return new Promise((_resolve, reject) =>
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true,
        }),
      );
    });
    const oldAgent = h.ctx.agent;
    const run = oldAgent.run({ conversationId: 'drain', message: 'hello', principal });
    const cancelled = expect(run).rejects.toMatchObject({ code: 'RUN_CANCELLED' });
    await running;
    let activationStarted!: () => void;
    const activating = new Promise<void>((resolve) => {
      activationStarted = resolve;
    });
    let release!: () => void;
    Object.assign(globalThis, {
      avaPluginTestStarted: activationStarted,
      avaPluginTestWait: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const entry = await moduleFile(
      root,
      'slow',
      `export default {name:'slow',async apply(){globalThis.avaPluginTestStarted();await globalThis.avaPluginTestWait;}};`,
    );
    const installed = request('/install', { name: 'slow', entry, kind: 'extension' });
    await activating;
    await cancelled;
    await expect(
      oldAgent.run({ conversationId: 'paused', message: 'hello', principal }),
    ).rejects.toMatchObject({ code: 'PLUGIN_CHANGE_IN_PROGRESS' });
    const response = await fetch(`${url}/api/v1/chat`, {
      method: 'POST',
      headers: { authorization: 'Bearer platform' },
      body: JSON.stringify({ conversationId: 'paused-http', message: 'hello' }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'PLUGIN_CHANGE_IN_PROGRESS' } });
    expect((await request()).status).toBe(200);
    release();
    expect((await installed).status).toBe(201);
    expect(await answer(h)).toBeTruthy();
    delete (globalThis as Record<string, unknown>).avaPluginTestStarted;
    delete (globalThis as Record<string, unknown>).avaPluginTestWait;
  });

  it('retains native Config validation and cleans failed extension effects', async () => {
    const { root, statePath } = await fixture();
    const { h, request } = await setup(statePath);
    const invalid = await moduleFile(
      root,
      'native-config',
      `import {z} from ${JSON.stringify(import.meta.resolve('zod'))};
      export default {name:'validated',Config:z.object({secret:z.string().min(20)}),apply(){throw new Error('must validate first')}};`,
    );
    const response = await request('/install', {
      name: 'validated',
      entry: invalid,
      kind: 'extension',
      config: { secret: 'private-value' },
    });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-value');
    const broken = await moduleFile(
      root,
      'effect-failure',
      `import {z} from ${JSON.stringify(import.meta.resolve('zod'))};
      export default {name:'failed-effect',inject:['tools'],apply(ctx){
        ctx.effect(()=>ctx.tools.register({name:'failed_tool',description:'x',permission:'READ',inputSchema:z.object({}),async execute(){return {}}}));
        throw new Error('private-value');
      }};`,
    );
    expect(
      (await request('/install', { name: 'broken', entry: broken, kind: 'extension' })).status,
    ).toBe(400);
    expect(h.ctx.tools.get('failed_tool')).toBeUndefined();
    expect(await answer(h)).toBeTruthy();
    expect((await (await request()).json()).plugins).toEqual([]);
  });

  it('bounds a module import before draining and can process a later action', async () => {
    const { root, statePath } = await fixture();
    const { h, request } = await setup(statePath);
    const slow = await moduleFile(
      root,
      'never-imports',
      `await new Promise(()=>{}); export default {apply(){}};`,
    );
    const response = await request('/install', {
      name: 'never-imports',
      entry: slow,
      kind: 'extension',
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('PLUGIN_LOAD_TIMEOUT');
    expect(await answer(h)).toBeTruthy();
    const good = await moduleFile(root, 'after-timeout', decisionSource('after timeout'));
    expect(
      (await request('/install', { name: 'good', entry: good, kind: 'provider', slot: 'decision' }))
        .status,
    ).toBe(201);
    expect(await answer(h)).toBe('after timeout');
  });

  it('reconfigures the same provider and restores its previous parameters after invalid configuration', async () => {
    const { root, statePath } = await fixture();
    const entry = await moduleFile(
      root,
      'configured',
      `import {z} from ${JSON.stringify(import.meta.resolve('zod'))};
      export default {name:'configured-rules',provide:['decision'],Config:z.object({question:z.string().min(1)}),
        apply(ctx,config){ctx.provide('decision',{async decide(){return {type:'ask_user',question:config.question}}})}};`,
    );
    const { h, request } = await setup(statePath);
    const snapshot = await (
      await request('/install', {
        name: 'Rules',
        entry,
        kind: 'provider',
        slot: 'decision',
        config: { question: 'original' },
      })
    ).json();
    const id = snapshot.plugins[0].id;
    expect(await answer(h)).toBe('original');
    const response = await request('/configure', {
      id,
      config: { question: 'updated-private-config' },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('updated-private-config');
    expect(await answer(h)).toBe('updated-private-config');
    expect((await request('/configure', { id, config: { question: 42 } })).status).toBe(400);
    expect(await answer(h)).toBe('updated-private-config');
    expect(JSON.parse(await readFile(statePath, 'utf8')).plugins[0].config.question).toBe(
      'updated-private-config',
    );
    await request('/action', { id, action: 'disable' });
    expect(
      (await request('/configure', { id, config: { question: 'next-activation' } })).status,
    ).toBe(200);
    expect((await (await request()).json()).plugins[0].status).toBe('disabled');
    await request('/action', { id, action: 'enable' });
    expect(await answer(h)).toBe('next-activation');
  });

  it('restores an extension configuration when saving its replacement fails', async () => {
    const { root, statePath } = await fixture();
    const entry = await moduleFile(
      root,
      'configured-extension',
      `import {z} from ${JSON.stringify(import.meta.resolve('zod'))};
      export default {name:'configured-extension',inject:['tools'],apply(ctx,config){
        ctx.effect(()=>ctx.tools.register({name:'configured_value',description:'value',permission:'READ',inputSchema:z.object({}),async execute(){return config.value}}));
      }};`,
    );
    const { h, request } = await setup(statePath);
    const snapshot = await (
      await request('/install', {
        name: 'Configured extension',
        entry,
        kind: 'extension',
        config: { value: 'original' },
      })
    ).json();
    const id = snapshot.plugins[0].id;
    await rm(statePath);
    await mkdir(statePath);
    expect((await request('/configure', { id, config: { value: 'new' } })).status).toBe(400);
    expect(
      await h.ctx.tools.execute(
        'configured_value',
        {},
        {
          principal,
          state: { runId: 'test' } as never,
          signal: new AbortController().signal,
          emit: async () => {},
        },
      ),
    ).toBe('original');
    expect(await answer(h)).toBeTruthy();
  });

  it('fails explicit startup recovery but safe mode lists broken entries without importing them', async () => {
    const { root, statePath } = await fixture();
    await mkdir(join(root, 'state'));
    const id = crypto.randomUUID();
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        plugins: [
          {
            id,
            name: 'missing',
            entry: join(root, 'missing.mjs'),
            kind: 'provider',
            slot: 'decision',
            enabled: true,
            config: { secret: 'hidden' },
          },
        ],
      }),
    );
    await expect(setup(statePath)).rejects.toMatchObject({ code: 'PLUGIN_LOAD_FAILED' });
    const { h, request } = await setup(statePath, true);
    const snapshot = await (await request()).json();
    expect(snapshot).toMatchObject({ safeMode: true, plugins: [{ id, status: 'disabled' }] });
    expect(JSON.stringify(snapshot)).not.toContain('hidden');
    await moduleFile(root, 'missing', decisionSource('recovered'));
    expect((await request('/action', { id, action: 'enable' })).status).toBe(200);
    expect(await answer(h)).toBe('recovered');
    expect((await request('/action', { id, action: 'disable' })).status).toBe(200);
  });

  it('returns a recovery error on unresponsive activation and blocks already queued mutations', async () => {
    const { root, statePath } = await fixture();
    const { h, request } = await setup(statePath, false, 150);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    Object.assign(globalThis, { avaStuckPluginWait: waiting, avaStuckPluginStarted: started });
    const stuck = await moduleFile(
      root,
      'stuck-activation',
      `export default {name:'stuck',async apply(){globalThis.avaStuckPluginStarted();await globalThis.avaStuckPluginWait;}};`,
    );
    const marker = join(root, 'queued-imported');
    const queued = await moduleFile(
      root,
      'queued-activation',
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'imported');export default {name:'queued',apply(){}};`,
    );
    const install = vi.spyOn(h.pluginManager, 'install');
    const first = request('/install', { name: 'stuck', entry: stuck, kind: 'extension' });
    await ready;
    const second = request('/install', { name: 'queued', entry: queued, kind: 'extension' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await vi.waitFor(() => expect(install).toHaveBeenCalledTimes(2), {
        interval: 5,
        timeout: 100,
      });
      const responses = await Promise.race([
        Promise.all([first, second]),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('management requests did not settle')), 1000);
        }),
      ]);
      expect(responses[0]!.status).toBe(503);
      expect(responses[1]!.status).toBe(503);
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await (await request()).json()).plugins).toEqual([]);
      await expect(answer(h)).rejects.toMatchObject({ code: 'PLUGIN_CHANGE_IN_PROGRESS' });
    } finally {
      clearTimeout(timer);
      release();
      await Promise.allSettled([first, second]);
      delete (globalThis as Record<string, unknown>).avaStuckPluginWait;
      delete (globalThis as Record<string, unknown>).avaStuckPluginStarted;
    }
  });

  it('keeps execution paused if an active extension refuses to release its effects', async () => {
    const { root, statePath } = await fixture();
    const { h, request } = await setup(statePath, false, 100);
    let release!: () => void;
    Object.assign(globalThis, {
      avaStuckDisposer: new Promise<void>((resolve) => {
        release = resolve;
      }),
    });
    const entry = await moduleFile(
      root,
      'stuck-disposer',
      `export default {name:'stuck-disposer',apply(ctx){ctx.effect(()=>()=>globalThis.avaStuckDisposer);}};`,
    );
    const snapshot = await (
      await request('/install', { name: 'stuck disposer', entry, kind: 'extension' })
    ).json();
    try {
      expect(
        (await request('/action', { id: snapshot.plugins[0].id, action: 'disable' })).status,
      ).toBe(503);
      await expect(answer(h)).rejects.toMatchObject({ code: 'PLUGIN_CHANGE_IN_PROGRESS' });
      expect(
        (await request('/action', { id: snapshot.plugins[0].id, action: 'enable' })).status,
      ).toBe(503);
    } finally {
      release();
      delete (globalThis as Record<string, unknown>).avaStuckDisposer;
    }
  });

  it('reports a self-disposed extension as failed and allows an explicit retry', async () => {
    const { root, statePath } = await fixture();
    const { request } = await setup(statePath);
    const entry = await moduleFile(
      root,
      'self-disposer',
      `export default {name:'self-disposer',apply(ctx){globalThis.avaDisposeTestPlugin=()=>ctx.fiber.dispose();}};`,
    );
    const snapshot = await (
      await request('/install', { name: 'self disposer', entry, kind: 'extension' })
    ).json();
    const id = snapshot.plugins[0].id;
    try {
      await (
        globalThis as typeof globalThis & { avaDisposeTestPlugin(): Promise<void> }
      ).avaDisposeTestPlugin();
      expect((await (await request()).json()).plugins[0]).toMatchObject({
        id,
        enabled: true,
        status: 'failed',
      });
      expect((await request('/action', { id, action: 'enable' })).status).toBe(200);
      expect((await (await request()).json()).plugins[0].status).toBe('active');
    } finally {
      delete (globalThis as Record<string, unknown>).avaDisposeTestPlugin;
    }
  });

  it('reports the current memory provider in public client settings after a live switch', async () => {
    const { root, statePath } = await fixture();
    const { request, url } = await setup(statePath);
    const entry = await moduleFile(
      root,
      'memory',
      `export default {name:'custom-memory',provide:['memory'],apply(ctx){ctx.provide('memory',{async recall(){return []},async remember(){throw new Error('unused')},async forget(){}})}};`,
    );
    const snapshot = await (
      await request('/install', { name: 'Custom memory', entry, kind: 'provider', slot: 'memory' })
    ).json();
    expect(await (await fetch(`${url}/api/v1/client-config`)).json()).toMatchObject({
      memoryProvider: 'custom',
    });
    await request('/action', { id: snapshot.plugins[0].id, action: 'disable' });
    expect(await (await fetch(`${url}/api/v1/client-config`)).json()).toMatchObject({
      memoryProvider: 'storage',
    });
  });
});
