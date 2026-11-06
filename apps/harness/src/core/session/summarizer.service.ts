import type { ConversationSummary, Message } from './session.types.js';

export interface SummaryInput {
  conversationId: string;
  messages: Message[];
  previous?: ConversationSummary;
  signal?: AbortSignal;
}

/** Return bounded summary text. Authoritative facts and actions are owned by sessions. */
export interface SummarizerService {
  summarize(input: SummaryInput): Promise<string>;
}
