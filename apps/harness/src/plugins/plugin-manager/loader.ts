import type { PluginInstallRequest } from '@ava/protocol';
import { stat } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin } from 'cordis';
import { validateExtensions, type HarnessPlugin } from '../../bootstrap/extensions.js';
import { AppError } from '../../core/errors.js';

export async function validateEntry(entry: string): Promise<void> {
  if (!isAbsolute(entry) || !['.js', '.mjs', '.cjs'].includes(extname(entry).toLowerCase()))
    throw new AppError(
      'INVALID_PLUGIN_ENTRY',
      '插件入口必须为绝对路径的已构建 .js/.mjs/.cjs 文件。',
      400,
    );
  try {
    if (!(await stat(entry)).isFile()) throw new Error('Not a file');
  } catch {
    throw new AppError('INVALID_PLUGIN_ENTRY', '插件入口文件不存在或无法读取。', 400);
  }
}

/** Import once using Node's normal module cache; Cordis retains native Config validation. */
export async function loadLocalPlugin(
  record: PluginInstallRequest,
  timeoutMs = 30000,
): Promise<Plugin> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await validateEntry(record.entry);
    const namespace = await Promise.race([
      import(pathToFileURL(record.entry).href),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new AppError('PLUGIN_LOAD_TIMEOUT', '插件模块加载超时。', 400)),
          timeoutMs,
        );
      }),
    ]);
    const plugin: unknown = namespace.default ?? namespace;
    if (
      typeof plugin !== 'function' &&
      !(
        typeof plugin === 'object' &&
        plugin !== null &&
        'apply' in plugin &&
        typeof plugin.apply === 'function'
      )
    )
      throw new Error('Expected a native Cordis plugin');
    const value = plugin as HarnessPlugin;
    if (record.kind === 'provider') {
      validateExtensions({ providers: { [record.slot!]: value } }, true);
    } else {
      validateExtensions({ plugins: [value] }, true);
    }
    return value;
  } catch (cause) {
    if (cause instanceof AppError && cause.code === 'PLUGIN_LOAD_TIMEOUT') throw cause;
    const error = new AppError(
      'PLUGIN_LOAD_FAILED',
      `无法加载插件 ${record.name}；请检查入口、插件声明和依赖。`,
      400,
    );
    error.cause = cause;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
