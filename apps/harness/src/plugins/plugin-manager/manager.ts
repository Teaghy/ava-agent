import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { unpackPlugin } from './package.js';
import type { Fiber, Plugin } from 'cordis';
import {
  pluginInstallSchema,
  pluginActionSchema,
  pluginConfigureSchema,
  type PluginManagerSnapshot,
  type PluginInstallRequest,
  type PluginActionRequest,
  type PluginConfigureRequest,
} from '@ava/protocol';
import type { Context } from '../../bootstrap/context.js';
import { AppError } from '../../core/errors.js';
import { loadLocalPlugin, validateEntry } from './loader.js';
import { readPluginState, writePluginState, type PluginRecord } from './state.js';
import { PluginRuntime } from './runtime.js';
import { withPluginDeadline } from './deadline.js';

export interface PluginManagementOptions {
  statePath: string;
  safeMode?: boolean;
}
export class PluginManager {
  private records: PluginRecord[] = [];
  private modules = new Map<string, Plugin>();
  private active = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private knowledgeWrites = new Set<Promise<unknown>>();
  private closed = false;
  private recoveryRequired = false;
  private runtime!: PluginRuntime;
  private ctx!: Context;
  private agent!: Fiber;
  changing = false;
  private constructor(
    readonly options: PluginManagementOptions | false,
    private timeout: number,
  ) {}

  static async prepare(
    options: PluginManagementOptions | false,
    timeout = 30000,
  ): Promise<PluginManager> {
    const manager = new PluginManager(options, timeout);
    if (!options) return manager;
    manager.records = await readPluginState(options.statePath);
    if (!options.safeMode)
      for (const record of manager.records.filter((record) => record.enabled)) {
        manager.modules.set(record.id, await loadLocalPlugin(record, timeout));
        manager.active.add(record.id);
      }
    return manager;
  }
  hasProvider(slot: string): boolean {
    return this.activeRecords().some(
      (record) => record.kind === 'provider' && record.slot === slot,
    );
  }
  private activeRecords(): PluginRecord[] {
    return this.records.filter((record) => this.active.has(record.id));
  }
  mount(ctx: Context, runtime: PluginRuntime) {
    this.ctx = ctx;
    this.runtime = runtime;
    return runtime.mount(this.activeRecords(), this.modules);
  }
  attachAgent(fiber: Fiber): void {
    this.agent = fiber;
  }
  snapshot(): PluginManagerSnapshot {
    return {
      enabled: !!this.options,
      safeMode: !!this.options && !!this.options.safeMode,
      plugins: this.records.map(({ config: _config, ...record }) => ({
        ...record,
        status: !this.active.has(record.id)
          ? 'disabled'
          : this.runtime.isActive(record.id)
            ? 'active'
            : 'failed',
        ...(this.active.has(record.id) && !this.runtime.isActive(record.id)
          ? { error: '插件当前未激活或依赖已失效，请重新启用或重启服务。' }
          : {}),
      })),
      providers: this.runtime.sources(this.records),
      runtimePlugins: this.runtime.inventory(),
    };
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    if (!this.options)
      return Promise.reject(
        new AppError('PLUGIN_MANAGEMENT_DISABLED', '此部署未启用插件管理。', 403),
      );
    return this.enqueue(operation);
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(this.closedError());
    const next = this.queue.then(() => {
      if (this.closed) throw this.closedError();
      return operation();
    });
    this.queue = next.catch(() => {});
    return next;
  }
  /** Shares the plugin queue and execution gate with model/knowledge maintenance. */
  async knowledgeWrite<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || this.changing)
      throw new AppError('MAINTENANCE_IN_PROGRESS', '模型或插件正在切换，请稍后导入知识。', 503);
    const pending = Promise.resolve().then(operation);
    this.knowledgeWrites.add(pending);
    try {
      return await pending;
    } finally {
      this.knowledgeWrites.delete(pending);
    }
  }
  maintenance<T>(operation: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      this.changing = true;
      try {
        try {
          await withPluginDeadline(
            this.ctx.agent?.stop() ?? Promise.resolve(),
            this.timeout,
            'PLUGIN_DRAIN_TIMEOUT',
            '当前运行未响应取消，请重启服务。',
          );
        } catch (cause) {
          this.closed = true;
          this.recoveryRequired = true;
          throw cause;
        }
        let result!: T;
        let failure: unknown;
        let failed = false;
        try {
          await withPluginDeadline(
            Promise.allSettled(this.knowledgeWrites),
            this.timeout,
            'KNOWLEDGE_DRAIN_TIMEOUT',
            '知识导入仍在进行，请稍后重试切换。',
          );
          result = await operation();
        } catch (cause) {
          failed = true;
          failure = cause;
        }
        try {
          await this.restartAgent();
          await this.runtime.ready();
        } catch (cause) {
          this.closed = true;
          this.recoveryRequired = true;
          throw cause;
        }
        if (failed) throw failure;
        return result;
      } finally {
        if (!this.closed) this.changing = false;
      }
    });
  }
  private closedError(): AppError {
    return this.recoveryRequired
      ? new AppError(
          'PLUGIN_RECOVERY_REQUIRED',
          '插件状态无法安全恢复，请重启服务后继续管理。',
          503,
        )
      : new AppError('PLUGIN_MANAGER_STOPPING', '服务正在关闭。', 503);
  }
  private restartAgent(): Promise<void> {
    return withPluginDeadline(
      this.agent.restart(),
      this.timeout,
      'PLUGIN_RESTART_TIMEOUT',
      'Agent 未能在期限内恢复，请重启服务。',
    );
  }
  install(input: PluginInstallRequest): Promise<PluginManagerSnapshot> {
    return this.serialize(() => this.installRecord(input));
  }
  upload(bytes: Uint8Array): Promise<PluginManagerSnapshot> {
    return this.serialize(async () => {
      if (!this.options) throw new Error('Manager disabled');
      const unpacked = await unpackPlugin(bytes, this.options.statePath);
      try {
        return await this.installRecord(unpacked.input);
      } catch (error) {
        await rm(unpacked.directory, { recursive: true, force: true });
        throw error;
      }
    });
  }
  private async installRecord(input: PluginInstallRequest): Promise<PluginManagerSnapshot> {
    const parsed = pluginInstallSchema.safeParse(input);
    if (!parsed.success) throw new AppError('INVALID_PLUGIN_REQUEST', '插件注册参数无效。', 400);
    await validateEntry(parsed.data.entry);
    const record: PluginRecord = { ...parsed.data, id: randomUUID() };
    if (record.enabled) this.modules.set(record.id, await loadLocalPlugin(record, this.timeout));
    const next = this.records.map((previous) =>
      record.enabled && record.slot && previous.slot === record.slot
        ? { ...previous, enabled: false }
        : previous,
    );
    next.push(record);
    const active = new Set(this.active);
    if (record.enabled) {
      for (const previous of next) if (!previous.enabled) active.delete(previous.id);
      active.add(record.id);
    }
    try {
      await this.commit(next, active);
    } catch (error) {
      this.modules.delete(record.id);
      throw error;
    }
    return this.snapshot();
  }
  action(input: PluginActionRequest): Promise<PluginManagerSnapshot> {
    return this.serialize(async () => {
      const parsed = pluginActionSchema.safeParse(input);
      if (!parsed.success) throw new AppError('INVALID_PLUGIN_REQUEST', '插件操作参数无效。', 400);
      const { id, action } = parsed.data;
      const record = this.records.find((record) => record.id === id);
      if (!record) throw new AppError('PLUGIN_NOT_FOUND', '插件不存在。', 404);
      if (action === 'enable' && !this.modules.has(id))
        this.modules.set(id, await loadLocalPlugin(record, this.timeout));
      const next = this.records.flatMap((previous) =>
        previous.id === id
          ? action === 'remove'
            ? []
            : [{ ...previous, enabled: action === 'enable' }]
          : action === 'enable' && record.slot && previous.slot === record.slot
            ? [{ ...previous, enabled: false }]
            : [previous],
      );
      const active = new Set(this.active);
      if (action === 'enable') {
        for (const previous of next) if (!previous.enabled) active.delete(previous.id);
        active.add(id);
      } else active.delete(id);
      await this.commit(
        next,
        active,
        action === 'enable' && !this.runtime.isActive(id) ? new Set([id]) : undefined,
      );
      if (action === 'remove') this.modules.delete(id);
      return this.snapshot();
    });
  }
  configure(input: PluginConfigureRequest): Promise<PluginManagerSnapshot> {
    return this.serialize(async () => {
      const parsed = pluginConfigureSchema.safeParse(input);
      if (!parsed.success) throw new AppError('INVALID_PLUGIN_REQUEST', '插件配置参数无效。', 400);
      const { id, config } = parsed.data;
      if (!this.records.some((record) => record.id === id))
        throw new AppError('PLUGIN_NOT_FOUND', '插件不存在。', 404);
      const next = this.records.map((record) =>
        record.id === id ? { ...record, config } : record,
      );
      await this.commit(next, new Set(this.active), new Set([id]));
      return this.snapshot();
    });
  }
  private async commit(
    next: PluginRecord[],
    active: Set<string>,
    force = new Set<string>(),
  ): Promise<void> {
    if (!this.options) throw new Error('Manager disabled');
    const changed =
      active.size !== this.active.size ||
      [...active].some((id) => !this.active.has(id) || force.has(id));
    if (!changed) {
      await writePluginState(this.options.statePath, next);
      this.records = next;
      return;
    }
    const previous = this.activeRecords();
    this.changing = true;
    try {
      try {
        await withPluginDeadline(
          this.ctx.agent?.stop() ?? Promise.resolve(),
          this.timeout,
          'PLUGIN_DRAIN_TIMEOUT',
          '当前运行未响应取消，请重启服务。',
        );
      } catch (cause) {
        this.closed = true;
        this.recoveryRequired = true;
        const error = this.closedError();
        error.cause = cause;
        throw error;
      }
      try {
        await this.runtime.reconcile(
          next.filter((record) => active.has(record.id)),
          this.modules,
          force,
        );
        // stop() is terminal for an AgentService, including when unrelated tools changed.
        await this.restartAgent();
        await this.runtime.ready();
        await writePluginState(this.options.statePath, next);
      } catch (cause) {
        if (
          cause instanceof AppError &&
          ['PLUGIN_DISPOSE_TIMEOUT', 'PLUGIN_RESTART_TIMEOUT'].includes(cause.code)
        ) {
          // A mount may already have been removed from Cordis while its cleanup
          // still runs. Reinstalling over it cannot safely restore the process.
          this.closed = true;
          this.recoveryRequired = true;
          const error = this.closedError();
          error.cause = cause;
          throw error;
        }
        try {
          await this.runtime.reconcile(previous, this.modules, force);
          await this.restartAgent();
          await this.runtime.ready();
        } catch (rollback) {
          const error = new AppError(
            'PLUGIN_ROLLBACK_FAILED',
            '插件回退失败；请停止服务并使用安全模式恢复。',
            503,
          );
          error.cause = new AggregateError([cause, rollback]);
          // Keep the execution gate closed when the old assembly cannot be recovered.
          this.closed = true;
          this.recoveryRequired = true;
          throw error;
        }
        if (cause instanceof AppError) throw cause;
        const error = new AppError(
          'PLUGIN_ACTIVATION_FAILED',
          '插件激活失败；已恢复之前的配置。',
          400,
        );
        error.cause = cause;
        throw error;
      }
      this.records = next;
      this.active = active;
    } finally {
      if (!this.closed) this.changing = false;
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
  }
}
