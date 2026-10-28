import { z } from 'zod';
import type { Context, DecisionService } from '@ava/harness/plugin';

const Config = z
  .object({
    question: z.string().min(1).max(2000).default('请提供订单号，我来帮你继续处理。'),
  })
  .strict();

/** A normal Cordis plugin: Harness loads only its built JavaScript entry. */
export default {
  name: 'local-rule-decision',
  provide: ['decision'],
  Config,
  apply(ctx: Context, config: z.infer<typeof Config>) {
    const decision: DecisionService = {
      async decide(_input, context) {
        context.signal.throwIfAborted();
        return { type: 'ask_user', question: config.question };
      },
    };
    ctx.provide('decision', decision);
  },
};
