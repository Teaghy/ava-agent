import { chatRequestSchema, type ChatRequest, type ChatEvent } from '@ava/protocol';
import type { Request } from './client.js';
import { parseSse } from './stream.js';

export async function* streamChat(
  request: Request,
  input: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const response = await request('/api/v1/chat', {
    method: 'POST',
    body: JSON.stringify(chatRequestSchema.parse(input)),
    signal,
  });
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new Error('服务没有返回对话流。');
  let completed = false;
  for await (const event of parseSse(response.body)) {
    signal?.throwIfAborted();
    if (event.type === 'error') throw new Error(event.data.message);
    yield event;
    if (event.type === 'answer.completed') completed = true;
  }
  if (!completed) throw new Error('连接已中断，未收到完整回答，请重新发送。');
}
