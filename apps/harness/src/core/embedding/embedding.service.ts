export interface EmbeddingService {
  embed(text: string, signal?: AbortSignal): Promise<number[]>;
  embedMany(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
