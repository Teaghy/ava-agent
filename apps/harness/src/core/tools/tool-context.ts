import type { AgentState } from '../agent/agent.types.js';
import type { Principal } from '../common.types.js';
import type { StreamEvent } from '../http/http.types.js';
export interface ToolContext {
  principal: Principal;
  readonly message?: string;
  state: AgentState;
  signal: AbortSignal;
  emit(event: StreamEvent): Promise<void>;
}
