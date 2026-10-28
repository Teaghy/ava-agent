import { FiberState, type Fiber } from 'cordis';
import type { Context, Plugin } from './context.js';
import { AppError } from '../core/errors.js';

export const providerSlots = [
  'model',
  'decision',
  'embedding',
  'reranker',
  'memory',
  'rag',
  'storage',
  'cache',
  'vector',
] as const;
export type ProviderSlot = (typeof providerSlots)[number];
/** Bind plugin-specific configuration in a factory; Cordis owns the resulting plugin. */
export type HarnessPlugin = Plugin<void>;
export type HarnessProviders = Partial<Record<Exclude<ProviderSlot, 'model'>, HarnessPlugin>> & {
  /** Disable only when supplying a decision provider that does not need a model. */
  model?: HarnessPlugin | false;
};
export interface HarnessOptions {
  quiet?: boolean;
  providers?: HarnessProviders;
  plugins?: readonly HarnessPlugin[];
  systemPrompt?: string;
  /** Defaults to true in mock mode; forbidden in live mode. */
  demoTools?: boolean;
  /** Bounds asynchronous activation; pending dependencies fail with diagnostics. */
  startupTimeoutMs?: number;
  /** Programmatic use is disabled by default; the CLI enables persistent management. */
  pluginManagement?: import('../plugins/plugin-manager/manager.js').PluginManagementOptions | false;
}

const managed = new Set<string>([
  ...providerSlots,
  'agent',
  'tools',
  'sessions',
  'eventStore',
  'guard',
  'knowledge',
  'qdrantKnowledge',
  'http',
  'telemetry',
  'pluginManager',
]);
function provisions(plugin: HarnessPlugin): string[] {
  return typeof plugin.provide === 'string' ? [plugin.provide] : (plugin.provide ?? []);
}
export function validateExtensions(options: HarnessOptions, mock: boolean): void {
  if (!mock && options.demoTools)
    throw new AppError('DEMO_TOOLS_FORBIDDEN', 'live 模式不能启用模拟业务工具。');
  if (
    options.startupTimeoutMs !== undefined &&
    (!Number.isInteger(options.startupTimeoutMs) || options.startupTimeoutMs <= 0)
  )
    throw new AppError('INVALID_PLUGIN_OPTIONS', 'startupTimeoutMs 必须为正整数。');
  for (const [slot, plugin] of Object.entries(options.providers ?? {})) {
    if (!providerSlots.includes(slot as ProviderSlot))
      throw new AppError('INVALID_PROVIDER', `不支持的 Provider 槽位：${slot}。`);
    if (plugin === undefined) continue;
    if (slot === 'model' && plugin === false && options.providers?.decision) continue;
    if (!plugin || !provisions(plugin).includes(slot))
      throw new AppError('INVALID_PROVIDER', `Provider ${slot} 必须通过 provide 声明对应服务。`);
    if (provisions(plugin).some((name) => managed.has(name) && name !== slot))
      throw new AppError('PLUGIN_SERVICE_CONFLICT', `Provider ${slot} 不能同时覆盖其他底座服务。`);
  }
  for (const plugin of options.plugins ?? []) {
    const conflict = provisions(plugin).find((name) => managed.has(name));
    if (conflict)
      throw new AppError(
        'PLUGIN_SERVICE_CONFLICT',
        `插件 ${plugin.name ?? '(anonymous)'} 不能覆盖 ${conflict}；可替换服务请使用 providers。`,
      );
  }
}

export async function awaitPlugins(
  ctx: Context,
  fibers: PromiseLike<Fiber>[],
  timeoutMs: number,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const snapshot = () => [...ctx.registry.values()].flatMap((runtime) => [...runtime.fibers]);
  const ready = async () => {
    await Promise.all(fibers);
    // Initial activation can trigger a second transition (e.g. optional memory
    // appears). Join Cordis's transitions until the entire graph is stable.
    while (true) {
      const previous = snapshot();
      await Promise.all(previous.map((fiber) => fiber.await()));
      const current = snapshot();
      if (current.some((fiber) => fiber.inertia || !previous.includes(fiber))) continue;
      const pending = current.filter((fiber) => fiber.state !== FiberState.ACTIVE);
      if (pending.length)
        throw new AppError(
          'PLUGIN_NOT_READY',
          `插件未就绪：${pending.map((fiber) => `${fiber.name} (inject: ${Object.keys(fiber.inject).join(', ')})`).join('; ')}`,
        );
      return;
    }
  };
  try {
    await Promise.race([
      ready(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new AppError('PLUGIN_STARTUP_TIMEOUT', '插件启动超时；请检查异步初始化和依赖。'),
            ),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
