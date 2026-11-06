import type { Context } from 'cordis';
import type { Config } from '../../config/index.js';
import type { ModelRole, ModelRouterService } from '../../core/model/model-router.service.js';
import type { ModelService } from '../../core/model/model.service.js';
import { AppError } from '../../core/errors.js';
import { OpenAICompatibleModelService } from '../model-openai/index.js';

export const modelRouterPlugin = {
  name: 'model-router',
  provide: ['modelRouter'],
  // Read the fallback lazily: rule-only deployments may mount no model at all.
  inject: ['modelCompatibility', 'telemetry'],
  apply(ctx: Context, config: Config) {
    const delegates = new Map<ModelRole, ModelService>();
    const prefixes = { decision: 'DECISION', answer: 'ANSWER', summary: 'SUMMARY' } as const;
    const service: ModelRouterService = {
      get(role) {
        const prefix = prefixes[role];
        if (config.APP_MODE === 'live' && config[`${prefix}_LLM_MODEL`]) {
          let model = delegates.get(role);
          if (!model) {
            model = new OpenAICompatibleModelService(
              {
                baseURL: config[`${prefix}_LLM_BASE_URL`],
                model: config[`${prefix}_LLM_MODEL`],
                apiKey: config[`${prefix}_LLM_API_KEY`],
                compatibility: {
                  messageFormat: config[`${prefix}_LLM_MESSAGE_FORMAT`],
                  jsonOutput: config[`${prefix}_LLM_JSON_OUTPUT`],
                  streamUsage: config[`${prefix}_LLM_STREAM_USAGE`],
                },
              },
              ctx.telemetry,
              ctx.modelCompatibility,
            );
            delegates.set(role, model);
          }
          return model;
        }
        const fallback = ctx.get('model');
        if (!fallback) throw new AppError('MODEL_UNAVAILABLE', '当前角色未配置可用模型。', 503);
        return fallback;
      },
    };
    ctx.provide('modelRouter', service);
  },
};
