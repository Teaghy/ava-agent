import OpenAI from 'openai';
import { z } from 'zod';
import type { ModelRequest } from '../../core/model/model.types.js';
import type { ModelService } from '../../core/model/model.service.js';
import type { TelemetryService } from '../../core/observability/telemetry.service.js';
import { AppError } from '../../core/errors.js';
export class OpenAICompatibleModelService implements ModelService {
  private client: OpenAI;
  constructor(
    private config: { baseURL: string; apiKey: string; model: string },
    private telemetry?: TelemetryService,
  ) {
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      timeout: 30000,
      maxRetries: 1,
    });
  }
  private recordUsage(
    r: ModelRequest,
    usage?: { prompt_tokens: number; completion_tokens: number },
  ): void {
    if (usage)
      this.telemetry?.log(
        {
          run_id: r.runId,
          conversation_id: r.conversationId,
          model: this.config.model,
          input_tokens: usage.prompt_tokens,
          output_tokens: usage.completion_tokens,
        },
        'model token usage',
      );
  }
  async chat(r: ModelRequest) {
    const response = await this.client.chat.completions.create(
      { model: this.config.model, messages: r.messages, max_tokens: r.maxTokens ?? 2048 },
      { signal: r.signal },
    );
    this.recordUsage(r, response.usage);
    return {
      text: response.choices[0]?.message.content ?? '',
      usage: {
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }
  async *stream(r: ModelRequest) {
    const stream = await this.client.chat.completions.create(
      {
        model: this.config.model,
        messages: r.messages,
        max_tokens: r.maxTokens ?? 2048,
        stream: true,
      },
      { signal: r.signal },
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta.content;
      if (text) yield { text };
    }
  }
  async structuredOutput<T>(schema: z.ZodType<T>, r: ModelRequest): Promise<T> {
    const response = await this.client.chat.completions.create(
      {
        model: this.config.model,
        messages: [
          ...r.messages,
          {
            role: 'system',
            content: `Return only one JSON object matching this JSON Schema: ${JSON.stringify(z.toJSONSchema(schema))}. Never emit reasoning or chain of thought.`,
          },
        ],
        response_format: { type: 'json_object' },
        max_tokens: r.maxTokens ?? 2048,
      },
      { signal: r.signal },
    );
    this.recordUsage(r, response.usage);
    try {
      return schema.parse(JSON.parse(response.choices[0]?.message.content ?? ''));
    } catch {
      throw new AppError('INVALID_MODEL_OUTPUT', '模型返回了无效的结构化决策。', 502);
    }
  }
}
