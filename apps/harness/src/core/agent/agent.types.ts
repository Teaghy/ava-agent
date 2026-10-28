import type { Principal } from '../common.types.js';
import type { RetrievedDocument } from '../rag/retrieval.types.js';
export interface AgentObservation {
  tool: string;
  result: unknown;
}

export interface ToolCallRecord {
  tool: string;
  kind?: 'retrieval';
  arguments: Record<string, unknown>;
  status: 'completed' | 'failed';
}

export interface AgentState {
  runId: string;
  conversationId: string;
  userId?: string;
  goal?: string;
  intent?: string;
  entities: Record<string, unknown>;
  observations: AgentObservation[];
  toolCalls: ToolCallRecord[];
  retrievedDocuments: RetrievedDocument[];
  step: number;
  status: 'running' | 'waiting_tool' | 'completed' | 'failed';
}

export interface AgentInput {
  conversationId: string;
  message: string;
  principal: Principal;
  signal?: AbortSignal;
}
