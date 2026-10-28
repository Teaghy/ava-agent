import { z } from 'zod';
import type { MemoryItem, RecallOptions } from '../../core/memory/memory.types.js';
import type { MemoryService } from '../../core/memory/memory.service.js';
import { AppError } from '../../core/errors.js';
const resultSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      memory: z.string().optional(),
      event: z.string().optional(),
      created_at: z.string().optional(),
      metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    }),
  ),
});
/** Mem0 OSS server contract: /memories, /search; never the hosted /v1 API. */
export class Mem0Memory implements MemoryService {
  constructor(private config: { url: string; apiKey: string }) {}
  private scope(o: RecallOptions): string {
    return JSON.stringify([o.tenantId, o.userId]);
  }
  private async request(
    path: string,
    method: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const response = await fetch(`${this.config.url.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.config.apiKey ? { 'X-API-Key': this.config.apiKey } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new AppError('MEMORY_UNAVAILABLE', '长期记忆服务暂不可用。', 502);
    return response.json();
  }
  async remember(input: Parameters<MemoryService['remember']>[0]): Promise<MemoryItem> {
    const response = resultSchema.parse(
      await this.request('/memories', 'POST', {
        messages: [{ role: 'user', content: input.content }],
        user_id: this.scope(input),
        infer: false,
        metadata: { category: input.category },
      }),
    );
    const row = response.results.find((r) => r.event !== 'DELETE');
    if (!row) throw new AppError('MEMORY_NOT_CREATED', '长期记忆未创建。', 502);
    return { ...input, id: row.id, createdAt: row.created_at ?? new Date().toISOString() };
  }
  async recall(query: string, options: RecallOptions): Promise<MemoryItem[]> {
    const response = resultSchema.parse(
      await this.request(
        '/search',
        'POST',
        { query, filters: { user_id: this.scope(options) }, top_k: options.limit ?? 5 },
        options.signal,
      ),
    );
    return response.results
      .filter((r) => r.memory)
      .map((r) => ({
        id: r.id,
        content: r.memory!,
        tenantId: options.tenantId,
        userId: options.userId,
        category: z
          .enum(['preference', 'fact', 'device', 'history'])
          .catch('fact')
          .parse(r.metadata?.category),
        createdAt: r.created_at ?? new Date().toISOString(),
      }));
  }
  async forget(id: string, owner: RecallOptions): Promise<void> {
    const row = z
      .object({ user_id: z.string() })
      .parse(await this.request(`/memories/${encodeURIComponent(id)}`, 'GET'));
    if (row.user_id !== this.scope(owner)) throw new AppError('FORBIDDEN', '无权删除此记忆。', 403);
    await this.request(`/memories/${encodeURIComponent(id)}`, 'DELETE');
  }
}
