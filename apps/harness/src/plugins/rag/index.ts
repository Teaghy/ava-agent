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
  apply(ctx: Context) {
    ctx.provide('rag', createRetrievalService(ctx));
  },
};
