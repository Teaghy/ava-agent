import type { Context } from 'cordis';
import { createRetrievalService } from './retrieval.service.js';
export const ragPlugin = {
  name: 'rag',
  provide: ['rag'],
  inject: {
    knowledge: { required: true },
    telemetry: { required: true },
    reranker: { required: false },
  },
  apply(ctx: Context, config: { runWrite?: <T>(operation: () => Promise<T>) => Promise<T> } = {}) {
    const service = createRetrievalService(ctx);
    const ingest = service.ingest;
    if (config.runWrite)
      service.ingest = (document, tenantId) => config.runWrite!(() => ingest(document, tenantId));
    ctx.provide('rag', service);
  },
};
