import type { Context } from 'cordis';
import { OpenAICompatibleModelService } from './openai-model.service.js';
import type { ModelCompatibilityOptions } from '@ava/protocol';
export { OpenAICompatibleModelService } from './openai-model.service.js';
export const modelOpenAIPlugin = {
  name: 'model-openai',
  provide: ['model'],
  inject: { telemetry: { required: true }, modelCompatibility: { required: false } },
  apply(
    ctx: Context,
    config: {
      baseURL: string;
      apiKey: string;
      model: string;
      compatibility?: ModelCompatibilityOptions;
    },
  ) {
    ctx.provide(
      'model',
      new OpenAICompatibleModelService(config, ctx.telemetry, ctx.get('modelCompatibility')),
    );
  },
};
