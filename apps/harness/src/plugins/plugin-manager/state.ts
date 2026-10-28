import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { pluginInstallSchema, type PluginInstallRequest } from '@ava/protocol';
import { AppError } from '../../core/errors.js';

export type PluginRecord = Omit<PluginInstallRequest, 'enabled'> & { id: string; enabled: boolean };
export async function readPluginState(path: string): Promise<PluginRecord[]> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new AppError('PLUGIN_STATE_INVALID', '无法读取插件配置文件。');
  }
  try {
    const envelope = z
      .object({ version: z.literal(1), plugins: z.array(z.unknown()) })
      .strict()
      .parse(JSON.parse(content));
    const records = envelope.plugins.map((value) => {
      const { id, ...input } = z.record(z.string(), z.unknown()).parse(value);
      return { id: z.string().uuid().parse(id), ...pluginInstallSchema.parse(input) };
    });
    if (new Set(records.map((record) => record.id)).size !== records.length)
      throw new Error('Duplicate id');
    const slots = records
      .filter((record) => record.enabled && record.kind === 'provider')
      .map((record) => record.slot);
    if (new Set(slots).size !== slots.length) throw new Error('Duplicate enabled provider');
    return records;
  } catch {
    throw new AppError('PLUGIN_STATE_INVALID', '插件配置文件格式无效；请修复文件后重启。');
  }
}

export async function writePluginState(path: string, plugins: PluginRecord[]): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, JSON.stringify({ version: 1, plugins }, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch (cause) {
    const error = new AppError(
      'PLUGIN_STATE_WRITE_FAILED',
      '插件配置保存失败；已回退运行状态。',
      400,
    );
    error.cause = cause;
    throw error;
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
