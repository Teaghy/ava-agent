import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  MAX_PLUGIN_UPLOAD_BYTES,
  pluginManifestSchema,
  type PluginInstallRequest,
} from '@ava/protocol';
import { AppError } from '../../core/errors.js';

const invalid = () =>
  new AppError(
    'INVALID_PLUGIN_PACKAGE',
    '插件包无效：请检查 ZIP、根目录 ava-plugin.json、入口和大小限制。',
    400,
  );
function safePath(name: string): string {
  const value = name.endsWith('/') ? name.slice(0, -1) : name;
  if (
    !value ||
    value.length > 180 ||
    value
      .split('/')
      .some(
        (part) =>
          !/^[a-zA-Z0-9_@][a-zA-Z0-9_@.-]*$/.test(part) ||
          part.endsWith('.') ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part),
      )
  )
    throw invalid();
  return value;
}

async function extract(bytes: Uint8Array, root: string): Promise<void> {
  const zip = await new Promise<ZipFile>((accept, reject) =>
    fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, file) => (error ? reject(error) : accept(file)),
    ),
  );
  try {
    let count = 0,
      expanded = 0,
      declared = 0;
    const seen = new Set<string>(),
      casing = new Map<string, string>();
    await new Promise<void>((accept, reject) => {
      zip.on('error', reject);
      zip.on('end', accept);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          const name = safePath(entry.fileName);
          const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
          const directory = entry.fileName.endsWith('/');
          if (
            ++count > 500 ||
            entry.generalPurposeBitFlag & 1 ||
            (mode && mode !== (directory ? 0x4000 : 0x8000)) ||
            seen.has(name.toLowerCase())
          )
            throw invalid();
          seen.add(name.toLowerCase());
          const parts = name.split('/');
          for (let i = 1; i <= parts.length; i++) {
            const prefix = parts.slice(0, i).join('/'),
              key = prefix.toLowerCase();
            if (casing.has(key) && casing.get(key) !== prefix) throw invalid();
            casing.set(key, prefix);
          }
          declared += entry.uncompressedSize;
          if (
            declared > 50 * 1024 * 1024 ||
            (name.toLowerCase() === 'ava-plugin.json' && entry.uncompressedSize > 16384)
          )
            throw invalid();
          const path = resolve(root, name);
          if (!path.startsWith(root + sep)) throw invalid();
          if (directory) await mkdir(path, { recursive: true });
          else {
            const stream = await new Promise<Readable>((acceptStream, rejectStream) =>
              zip.openReadStream(entry, (error, value) =>
                error ? rejectStream(error) : acceptStream(value!),
              ),
            );
            const chunks: Buffer[] = [];
            for await (const chunk of stream) {
              expanded += chunk.length;
              if (expanded > 50 * 1024 * 1024) {
                stream.destroy();
                throw invalid();
              }
              chunks.push(chunk);
            }
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, Buffer.concat(chunks), { flag: 'wx' });
          }
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

export async function unpackPlugin(
  bytes: Uint8Array,
  statePath: string,
): Promise<{ input: PluginInstallRequest; directory: string }> {
  if (!bytes.length || bytes.length > MAX_PLUGIN_UPLOAD_BYTES) throw invalid();
  const root = resolve(dirname(statePath), 'packages');
  await mkdir(root, { recursive: true });
  const staging = await mkdtemp(resolve(root, 'upload-'));
  const directory = resolve(root, randomUUID());
  try {
    await extract(bytes, staging);
    const manifest = pluginManifestSchema.parse(
      JSON.parse(await readFile(resolve(staging, 'ava-plugin.json'), 'utf8')),
    );
    const entry = safePath(manifest.entry);
    if (!/\.(js|mjs|cjs)$/.test(entry)) throw invalid();
    // No install scripts run; absent package.json defaults uploaded .js files to ESM.
    try {
      await writeFile(resolve(staging, 'package.json'), '{"type":"module"}\n', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    await mkdir(directory);
    const versionRoot = resolve(directory, manifest.version);
    await rename(staging, versionRoot);
    return {
      directory,
      input: { ...manifest, entry: resolve(versionRoot, entry), enabled: false },
    };
  } catch {
    await rm(staging, { recursive: true, force: true });
    await rm(directory, { recursive: true, force: true });
    throw invalid();
  }
}
