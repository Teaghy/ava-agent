export type { Citation, ClientConfig, Conversation, ChatEvent } from '@ava/protocol';
import type { Message } from '@ava/protocol';
export { safeSource } from '@ava/shared';
export type ChatMessage = Message & {
  state?: 'streaming' | 'complete' | 'stopped' | 'failed';
  error?: string;
};
