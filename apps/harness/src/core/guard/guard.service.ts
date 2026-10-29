import type { AgentState } from '../agent/agent.types.js';
import type { Citation } from '@ava/protocol';
export interface GuardService {
  register(policy: AnswerPolicy): () => void;
  validate(
    answer: string,
    citations: Citation[],
    state: AgentState,
    signal?: AbortSignal,
    responseType?: 'final_answer' | 'ask_user',
  ): Promise<void>;
}

/** Response strategy or additive industry validation; inputs are independent snapshots. */
export interface AnswerPolicy {
  name: string;
  validate(
    answer: string,
    citations: Citation[],
    state: AgentState,
    signal?: AbortSignal,
    responseType?: 'final_answer' | 'ask_user',
  ): void | Promise<void>;
}
