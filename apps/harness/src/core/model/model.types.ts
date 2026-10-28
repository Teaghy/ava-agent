export interface ModelMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  messages: ModelMessage[];
  signal?: AbortSignal;
  maxTokens?: number;
  runId?: string;
  conversationId?: string;
}

export interface ModelResponse {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ModelDelta {
  text: string;
}
