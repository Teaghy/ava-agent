import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { crc32, deflateRawSync } from 'node:zlib';
import { createHarness } from '../src/bootstrap/plugins.js';
import { loadConfig } from '../src/config/index.js';
import { unpackPlugin } from '../src/plugins/plugin-manager/package.js';
import { principal } from './helpers.js';

const roots: string[] = [],
  servers: Awaited<ReturnType<typeof createHarness>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.stop()));
  for (const root of roots.splice(0)) {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid fixture root');
    await rm(root, { recursive: true, force: true });
  }
  delete (globalThis as Record<string, unknown>).uploadedPluginImported;
});
// Stored ZIP fixture writer; production extraction uses yauzl.
function zip(
  files: {
    name: string;
    content: string;
    attributes?: number;
    size?: number;
    flags?: number;
    compressed?: boolean;
  }[],
): Buffer {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name),
      original = Buffer.from(f.content),
      content = f.compressed ? deflateRawSync(original) : original,
      crc = crc32(original);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(f.flags ?? 0, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt16LE(f.compressed ? 8 : 0, 8);
    header.writeUInt32LE(content.length, 18);
    header.writeUInt32LE(f.size ?? original.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, content);
    const row = Buffer.alloc(46);
    row.writeUInt32LE(0x02014b50);
    row.writeUInt16LE(0x0314, 4);
    row.writeUInt16LE(20, 6);
    row.writeUInt16LE(f.flags ?? 0, 8);
    row.writeUInt32LE(crc, 16);
    row.writeUInt32LE(content.length, 20);
    row.writeUInt16LE(f.compressed ? 8 : 0, 10);
    row.writeUInt32LE(f.size ?? original.length, 24);
    row.writeUInt16LE(name.length, 28);
    row.writeUInt32LE(f.attributes ?? 0, 38);
    row.writeUInt32LE(offset, 42);
    central.push(row, name);
    offset += header.length + name.length + content.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const manifest = {
  name: '上传决策',
  version: '1.0.0',
  entry: 'dist/index.mjs',
  kind: 'provider',
  slot: 'decision',
};
const source = `globalThis.uploadedPluginImported = true; export default { name:'uploaded-decision', provide:['decision'], apply(ctx){ctx.provide('decision',{async decide(){return {type:'ask_user', question:'来自上传包'};}});} };`;
function archive(overrides = {}, code = source) {
  return zip([
    {
      name: 'ava-plugin.json',
      content: JSON.stringify({ ...manifest, ...overrides }),
      compressed: true,
    },
    { name: 'dist/index.mjs', content: code, compressed: true },
  ]);
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ava-upload-'));
  roots.push(root);
  const statePath = join(root, 'plugins.json');
  const config = loadConfig({
    NODE_ENV: 'test',
    APP_MODE: 'mock',
    INFRA_MODE: 'memory',
    SEED_KNOWLEDGE: 'false',
    PORT: '0',
    OPS_ENABLED: 'true',
    OPS_PORT: '0',
    API_KEYS: JSON.stringify({ business: { ...principal, admin: true } }),
    OPS_API_KEYS: JSON.stringify({
      manager: { ...principal, admin: true, managePlugins: true },
      viewer: { ...principal, inspectRuns: true },
    }),
  });
  const h = await createHarness(config, { quiet: true, pluginManagement: { statePath } });
  servers.push(h);
  const publicUrl = `http://127.0.0.1:${await h.start()}`,
    opsUrl = `http://127.0.0.1:${h.opsPort}`;
  const upload = (
    bytes: Uint8Array,
    token = 'manager',
    contentType = 'application/zip',
    base = opsUrl,
  ) =>
    fetch(`${base}/api/v1/plugins/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': contentType },
      body: new Blob([Buffer.from(bytes)]),
    });
  return { root, statePath, h, upload, config, publicUrl };
}

it('uploads without executing, enables a provider, restores it after a bad update, and persists across restart', async () => {
  const { h, upload, config, statePath } = await setup();
  const response = await upload(archive());
  expect(response.status).toBe(201);
  const installed = (await response.json()).plugins[0];
  expect(installed).toMatchObject({
    name: manifest.name,
    version: '1.0.0',
    enabled: false,
    status: 'disabled',
  });
  expect((globalThis as Record<string, unknown>).uploadedPluginImported).toBeUndefined();
  await h.pluginManager.action({ id: installed.id, action: 'enable' });
  const answer = async () =>
    (await h.ctx.agent.run({ conversationId: crypto.randomUUID(), message: 'hello', principal }))
      .answer;
  expect(await answer()).toBe('来自上传包');
  const update = await (
    await upload(
      archive(
        { version: '2.0.0' },
        "export default {name:'bad',provide:['decision'],apply(){throw new Error('bad update');}}",
      ),
    )
  ).json();
  expect(update.plugins[1].entry).not.toBe(installed.entry);
  await expect(
    h.pluginManager.action({ id: update.plugins[1].id, action: 'enable' }),
  ).rejects.toThrow();
  expect(await answer()).toBe('来自上传包');
  await h.stop();
  const restarted = await createHarness(config, { quiet: true, pluginManagement: { statePath } });
  servers.push(restarted);
  expect(restarted.pluginManager.snapshot().plugins[0]?.status).toBe('active');
  expect(
    (
      await restarted.ctx.agent.run({
        conversationId: crypto.randomUUID(),
        message: 'hello',
        principal,
      })
    ).answer,
  ).toBe('来自上传包');
});

it('authorizes before parsing uploads, isolates the listener, and bounds the HTTP body', async () => {
  const { upload, publicUrl, root } = await setup();
  for (const token of ['viewer', 'business', 'invalid'])
    expect((await upload(Buffer.from('bad'), token)).status).toBe(token === 'viewer' ? 403 : 401);
  expect((await upload(archive(), 'manager', 'application/zip', publicUrl)).status).toBe(404);
  expect((await upload(archive(), 'manager', 'application/json')).status).toBe(415);
  expect((await upload(Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(413);
  expect(await readdir(root)).toEqual([]);
});

it('rejects unsafe ZIP paths, symlinks, duplicates, encryption and oversized archives without leftover files', async () => {
  const { statePath, root } = await setup();
  for (const files of [
    [{ name: '../escape.mjs', content: 'bad' }],
    [{ name: 'C:/escape.js', content: 'bad' }],
    [{ name: 'dist\\escape.js', content: 'bad' }],
    [{ name: 'NUL.js', content: 'bad' }],
    [{ name: 'link', content: 'target', attributes: (0xa1ff << 16) >>> 0 }],
    [
      { name: 'file', content: 'a' },
      { name: 'FILE', content: 'b' },
    ],
    [{ name: 'a', content: 'bad', flags: 1 }],
    [{ name: 'huge', content: 'small', size: 60 * 1024 * 1024 }],
    Array.from({ length: 501 }, (_, i) => ({ name: `f${i}`, content: '' })),
  ])
    await expect(unpackPlugin(zip(files), statePath)).rejects.toMatchObject({
      code: 'INVALID_PLUGIN_PACKAGE',
    });
  for (const bytes of [
    Buffer.from('not zip'),
    archive({ entry: '../outside.mjs' }),
    archive({ kind: 'extension' }),
    archive({ version: '../bad' }),
  ])
    await expect(unpackPlugin(bytes, statePath)).rejects.toMatchObject({
      code: 'INVALID_PLUGIN_PACKAGE',
    });
  expect(await readdir(join(root, 'packages'))).toEqual([]);
});

it('cleans extracted files when the entry is missing or registration cannot be persisted', async () => {
  const { h, upload, statePath, root } = await setup();
  expect((await upload(archive({ entry: 'missing.mjs' }))).status).toBe(400);
  expect(await readdir(join(root, 'packages'))).toEqual([]);
  await mkdir(statePath);
  await expect(h.pluginManager.upload(archive())).rejects.toMatchObject({
    code: 'PLUGIN_STATE_WRITE_FAILED',
  });
  expect(h.pluginManager.snapshot().plugins).toEqual([]);
  expect(await readdir(join(root, 'packages'))).toEqual([]);
});
