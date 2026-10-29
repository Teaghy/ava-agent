import type { Context } from 'cordis';
import { MockModel } from './mock-model.service.js';
import type { ApplicationPreset } from '@ava/protocol';
export { MockModel } from './mock-model.service.js';
export function createMockModelPlugin(preset: ApplicationPreset) {
  return {
    name: 'model-mock',
    provide: ['model'],
    apply(ctx: Context) {
      ctx.provide('model', new MockModel(preset));
    },
  };
}
export const modelMockPlugin = createMockModelPlugin('customer-service');
