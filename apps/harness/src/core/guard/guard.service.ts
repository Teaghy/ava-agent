import type { AgentState } from '../agent/agent.types.js';
import type { Citation } from '@ava/protocol';
export interface GuardService {
  register(policy: AnswerPolicy): () => void;
  validate(
    answer: string,
    citations: Citation[],
    state: AgentState,
    signal?: AbortSignal,
  ): Promise<void>;
}

/** Additional industry validation, executed after the baseline checks. */
export interface AnswerPolicy {
  name: string;
  validate(
    answer: string,
    citations: Citation[],
    state: AgentState,
    signal?: AbortSignal,
  ): void | Promise<void>;
}
