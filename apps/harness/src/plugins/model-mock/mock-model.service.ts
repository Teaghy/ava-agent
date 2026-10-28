import type { z } from 'zod';
import type { ModelRequest } from '../../core/model/model.types.js';
import type { ModelService } from '../../core/model/model.service.js';
export class MockModel implements ModelService {
  async chat(_r: ModelRequest) {
    return {
      text: 'Mock model: use structured decisions.',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
  async *stream(r: ModelRequest) {
    yield { text: (await this.chat(r)).text };
  }
  async structuredOutput<T>(schema: z.ZodType<T>, r: ModelRequest): Promise<T> {
    const envelope = JSON.parse(r.messages.find((m) => m.role === 'user')?.content ?? '{}') as {
      message?: string;
      documents?: {
        id: string;
        documentId: string;
        title: string;
        source?: string;
        content: string;
      }[];
      observations?: unknown[];
    };
    const documents = envelope.documents ?? [];
    const decision = documents.length
      ? {
          type: 'final_answer',
          answer: `检索到以下排查依据：\n\n${documents.map((doc) => `《${doc.title}》\n${doc.content}`).join('\n\n')}`,
          citations: documents.map((doc) => ({
            documentId: doc.documentId,
            chunkId: doc.id,
            title: doc.title,
            ...(doc.source ? { source: doc.source } : {}),
          })),
        }
      : envelope.observations?.length
        ? {
            type: 'ask_user',
            question: '暂未找到足够的知识依据，请补充设备型号、故障码或联系人工客服。',
          }
        : {
            type: 'tool_call',
            tool: 'knowledge_search',
            arguments: { query: envelope.message ?? 'VCD-2000 E102' },
          };
    return schema.parse(decision);
  }
}
