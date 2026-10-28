import type { AgentState } from '../agent/agent.types.js';
import type { Principal } from '../common.types.js';
import type { ConversationSummary, Message } from './session.types.js';
import type { Citation } from '@ava/protocol';
export interface SessionService {
  open(id: string, principal: Principal): Promise<void>;
  recent(id: string): Promise<Message[]>;
  summary(id: string): Promise<ConversationSummary | undefined>;
  add(
    id: string,
    role: Message['role'],
    content: string,
    details?: { citations: Citation[]; runId: string },
  ): Promise<void>;
  checkpoint(state: AgentState, tenantId: string): Promise<void>;
  summarize(id: string, signal?: AbortSignal): Promise<void>;
}
