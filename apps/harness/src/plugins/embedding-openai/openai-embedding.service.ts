import OpenAI from 'openai';
import type { EmbeddingService } from '../../core/embedding/embedding.service.js';
import { AppError } from '../../core/errors.js';
export class OpenAIEmbedding implements EmbeddingService {
  private client: OpenAI;
  constructor(
    private config: {
      baseURL: string;
      apiKey: string;
      model: string;
      dimensions: number;
      batchSize?: number;
    },
  ) {
    if (
      !Number.isInteger(config.batchSize ?? 10) ||
      (config.batchSize ?? 10) < 1 ||
      (config.batchSize ?? 10) > 2048
    )
      throw new Error('Invalid embedding batch size');
    this.client = new OpenAI({
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      timeout: 30000,
      maxRetries: 1,
    });
  }
  async embed(text: string, signal?: AbortSignal): Promise<number[]> {
    const [vector] = await this.embedMany([text], signal);
    if (!vector) throw new Error('Missing embedding');
    return vector;
  }
  async embedMany(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!texts.length) return [];
    const result: number[][] = [];
    const batchSize = this.config.batchSize ?? 10;
    for (let offset = 0; offset < texts.length; offset += batchSize) {
      const batch = texts.slice(offset, offset + batchSize);
      const response = await this.client.embeddings
        .create(
          {
            model: this.config.model,
            input: batch,
            dimensions: this.config.dimensions,
            encoding_format: 'float',
          },
          { signal },
        )
        .catch((error: unknown) => {
          if (signal?.aborted) throw error;
          if (error instanceof OpenAI.APIError && error.status === 429)
            throw new AppError(
              'EMBEDDING_RATE_LIMITED',
              '向量模型服务暂时限流或额度不足，请稍后重试或联系维护人员。',
              503,
            );
          if (error instanceof OpenAI.APIError && (error.status === 401 || error.status === 403))
            throw new AppError(
              'EMBEDDING_AUTH_FAILED',
              '向量模型服务认证失败，请联系维护人员检查配置。',
              502,
            );
          if (error instanceof OpenAI.APIConnectionTimeoutError)
            throw new AppError('EMBEDDING_TIMEOUT', '向量模型服务响应超时，请稍后重试。', 504);
          if (
            error instanceof OpenAI.APIConnectionError ||
            (error instanceof OpenAI.APIError && (error.status ?? 0) >= 500)
          )
            throw new AppError('EMBEDDING_UNAVAILABLE', '向量模型服务暂不可用，请稍后重试。', 502);
          throw error;
        });
      const rows = response.data.sort((a, b) => a.index - b.index);
      const vectors = rows.map((row) => row.embedding);
      if (
        vectors.length !== batch.length ||
        rows.some((row, index) => row.index !== index) ||
        vectors.some(
          (v) => v.length !== this.config.dimensions || v.some((n) => !Number.isFinite(n)),
        )
      )
        throw new Error('Embedding shape mismatch');
      result.push(...vectors);
    }
    return result;
  }
}
