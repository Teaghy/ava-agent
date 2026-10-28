import type { Context } from 'cordis';
import { MockModel } from './mock-model.service.js';
export { MockModel } from './mock-model.service.js';
export const modelMockPlugin = {
  name: 'model-mock',
  provide: ['model'],
  apply(ctx: Context) {
    ctx.provide('model', new MockModel());
  },
};
