import type { Context } from 'cordis';
import {
  defaultModelCompatibility,
  type ModelCompatibilityOptions,
  type ResolvedModelCompatibility,
} from '@ava/protocol';
import type {
  ModelCapabilities,
  ModelCompatibilityRule,
  ModelCompatibilityService,
  ModelConnection,
} from '../../core/model/model-compatibility.service.js';
import type { ModelMessage } from '../../core/model/model.types.js';
import { AppError } from '../../core/errors.js';

const defaults: ModelCapabilities = {
  messageFormat: 'preserve',
  jsonOutput: 'json-object',
  streamUsage: true,
};
const canonical = (url: string) => new URL(url).toString().replace(/\/+$/, '');
// Scope observed restrictions to the actual deployment, never to every Qwen deployment.
const knownRules: ModelCompatibilityRule[] = [
  {
    id: 'intern-qwen38-system-first',
    label: 'Intern Discovery · qwen3.8-27b 消息模板',
    connection: { baseURL: 'https://discovery-api.intern-ai.org.cn/v1', model: 'qwen3.8-27b' },
    capabilities: { messageFormat: 'single-system-first' },
  },
];

export class ModelCompatibilityRegistry implements ModelCompatibilityService {
  private rules = new Map<string, ModelCompatibilityRule>();
  constructor() {
    for (const rule of knownRules) this.register(rule);
  }
  register(rule: ModelCompatibilityRule): () => void {
    if (this.rules.has(rule.id))
      throw new AppError('DUPLICATE_MODEL_PROFILE', '模型兼容规则 ID 已存在。', 409);
    this.rules.set(rule.id, structuredClone(rule));
    return () => {
      this.rules.delete(rule.id);
    };
  }
  resolve(
    connection: ModelConnection,
    options: ModelCompatibilityOptions = defaultModelCompatibility,
  ): ResolvedModelCompatibility {
    const rule = [...this.rules.values()]
      .reverse()
      .find(
        (rule) =>
          canonical(rule.connection.baseURL) === canonical(connection.baseURL) &&
          rule.connection.model === connection.model,
      );
    const effective = { ...defaults, ...rule?.capabilities };
    const override = Object.values(options).some((value) => value !== 'auto');
    return {
      messageFormat:
        options.messageFormat === 'auto' ? effective.messageFormat : options.messageFormat,
      jsonOutput: options.jsonOutput === 'auto' ? effective.jsonOutput : options.jsonOutput,
      streamUsage:
        options.streamUsage === 'auto' ? effective.streamUsage : options.streamUsage === 'enabled',
      source: override ? 'override' : rule ? 'known-model' : 'default',
      ...(rule ? { rule: { id: rule.id, label: rule.label } } : {}),
    };
  }
}

/** Only original system instructions are merged; data keeps its original role and order. */
export function prepareModelMessages(
  messages: readonly ModelMessage[],
  format: ModelCapabilities['messageFormat'],
  instruction?: string,
): ModelMessage[] {
  const all: ModelMessage[] = [
    ...messages,
    ...(instruction ? [{ role: 'system' as const, content: instruction }] : []),
  ];
  if (format === 'preserve') return all.map((message) => ({ ...message }));
  const systems = all.filter((message) => message.role === 'system');
  return [
    ...(systems.length
      ? [
          {
            role: 'system' as const,
            content: systems.map((message) => message.content).join('\n\n'),
          },
        ]
      : []),
    ...all.filter((message) => message.role !== 'system').map((message) => ({ ...message })),
  ];
}
export const modelCompatibilityPlugin = {
  name: 'model-compatibility',
  provide: ['modelCompatibility'],
  apply(ctx: Context, registry: ModelCompatibilityService = new ModelCompatibilityRegistry()) {
    ctx.provide('modelCompatibility', registry);
  },
};
