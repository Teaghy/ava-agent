import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { loadApplicationConfig } from '../src/bootstrap/application-config.js';
import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';

const roots: string[] = [];
const harnesses: Awaited<ReturnType<typeof createHarness>>[] = [];
afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((h) => h.stop()));
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture root');
    await rm(root, { recursive: true, force: true });
  }
});
async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'ava-config-test-'));
  roots.push(root);
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  return root;
}

describe('Application plugin configuration', () => {
  it('retains default behavior when a deployment has no application config', async () => {
    const root = await workspace();
    expect(await loadApplicationConfig({ root, source: false })).toEqual({});
  });

  it('loads the source config in development', async () => {
    const root = await workspace();
    await writeFile(
      join(root, 'ava.config.ts'),
      'export default { demoTools: false, systemPrompt: "客服配置" };',
    );
    expect(await loadApplicationConfig({ root, source: true })).toMatchObject({
      demoTools: false,
      systemPrompt: '客服配置',
    });
  });

  it('loads the compiled config in production without evaluating its TypeScript source', async () => {
    const root = await workspace();
    await mkdir(join(root, '.ava'));
    await writeFile(join(root, 'ava.config.ts'), 'throw new Error("source must not run");');
    await writeFile(
      join(root, '.ava', 'ava.config.js'),
      'export default { systemPrompt: "compiled" };',
    );
    expect(await loadApplicationConfig({ root, source: false })).toMatchObject({
      systemPrompt: 'compiled',
    });
  });

  it('fails instead of silently ignoring an unbuilt production config', async () => {
    const root = await workspace();
    await writeFile(join(root, 'ava.config.ts'), 'export default { demoTools: false };');
    await expect(loadApplicationConfig({ root, source: false })).rejects.toMatchObject({
      code: 'APP_CONFIG_NOT_BUILT',
    });
  });

  it('resolves an explicit config path against the application root', async () => {
    const root = await workspace();
    await mkdir(join(root, 'config'));
    await writeFile(join(root, 'config', 'retail.mjs'), 'export default { demoTools: false };');
    expect(
      await loadApplicationConfig({ root, source: false, configPath: 'config/retail.mjs' }),
    ).toMatchObject({ demoTools: false });
    await expect(
      loadApplicationConfig({ root, source: false, configPath: 'missing.mjs' }),
    ).rejects.toMatchObject({ code: 'APP_CONFIG_NOT_FOUND' });
  });

  it.each(['export default null;', 'export default { plugnis: [] };'])(
    'rejects an invalid default export: %s',
    async (source) => {
      const root = await workspace();
      await writeFile(join(root, 'ava.config.mjs'), source);
      await expect(loadApplicationConfig({ root, source: false })).rejects.toMatchObject({
        code: 'INVALID_APP_CONFIG',
      });
    },
  );

  it('reports import failures with the config path and the original cause', async () => {
    const root = await workspace();
    await writeFile(
      join(root, 'ava.config.mjs'),
      'import "./missing-plugin.mjs"; export default {};',
    );
    await expect(loadApplicationConfig({ root, source: false })).rejects.toMatchObject({
      code: 'APP_CONFIG_LOAD_FAILED',
      message: expect.stringContaining('ava.config.mjs'),
      cause: expect.any(Error),
    });
  });

  it('loads a local plugin and serves its custom decision through the normal HTTP API', async () => {
    const root = await workspace();
    await mkdir(join(root, 'extensions'));
    await writeFile(
      join(root, 'extensions', 'orders.mjs'),
      `
      export const orders = {
        name: 'configured-order-rules', provide: ['decision'],
        apply(ctx) { ctx.provide('decision', {
          async decide() { return { type: 'ask_user', question: '请提供订单号。' }; }
        }); }
      };
    `,
    );
    await writeFile(
      join(root, 'ava.config.mjs'),
      `
      import { orders } from './extensions/orders.mjs';
      export default { demoTools: false, providers: { decision: orders, model: false } };
    `,
    );
    const options = await loadApplicationConfig({ root, source: false });
    const h = await createHarness(
      loadConfig({ NODE_ENV: 'test', SEED_KNOWLEDGE: 'false', PORT: '0' }),
      { ...options, quiet: true },
    );
    harnesses.push(h);
    const port = await h.start();
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'configured', message: '查询订单' }),
    });
    expect(response.ok).toBe(true);
    const stream = await response.text();
    expect(stream).toContain('请提供订单号。');
    expect(stream).toContain('answer.completed');
    expect(h.ctx.get('model')).toBeUndefined();
    expect(h.ctx.tools.get('create_ticket')).toBeUndefined();
  });
});
