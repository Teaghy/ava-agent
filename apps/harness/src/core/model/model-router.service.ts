import type { ModelService } from './model.service.js';

export type ModelRole = 'decision' | 'answer' | 'summary';

/** Resolve a model at call time; an unconfigured role uses the current default model. */
export interface ModelRouterService {
  get(role: ModelRole): ModelService;
}
