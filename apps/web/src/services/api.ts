import { AgentClient } from '@ava/sdk';
import type { ChatEvent } from '@ava/protocol';

export const loadClientConfig = (signal?: AbortSignal) => new AgentClient().config(signal);
export const loadConversations = (token: string, signal?: AbortSignal) =>
  new AgentClient({ token }).conversations(signal);
export const loadHistory = (conversationId: string, token: string, signal?: AbortSignal) =>
  new AgentClient({ token }).history(conversationId, signal);
export async function sendMessage(
  conversationId: string,
  message: string,
  token: string,
  signal: AbortSignal,
  receive: (event: ChatEvent) => void,
): Promise<void> {
  for await (const event of new AgentClient({ token }).chat.stream(
    { conversationId, message },
    signal,
  ))
    receive(event);
}
