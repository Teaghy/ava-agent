import { FiberState, type Fiber, type Plugin } from 'cordis';
import type { PluginSlot, ProviderView, RuntimePluginView } from '@ava/protocol';
import type { Context } from '../../bootstrap/context.js';
import { awaitPlugins } from '../../bootstrap/extensions.js';
import { AppError } from '../../core/errors.js';
import type { PluginRecord } from './state.js';
import { withPluginDeadline } from './deadline.js';
import { describeRuntimePlugin, runtimeStatus } from './inventory.js';

export type Installer = () => Fiber & PromiseLike<Fiber>;
export interface BaseProvider {
  install?: Installer;
  source: 'default' | 'application';
  name: string;
}
interface Mounted {
  key: string;
  fiber?: Fiber & PromiseLike<Fiber>;
}

/** Tracks only explicit mounts. Cordis owns their dependency graph and all effects. */
export class PluginRuntime {
  private providers = new Map<PluginSlot, Mounted>();
  private extensions = new Map<string, Fiber & PromiseLike<Fiber>>();
  private applicationRoots = new Set<Fiber>();
  constructor(
    private ctx: Context,
    private bases: Record<PluginSlot, BaseProvider>,
    private timeout: number,
  ) {}

  private dispose(fiber: Fiber): Promise<void> {
    return withPluginDeadline(
      fiber.dispose(),
      this.timeout,
      'PLUGIN_DISPOSE_TIMEOUT',
      '插件未能在期限内释放，请重启服务恢复。',
    );
  }

  isActive(id: string): boolean {
    const fiber =
      this.extensions.get(id) ??
      [...this.providers.values()].find((mounted) => mounted.key === id)?.fiber;
    return fiber?.state === FiberState.ACTIVE && fiber.uid !== null;
  }

  sources(records: PluginRecord[]): ProviderView[] {
    return Object.entries(this.bases).map(([slot, base]) => {
      const key = this.providers.get(slot as PluginSlot)?.key;
      const record = records.find((record) => record.id === key);
      const status = runtimeStatus(this.providers.get(slot as PluginSlot)?.fiber);
      return record
        ? {
            slot: slot as PluginSlot,
            source: 'plugin',
            name: record.name,
            pluginId: record.id,
            status,
          }
        : { slot: slot as PluginSlot, source: base.source, name: base.name, status };
    });
  }
  application(fiber: Fiber): void {
    this.applicationRoots.add(fiber);
  }
  inventory(): RuntimePluginView[] {
    const managed = new Set(
      [
        ...this.extensions.values(),
        ...[...this.providers.values()]
          .filter((mount) => mount.key !== 'base')
          .flatMap((mount) => (mount.fiber ? [mount.fiber] : [])),
      ]
        .map((fiber) => fiber.uid)
        .filter((uid) => uid !== null),
    );
    const applications = new Set([...this.applicationRoots].map((fiber) => fiber.uid));
    for (const [slot, mount] of this.providers)
      if (mount.key === 'base' && mount.fiber && this.bases[slot].source === 'application')
        applications.add(mount.fiber.uid);
    const all = [...this.ctx.registry.values()]
      .flatMap((runtime) => [...runtime.fibers])
      .filter((fiber) => fiber.uid !== null && fiber.state !== FiberState.DISPOSED);
    const rows: RuntimePluginView[] = [];
    for (const fiber of all) {
      let cursor = fiber;
      let source: RuntimePluginView['source'] = 'builtin';
      let external = false;
      const seen = new Set<number | null>();
      while (!seen.has(cursor.uid) && cursor.uid !== this.ctx.fiber.uid) {
        seen.add(cursor.uid);
        if (cursor.uid !== null && managed.has(cursor.uid)) {
          external = true;
          break;
        }
        if (applications.has(cursor.uid)) source = 'application';
        cursor = cursor.parent.fiber;
      }
      if (external) continue;
      const name = fiber.name;
      rows.push({
        id: `runtime-${fiber.uid}`,
        name,
        ...describeRuntimePlugin(name),
        source,
        status: runtimeStatus(fiber),
        services: [...fiber.provisions].map((service) => service.name).sort(),
        dependencies: Object.entries(fiber.inject).map(([name, spec]) => ({
          name,
          required: spec?.required !== false,
        })),
        ...(fiber.parent.fiber.uid !== this.ctx.fiber.uid && fiber.parent.fiber.uid !== null
          ? { parentId: `runtime-${fiber.parent.fiber.uid}` }
          : {}),
      });
    }
    return rows.sort(
      (a, b) =>
        a.category.localeCompare(b.category) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  }
  mount(records: PluginRecord[], modules: Map<string, Plugin>): (Fiber & PromiseLike<Fiber>)[] {
    const fibers: (Fiber & PromiseLike<Fiber>)[] = [];
    for (const [slot, base] of Object.entries(this.bases) as [PluginSlot, BaseProvider][]) {
      const record = records.find((record) => record.kind === 'provider' && record.slot === slot);
      const fiber = record
        ? this.ctx.plugin(modules.get(record.id)!, record.config ?? {})
        : base.install?.();
      this.providers.set(slot, { key: record?.id ?? 'base', fiber });
      if (fiber) fibers.push(fiber);
    }
    for (const record of records.filter((record) => record.kind === 'extension')) {
      const fiber = this.ctx.plugin(modules.get(record.id)!, record.config ?? {});
      this.extensions.set(record.id, fiber);
      fibers.push(fiber);
    }
    return fibers;
  }
  async reconcile(
    records: PluginRecord[],
    modules: Map<string, Plugin>,
    force = new Set<string>(),
  ): Promise<void> {
    const extensions = new Set(
      records.filter((record) => record.kind === 'extension').map((record) => record.id),
    );
    for (const [id, fiber] of this.extensions)
      if (!extensions.has(id) || force.has(id)) {
        await this.dispose(fiber);
        this.extensions.delete(id);
      }
    for (const [slot, base] of Object.entries(this.bases) as [PluginSlot, BaseProvider][]) {
      const record = records.find((record) => record.kind === 'provider' && record.slot === slot);
      const key = record?.id ?? 'base';
      const mounted = this.providers.get(slot);
      if (mounted?.key === key && !force.has(key)) continue;
      if (mounted?.fiber) await this.dispose(mounted.fiber);
      this.providers.delete(slot);
      const fiber = record
        ? this.ctx.plugin(modules.get(record.id)!, record.config ?? {})
        : base.install?.();
      this.providers.set(slot, { key, fiber });
    }
    for (const record of records.filter((record) => record.kind === 'extension')) {
      if (this.extensions.has(record.id)) continue;
      const fiber = this.ctx.plugin(modules.get(record.id)!, record.config ?? {});
      this.extensions.set(record.id, fiber);
    }
    await this.ready();
  }
  async ready(): Promise<void> {
    await awaitPlugins(this.ctx, [], this.timeout);
    for (const [slot, mounted] of this.providers) {
      if (mounted.fiber && this.ctx.get(slot) === undefined)
        throw new AppError('PROVIDER_NOT_READY', `Provider ${slot} 未发布服务。`, 400);
    }
  }
}
