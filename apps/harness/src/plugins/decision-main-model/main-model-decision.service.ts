import { z } from 'zod';
import { ContextBuilder } from '../../core/agent/context-builder.js';
import { decisionSchema } from '../../core/decision/decision.schema.js';
import type { DecisionService } from '../../core/decision/decision.service.js';
import type { DecisionInput, DecisionContext } from '../../core/decision/decision.types.js';
import type { ModelService } from '../../core/model/model.service.js';
import type { TelemetryService } from '../../core/observability/telemetry.service.js';
import { AppError, checkAbort } from '../../core/errors.js';

// The model selects evidence IDs; display metadata belongs to the retrieved document.
const modelDecisionSchema = z.discriminatedUnion('type', [
  decisionSchema.options[0],
  decisionSchema.options[1].extend({
    citations: z
      .array(z.object({ documentId: z.string(), chunkId: z.string() }))
      .max(10)
      .optional(),
  }),
  decisionSchema.options[2],
]);
const streamingDecisionSchema = z.discriminatedUnion('type', [
  modelDecisionSchema.options[0],
  z
    .object({
      type: z.literal('answer_ready'),
      citations: modelDecisionSchema.options[1].shape.citations,
    })
    .strict(),
  modelDecisionSchema.options[2],
]);

export interface MainModelDecisionConfig {
  systemPrompt: string;
  contextTokens: number;
  streamAnswers?: boolean;
}
export class MainModelDecisionService implements DecisionService {
  private readonly builder: ContextBuilder;
  private readonly schema: z.ZodType<
    z.infer<typeof modelDecisionSchema> | z.infer<typeof streamingDecisionSchema>
  >;
  constructor(
    private model: ModelService,
    private telemetry: TelemetryService,
    config: MainModelDecisionConfig,
  ) {
    this.schema = config.streamAnswers ? streamingDecisionSchema : modelDecisionSchema;
    const schemaOverhead = Buffer.byteLength(JSON.stringify(z.toJSONSchema(this.schema))) + 256;
    const prompt = config.streamAnswers
      ? `${config.systemPrompt}\n本轮只选择下一步。资料足够时返回 answer_ready 和引用 ID，不要在决策 JSON 中撰写答案；答案由独立生成步骤输出。需要追问或说明范围时返回 ask_user。`
      : config.systemPrompt;
    this.builder = new ContextBuilder(prompt, config.contextTokens - schemaOverhead);
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
        this.model.structuredOutput(this.schema, {
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
    if (decision.type !== 'final_answer' && decision.type !== 'answer_ready')
      return decisionSchema.parse(decision);
    return decisionSchema.parse({
      ...decision,
      citations: (decision.citations ?? []).map((citation) => {
        const document = context.retrievedDocuments.find(
          (doc) => doc.id === citation.chunkId && doc.documentId === citation.documentId,
        );
        if (!document) throw new AppError('INVALID_CITATION', '答案引用无法验证。', 422);
        return {
          documentId: document.documentId,
          chunkId: document.id,
          title: document.title,
          ...(document.source !== undefined ? { source: document.source } : {}),
        };
      }),
    });
  }
}
