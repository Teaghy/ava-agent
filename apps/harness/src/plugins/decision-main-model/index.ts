import type { Context } from 'cordis';
import {
  MainModelDecisionService,
  type MainModelDecisionConfig,
} from './main-model-decision.service.js';

export const mainModelDecisionPlugin = {
  name: 'decision-main-model',
  provide: ['decision'],
  inject: ['model', 'telemetry'],
  apply(ctx: Context, config: MainModelDecisionConfig) {
    ctx.provide('decision', new MainModelDecisionService(ctx.model, ctx.telemetry, config));
  },
};
