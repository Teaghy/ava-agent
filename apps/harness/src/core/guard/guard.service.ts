import type { AgentState } from '../agent/agent.types.js';
import type { Citation } from '@ava/protocol';
export interface GuardService {
  /** Check whether retrieved candidates cover the original question before another model decision. */
  validateQuestion?(state: AgentState, signal?: AbortSignal): Promise<void>;
  /** Evidence-only preflight before buffered generation; wording policies run on the final answer. */
  validateEvidence?(citations: Citation[], state: AgentState, signal?: AbortSignal): Promise<void>;
  canStream?(): boolean;
  register(policy: AnswerPolicy): () => void;
  validate(
    answer: string,
    citations: Citation[],
    state: AgentState,
    signal?: AbortSignal,
    responseType?: 'final_answer' | 'ask_user' | 'scope_reply',
  ): Promise<void>;
}

/** Response strategy or additive industry validation; inputs are independent snapshots. */
export interface AnswerPolicy {
  name: string;
  /** Only evidence checks independent of the final wording may opt in. */
  allowStreaming?: boolean;
  validate(
    answer: string,
    citations: Citation[],
    state: AgentState,
    signal?: AbortSignal,
    responseType?: 'final_answer' | 'ask_user' | 'scope_reply',
  ): void | Promise<void>;
}
