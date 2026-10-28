import type { StreamEvent } from '../http/http.types.js';
import type { AgentInput } from './agent.types.js';
import type { AgentResult } from '@ava/protocol';
export interface AgentService {
  run(input: AgentInput, emit?: (event: StreamEvent) => Promise<void>): Promise<AgentResult>;
  /** Stop accepting runs, cancel current work and wait for its cleanup. */
  stop(): Promise<void>;
}
