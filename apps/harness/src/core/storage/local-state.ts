import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { serialize, deserialize } from 'node:v8';
import { AppError } from '../errors.js';

/** Single-process local state. Every acknowledged mutation has reached an atomic snapshot. */
export class LocalState<T extends object> {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private path: string,
    private snapshot: () => T,
    private restore: (state: T) => void,
  ) {}
  async load() {
    try {
      const stored = deserialize(await readFile(this.path));
      if (stored?.version !== 1 || !sameShape(this.snapshot(), stored.data))
        throw new Error('Invalid snapshot');
      this.restore(stored.data);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new AppError('LOCAL_STATE_INVALID', '无法读取本地持久化数据，请检查数据文件。', 500);
    }
  }
  async save() {
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(temporary, serialize({ version: 1, data: this.snapshot() }), {
        flag: 'wx',
        mode: 0o600,
        flush: true,
      });
      await rename(temporary, this.path);
    } catch {
      throw new AppError('LOCAL_STATE_WRITE_FAILED', '本地数据保存失败，本次操作未生效。', 500);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  wrap<S extends object>(target: S, mutations: readonly (keyof S)[]): S {
    const mutating = new Set<PropertyKey>(mutations);
    return new Proxy(target, {
      get: (object, key) => {
        const value = Reflect.get(object, key);
        if (typeof value !== 'function' || key === 'snapshot' || key === 'restore') return value;
        return (...args: unknown[]) => {
          const operation = this.queue.then(async () => {
            const previous = mutating.has(key) ? this.snapshot() : undefined;
            try {
              const result = await value.apply(object, args);
              if (previous) await this.save();
              return result;
            } catch (error) {
              if (previous) this.restore(previous);
              throw error;
            }
          });
          this.queue = operation.catch(() => {});
          return operation;
        };
      },
    });
  }
  async close() {
    await this.queue;
  }
}

function sameShape(template: unknown, value: unknown): boolean {
  if (template instanceof Map) return value instanceof Map;
  if (template instanceof Set) return value instanceof Set;
  if (Array.isArray(template)) return Array.isArray(value);
  if (template && typeof template === 'object')
    return (
      !!value &&
      typeof value === 'object' &&
      Object.keys(template).length === Object.keys(value).length &&
      Object.entries(template).every(
        ([key, item]) =>
          Object.hasOwn(value, key) && sameShape(item, (value as Record<string, unknown>)[key]),
      )
    );
  return typeof template === typeof value;
}
