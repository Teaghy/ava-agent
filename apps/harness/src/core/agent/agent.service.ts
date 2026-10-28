import type { StreamEvent } from '../http/http.types.js';
import type { AgentInput } from './agent.types.js';
import type { AgentResult } from '@ava/protocol';
export interface AgentService {
  run(input: AgentInput, emit?: (event: StreamEvent) => Promise<void>): Promise<AgentResult>;
}
