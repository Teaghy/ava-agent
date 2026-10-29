export type EventType =
  | 'user_message'
  | 'assistant_message'
  | 'agent_decision'
  | 'tool_call'
  | 'tool_result'
  | 'rag_search'
  | 'rag_result'
  | 'memory_read'
  | 'memory_write'
  | 'checkpoint'
  | 'execution_span'
  | 'error';

export interface AgentEvent {
  id: string;
  runId: string;
  conversationId: string;
  tenantId: string;
  type: EventType;
  payload: unknown;
  createdAt: string;
}
