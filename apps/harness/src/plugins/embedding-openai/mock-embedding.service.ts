import type { EmbeddingService } from '../../core/embedding/embedding.service.js';
export class MockEmbedding implements EmbeddingService {
  async embed(text: string): Promise<number[]> {
    const vector = Array.from({ length: 64 }, () => 0);
    for (const c of text.toLowerCase()) {
      const i = c.codePointAt(0)! % 64;
      vector[i] = vector[i]! + 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((v) => v / norm);
  }
  async embedMany(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
