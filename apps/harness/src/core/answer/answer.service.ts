import type { ContextInput } from '../agent/context-builder.js';
import type { ModelDelta } from '../model/model.types.js';

export interface AnswerRequest extends Omit<ContextInput, 'tools' | 'knowledgeSources' | 'task'> {
  runId: string;
  conversationId: string;
  signal: AbortSignal;
}
export interface AnswerService {
  stream(request: AnswerRequest): AsyncIterable<ModelDelta>;
}
