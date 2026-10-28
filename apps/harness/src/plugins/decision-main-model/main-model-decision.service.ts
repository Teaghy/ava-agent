import { z } from 'zod';
import { ContextBuilder } from '../../core/agent/context-builder.js';
import { decisionSchema } from '../../core/decision/decision.schema.js';
import type { DecisionService } from '../../core/decision/decision.service.js';
import type { DecisionInput, DecisionContext } from '../../core/decision/decision.types.js';
import type { ModelService } from '../../core/model/model.service.js';
import type { TelemetryService } from '../../core/observability/telemetry.service.js';
import { checkAbort } from '../../core/errors.js';

export interface MainModelDecisionConfig {
  systemPrompt: string;
  contextTokens: number;
}
export class MainModelDecisionService implements DecisionService {
  private readonly builder: ContextBuilder;
  constructor(
    private model: ModelService,
    private telemetry: TelemetryService,
    config: MainModelDecisionConfig,
  ) {
    const schemaOverhead = Buffer.byteLength(JSON.stringify(z.toJSONSchema(decisionSchema))) + 256;
    this.builder = new ContextBuilder(config.systemPrompt, config.contextTokens - schemaOverhead);
  }
  async decide(input: DecisionInput, context: DecisionContext) {
    checkAbort(context.signal);
    const messages = this.builder.build({
      message: input.message,
      tools: input.availableTools,
      knowledgeSources: input.availableKnowledgeSources,
      task: {
        goal: input.goal === input.message ? undefined : input.goal,
        intent: input.intent,
        entities: input.entities,
      },
      state: { observations: context.observations, retrievedDocuments: context.retrievedDocuments },
      recent: context.recentMessages,
      summary: context.summary,
      memories: context.memory,
    });
    const start = performance.now();
    const decision = await this.telemetry.span(
      'model.decision',
      { run_id: context.runId, step: context.step },
      () =>
        this.model.structuredOutput(decisionSchema, {
          messages,
          signal: context.signal,
          runId: context.runId,
          conversationId: context.conversationId,
        }),
    );
    checkAbort(context.signal);
    this.telemetry.log(
      {
        run_id: context.runId,
        conversation_id: context.conversationId,
        step: context.step,
        model_latency_ms: performance.now() - start,
      },
      'main model decision',
    );
    return decisionSchema.parse(decision);
  }
}
