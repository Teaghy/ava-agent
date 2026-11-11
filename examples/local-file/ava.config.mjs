import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { storageFilePlugin } from '../../apps/harness/dist/plugins/storage-file/index.js';
import { createFileVectorStore } from '../../apps/harness/dist/plugins/vector-file/index.js';
import { cacheMemoryPlugin } from '../../apps/harness/dist/plugins/cache-memory/index.js';

const data = fileURLToPath(new URL('../../data/local/', import.meta.url));
export default {
  vectorStore: createFileVectorStore(
    join(data, 'vectors.bin'),
    process.env.QDRANT_COLLECTION || 'knowledge',
  ),
  providers: {
    storage: {
      ...storageFilePlugin,
      apply: (ctx) => storageFilePlugin.apply(ctx, { path: join(data, 'storage.bin') }),
    },
    cache: cacheMemoryPlugin,
  },
};
