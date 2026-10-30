import OpenAI from 'openai';
import { z } from 'zod';
import type { ModelRequest } from '../../core/model/model.types.js';
import type { ModelService } from '../../core/model/model.service.js';
import type { TelemetryService } from '../../core/observability/telemetry.service.js';
import { AppError } from '../../core/errors.js';
import type { ModelCompatibilityOptions } from '@ava/protocol';
import type { ModelCompatibilityService } from '../../core/model/model-compatibility.service.js';
import { ModelCompatibilityRegistry, prepareModelMessages } from '../model-compatibility/index.js';
export class OpenAICompatibleModelService implements ModelService {
  private client: OpenAI;
  constructor(
    private config: {
      baseURL: string;
      apiKey: string;
      model: string;
      compatibility?: ModelCompatibilityOptions;
    },
    private telemetry?: TelemetryService,
    private compatibility: ModelCompatibilityService = new ModelCompatibilityRegistry(),
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
  private profile(r: ModelRequest) {
    const profile = this.compatibility.resolve(this.config, this.config.compatibility);
    this.telemetry?.log(
      {
        event: 'model.compatibility',
        run_id: r.runId,
        conversation_id: r.conversationId,
        model: this.config.model,
        profile_source: profile.source,
        profile_rule: profile.rule?.id,
        message_format: profile.messageFormat,
        json_output: profile.jsonOutput,
        stream_usage: profile.streamUsage,
      },
      'model compatibility',
    );
    return profile;
  }
  private fail(error: unknown, r: ModelRequest): never {
    if (r.signal?.aborted) throw error;
    if (error instanceof OpenAI.APIConnectionTimeoutError)
      throw new AppError('MODEL_TIMEOUT', '模型服务响应超时，请稍后重试。', 504);
    if (error instanceof OpenAI.APIError && error.status === 429)
      throw new AppError('MODEL_RATE_LIMITED', '模型服务暂时限流，请稍后重试。', 503);
    if (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403))
      throw new AppError('MODEL_AUTH_FAILED', '模型服务认证失败，请联系维护人员检查配置。', 502);
    if (error instanceof OpenAI.APIError && error.status === 400) {
      const detail = error.message.toLowerCase();
      if (/system.*(beginning|first|position)|only.*one.*system/.test(detail))
        throw new AppError(
          'MODEL_MESSAGE_FORMAT_UNSUPPORTED',
          '模型拒绝当前消息格式，请在 Ops 的高级兼容设置中选择单条 system 置顶并重新验证。',
          502,
        );
      if (/response_format|json_object/.test(detail))
        throw new AppError(
          'MODEL_JSON_MODE_UNSUPPORTED',
          '模型不支持当前 JSON 输出参数，请在 Ops 将 JSON 输出设为仅提示词约束并重新验证。',
          502,
        );
      if (/stream_options|include_usage/.test(detail))
        throw new AppError(
          'MODEL_STREAM_USAGE_UNSUPPORTED',
          '模型不支持流式用量参数，请在 Ops 关闭流式用量参数并重新验证。',
          502,
        );
      throw new AppError(
        'MODEL_REQUEST_REJECTED',
        '模型拒绝当前请求，请由维护人员检查模型能力和兼容设置。',
        502,
      );
    }
    if (
      error instanceof OpenAI.APIConnectionError ||
      (error instanceof OpenAI.APIError && (error.status ?? 0) >= 500)
    )
      throw new AppError('MODEL_UNAVAILABLE', '模型服务暂不可用，请稍后重试。', 502);
    throw error;
  }
  async chat(r: ModelRequest) {
    const profile = this.profile(r);
    const response = await this.client.chat.completions
      .create(
        {
          model: this.config.model,
          messages: prepareModelMessages(r.messages, profile.messageFormat),
          max_tokens: r.maxTokens ?? 2048,
        },
        { signal: r.signal },
      )
      .catch((error: unknown) => this.fail(error, r));
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
    const profile = this.profile(r);
    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.config.model,
          messages: prepareModelMessages(r.messages, profile.messageFormat),
          max_tokens: r.maxTokens ?? 2048,
          stream: true,
          ...(profile.streamUsage ? { stream_options: { include_usage: true } } : {}),
        },
        { signal: r.signal },
      );
      let finished = false;
      for await (const chunk of stream) {
        this.recordUsage(r, chunk.usage ?? undefined);
        const choice = chunk.choices[0];
        if (choice?.finish_reason === 'length')
          throw new AppError('MODEL_OUTPUT_TRUNCATED', '模型输出达到长度上限，回答未完成。', 502);
        if (choice?.finish_reason === 'content_filter')
          throw new AppError('MODEL_RESPONSE_BLOCKED', '模型服务未能完成此回答。', 502);
        if (choice?.finish_reason === 'stop') finished = true;
        // Only user-visible content is forwarded; reasoning/tool-call fields are never emitted.
        const text = choice?.delta.content;
        if (text) yield { text };
      }
      if (!finished)
        throw new AppError('MODEL_STREAM_INCOMPLETE', '模型连接中断，回答未完成，请重试。', 502);
    } catch (error) {
      this.fail(error, r);
    }
  }
  async structuredOutput<T>(schema: z.ZodType<T>, r: ModelRequest): Promise<T> {
    const profile = this.profile(r);
    const response = await this.client.chat.completions
      .create(
        {
          model: this.config.model,
          messages: prepareModelMessages(
            r.messages,
            profile.messageFormat,
            `Return only one JSON object matching this JSON Schema: ${JSON.stringify(z.toJSONSchema(schema))}. Never emit reasoning or chain of thought.`,
          ),
          ...(profile.jsonOutput === 'json-object'
            ? { response_format: { type: 'json_object' as const } }
            : {}),
          max_tokens: r.maxTokens ?? 2048,
        },
        { signal: r.signal },
      )
      .catch((error: unknown) => this.fail(error, r));
    this.recordUsage(r, response.usage);
    const choice = response.choices[0];
    const content = choice?.message.content ?? '';
    const invalid = (code: string, message: string): never => {
      this.telemetry?.log(
        {
          event: 'model.output.invalid',
          run_id: r.runId,
          conversation_id: r.conversationId,
          model: this.config.model,
          error_code: code,
          finish_reason: choice?.finish_reason,
          content_length: content.length,
        },
        'invalid structured model output',
      );
      throw new AppError(code, message, 502);
    };
    if (choice?.finish_reason === 'length')
      return invalid('MODEL_OUTPUT_TRUNCATED', '模型输出达到长度上限，未能完整生成决策。');
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return invalid('INVALID_MODEL_JSON', '模型未返回有效的 JSON 决策。');
    }
    const result = schema.safeParse(parsed);
    if (!result.success) return invalid('INVALID_MODEL_OUTPUT', '模型返回了无效的结构化决策。');
    return result.data;
  }
}
