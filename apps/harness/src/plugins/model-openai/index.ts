import type { Context } from 'cordis';
import { OpenAICompatibleModelService } from './openai-model.service.js';
export { OpenAICompatibleModelService } from './openai-model.service.js';
export const modelOpenAIPlugin = {
  name: 'model-openai',
  provide: ['model'],
  inject: ['telemetry'],
  apply(ctx: Context, config: { baseURL: string; apiKey: string; model: string }) {
    ctx.provide('model', new OpenAICompatibleModelService(config, ctx.telemetry));
  },
};
