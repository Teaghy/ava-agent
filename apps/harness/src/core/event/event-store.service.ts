import type { AgentState } from '../agent/agent.types.js';
import type { AgentEvent, EventType } from './agent-event.js';
export interface EventStoreService {
  append(
    state: AgentState,
    tenantId: string,
    type: EventType,
    payload: unknown,
  ): Promise<AgentEvent>;
  replay(runId: string, tenantId: string): Promise<AgentEvent[]>;
  recover(runId: string, tenantId: string): Promise<AgentState | undefined>;
}
