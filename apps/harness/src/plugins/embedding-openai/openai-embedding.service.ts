import OpenAI from 'openai';
import type { EmbeddingService } from '../../core/embedding/embedding.service.js';
export class OpenAIEmbedding implements EmbeddingService {
  private client: OpenAI;
  constructor(
    private config: { baseURL: string; apiKey: string; model: string; dimensions: number },
  ) {
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
    const response = await this.client.embeddings.create(
      { model: this.config.model, input: texts, dimensions: this.config.dimensions },
      { signal },
    );
    const vectors = response.data.sort((a, b) => a.index - b.index).map((row) => row.embedding);
    if (
      vectors.length !== texts.length ||
      vectors.some((v) => v.length !== this.config.dimensions || v.some((n) => !Number.isFinite(n)))
    )
      throw new Error('Embedding shape mismatch');
    return vectors;
  }
}
