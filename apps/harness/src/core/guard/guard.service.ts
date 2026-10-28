import type { AgentState } from '../agent/agent.types.js';
import type { Citation } from '@ava/protocol';
export interface GuardService {
  validate(answer: string, citations: Citation[], state: AgentState): void;
}
