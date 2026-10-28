import type { Message as ApiMessage } from '@ava/protocol';
export interface Message extends ApiMessage {
  conversationId: string;
}

export interface ConversationSummary {
  conversationId: string;
  problem?: string;
  confirmedFacts: string[];
  executedActions: string[];
  pendingItems: string[];
  summary: string;
  updatedAt: string;
}
