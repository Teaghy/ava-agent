import type { Context } from 'cordis';
import { LocalState } from '../../core/storage/local-state.js';
import { InMemoryVector } from '../vector-memory/index.js';
import { AppError } from '../../core/errors.js';
import type { VectorStoreFactory } from '../../core/vector/vector.service.js';

export async function createFileVector(path: string, dimensions?: number) {
  const vector = new InMemoryVector();
  const state = new LocalState(
    path,
    () => ({ points: structuredClone(vector.points) }),
    (snapshot) => {
      vector.points.clear();
      for (const [id, point] of snapshot.points) vector.points.set(id, point);
    },
  );
  await state.load();
  if (dimensions !== undefined) {
    const validate = (values: number[]) => {
      if (values.length !== dimensions || values.some((value) => !Number.isFinite(value)))
        throw new AppError(
          'VECTOR_DIMENSION_MISMATCH',
          '向量维度与当前索引不匹配，请检查向量模型配置。',
          409,
        );
    };
    for (const point of vector.points.values()) validate(point.vector);
    const search = vector.search.bind(vector),
      upsert = vector.upsert.bind(vector);
    vector.search = async (values, ...args) => {
      validate(values);
      return search(values, ...args);
    };
    vector.upsert = async (points) => {
      points.forEach((point) => validate(point.vector));
      await upsert(points);
    };
  }
  return { vector: state.wrap(vector, ['upsert', 'delete']), close: () => state.close() };
}

/** Retains the legacy index and stores every rebuilt collection in its own durable file. */
export function createFileVectorStore(
  path: string,
  initialCollection = 'knowledge',
): VectorStoreFactory {
  const indexes = new Map<string, Promise<Awaited<ReturnType<typeof createFileVector>>>>();
  return {
    name: 'vector-file',
    async create(collection, dimensions) {
      const key = JSON.stringify([collection, dimensions]);
      let pending = indexes.get(key);
      if (!pending) {
        const indexPath =
          collection === initialCollection
            ? path
            : `${path}.${encodeURIComponent(collection)}.${dimensions}.bin`;
        pending = createFileVector(indexPath, dimensions);
        indexes.set(key, pending);
        void pending.catch(() => {
          if (indexes.get(key) === pending) indexes.delete(key);
        });
      }
      return (await pending).vector;
    },
    async close() {
      await Promise.allSettled(
        [...indexes.values()].map(async (pending) => (await pending).close()),
      );
      indexes.clear();
    },
  };
}
export const vectorFilePlugin = {
  name: 'vector-file',
  provide: ['vector'],
  async apply(ctx: Context, config: { path: string }) {
    const file = await createFileVector(config.path);
    ctx.effect(() => () => file.close());
    ctx.provide('vector', file.vector);
  },
};
