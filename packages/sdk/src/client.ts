import { z } from 'zod';
import { ApiError } from '@ava/shared';
export { ApiError } from '@ava/shared';
import {
  configSchema,
  conversationSchema,
  messageSchema,
  historyRequestSchema,
  errorResponseSchema,
  opsAccessSchema,
} from '@ava/protocol';
import { streamChat } from './chat.js';
import { createKnowledgeClient } from './knowledge.js';
import { createPluginClient } from './plugins.js';
import { createRunClient } from './runs.js';

export type Request = (path: string, init?: RequestInit) => Promise<Response>;
export interface ClientOptions {
  baseURL?: string;
  token?: string;
}

export class AgentClient {
  readonly chat;
  readonly knowledge;
  readonly plugins;
  readonly runs;
  readonly ops;
  private readonly request: Request;
  constructor(options: ClientOptions = {}) {
    const baseURL = (options.baseURL ?? '').replace(/\/$/, '');
    this.request = async (path, init = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Content-Type', 'application/json');
      if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
      const response = await fetch(`${baseURL}${path}`, { ...init, headers });
      if (!response.ok) {
        const parsed = errorResponseSchema.safeParse(await response.json().catch(() => undefined));
        throw new ApiError(
          parsed.success
            ? parsed.data.error.message
            : `连接失败（${response.status}），请稍后重试。`,
          response.status,
        );
      }
      return response;
    };
    this.chat = {
      stream: (input: Parameters<typeof streamChat>[1], signal?: AbortSignal) =>
        streamChat(this.request, input, signal),
    };
    this.knowledge = createKnowledgeClient(this.request);
    this.plugins = createPluginClient(this.request);
    this.runs = createRunClient(this.request);
    this.ops = {
      access: async (signal?: AbortSignal) =>
        opsAccessSchema.parse(await (await this.request('/api/v1/ops/access', { signal })).json()),
    };
  }
  async config(signal?: AbortSignal) {
    return configSchema.parse(
      await (await this.request('/api/v1/client-config', { signal })).json(),
    );
  }
  async conversations(signal?: AbortSignal) {
    return z
      .object({ conversations: z.array(conversationSchema) })
      .parse(await (await this.request('/api/v1/conversations', { signal })).json()).conversations;
  }
  async history(conversationId: string, signal?: AbortSignal) {
    return z.object({ messages: z.array(messageSchema), limit: z.number() }).parse(
      await (
        await this.request('/api/v1/conversations/history', {
          method: 'POST',
          body: JSON.stringify(historyRequestSchema.parse({ conversationId })),
          signal,
        })
      ).json(),
    );
  }
}
