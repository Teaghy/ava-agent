import { streamEventSchema, type ChatEvent } from '@ava/protocol';
/** Handles UTF-8 boundaries, multiline data, comments, LF/CRLF/CR and split delimiters. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let type = 'message';
  let lines: string[] = [];
  const dispatch = () => {
    const current = { type, data: lines.join('\n') };
    type = 'message';
    lines = [];
    if (!current.data || current.type === 'ping') return undefined;
    if (!streamEventSchema.options.some((schema) => schema.shape.type.value === current.type))
      return undefined;
    let data: unknown;
    try {
      data = JSON.parse(current.data);
    } catch {
      throw new Error('服务返回了无法解析的消息。');
    }
    const parsed = streamEventSchema.safeParse({ type: current.type, data });
    if (!parsed.success) throw new Error('服务返回的消息格式不正确。');
    return parsed.data;
  };
  try {
    let done = false;
    while (!done) {
      const chunk = await reader.read();
      done = chunk.done;
      buffer += decoder.decode(chunk.value, { stream: !done });
      if (buffer.length > 100000) throw new Error('服务消息超过大小限制。');
      for (;;) {
        const match = /\r\n|\r|\n/.exec(buffer);
        if (!match) break;
        if (!done && match[0] === '\r' && match.index === buffer.length - 1) break;
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (!line) {
          const parsed = dispatch();
          if (parsed) yield parsed;
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
          if (field === 'event') type = value;
          if (field === 'data') lines.push(value);
          if (lines.reduce((n, value) => n + value.length, 0) > 100000)
            throw new Error('服务消息超过大小限制。');
        }
      }
    }
    // Events are committed by a blank line. An incomplete last frame is ignored.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
