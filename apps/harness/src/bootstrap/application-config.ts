import { stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { HarnessOptions, HarnessPlugin } from './extensions.js';
import { AppError } from '../core/errors.js';

interface ApplicationConfigOptions {
  root?: string;
  source?: boolean;
  configPath?: string;
}
const plugin = z.custom<HarnessPlugin>(
  (value) =>
    typeof value === 'function' ||
    (typeof value === 'object' &&
      value !== null &&
      'apply' in value &&
      typeof value.apply === 'function'),
);
const optionsSchema = z
  .object({
    quiet: z.boolean().optional(),
    providers: z.record(z.string(), z.unknown()).optional(),
    plugins: z.array(plugin).optional(),
    systemPrompt: z.string().optional(),
    demoTools: z.boolean().optional(),
    startupTimeoutMs: z.number().int().positive().max(2147483647).optional(),
    pluginManagement: z
      .union([
        z.literal(false),
        z
          .object({
            statePath: z.string().min(1),
            safeMode: z.boolean().optional(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** Read the application's explicit plugin composition once per process startup. */
export async function loadApplicationConfig(
  options: ApplicationConfigOptions = {},
): Promise<HarnessOptions> {
  const root = options.root ?? fileURLToPath(new URL('../../../../', import.meta.url));
  const source = options.source ?? import.meta.url.endsWith('.ts');
  let path: string | undefined;
  if (options.configPath) {
    path = resolve(root, options.configPath);
    if (!(await isFile(path)))
      throw new AppError('APP_CONFIG_NOT_FOUND', `插件配置文件不存在：${path}`);
  } else {
    const candidates = source
      ? ['ava.config.ts', 'ava.config.mjs', 'ava.config.js']
      : ['.ava/ava.config.js', 'ava.config.mjs', 'ava.config.js'];
    for (const candidate of candidates) {
      const file = join(root, candidate);
      if (await isFile(file)) {
        path = file;
        break;
      }
    }
    if (!path && !source && (await isFile(join(root, 'ava.config.ts'))))
      throw new AppError(
        'APP_CONFIG_NOT_BUILT',
        '应用插件配置尚未构建，请先运行 pnpm build 或 pnpm build:plugins。',
      );
  }
  if (!path) return {};
  if (!source && ['.ts', '.mts', '.cts'].includes(extname(path)))
    throw new AppError('APP_CONFIG_NOT_BUILT', '生产启动请指定已构建的 JavaScript 插件配置。');

  let value: unknown;
  try {
    const module = await import(pathToFileURL(path).href);
    value = module.default;
  } catch (cause) {
    const error = new AppError(
      'APP_CONFIG_LOAD_FAILED',
      `加载插件配置失败：${path}。请检查插件路径和依赖。`,
    );
    error.cause = cause;
    throw error;
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new AppError('INVALID_APP_CONFIG', `插件配置必须默认导出配置对象：${path}`);
  const result = optionsSchema.safeParse(value);
  if (!result.success)
    throw new AppError('INVALID_APP_CONFIG', `插件配置无效：${path}；${result.error.message}`);
  // Provider declarations and publication are validated by createHarness, using
  // the actual application mode before opening any infrastructure connections.
  return result.data as HarnessOptions;
}
