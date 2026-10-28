import type { Context } from 'cordis';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantVector } from './qdrant-vector.service.js';
export { QdrantVector } from './qdrant-vector.service.js';
export const vectorQdrantPlugin = {
  name: 'vector-qdrant',
  provide: ['vector'],
  async apply(
    ctx: Context,
    c: { url: string; apiKey: string; collection: string; dimensions: number },
  ) {
    if (c.collection === 'memories')
      throw new Error('Knowledge and memory collections must be separate');
    const client = new QdrantClient({
      url: c.url,
      apiKey: c.apiKey || undefined,
      timeout: 10000,
      checkCompatibility: false,
    });
    if (!(await client.collectionExists(c.collection)).exists)
      await client.createCollection(c.collection, {
        vectors: { size: c.dimensions, distance: 'Cosine' },
      });
    const info = await client.getCollection(c.collection);
    const vectors = info.config.params.vectors;
    if (!vectors || !('size' in vectors) || vectors.size !== c.dimensions)
      throw new Error('Qdrant dimension mismatch');
    await client.createPayloadIndex(c.collection, {
      field_name: 'tenantId',
      field_schema: 'keyword',
      wait: true,
    });
    ctx.provide('vector', new QdrantVector(client, c.collection));
  },
};
