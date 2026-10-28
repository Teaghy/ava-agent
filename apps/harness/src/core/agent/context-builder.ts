import type { AgentState } from './agent.types.js';
import type { ConversationSummary, Message } from '../session/session.types.js';
import type { MemoryItem } from '../memory/memory.types.js';
import type { ModelMessage } from '../model/model.types.js';
import type { ToolDescriptor } from '../tools/tool.types.js';
import type { DecisionInput } from '../decision/decision.types.js';
import { AppError } from '../errors.js';
export interface ContextInput {
  state: Pick<AgentState, 'observations' | 'retrievedDocuments'>;
  message: string;
  tools: ToolDescriptor[];
  recent: Message[];
  summary?: ConversationSummary;
  memories: MemoryItem[];
  task?: Pick<DecisionInput, 'goal' | 'intent' | 'entities'>;
  knowledgeSources?: DecisionInput['availableKnowledgeSources'];
}
export class ContextBuilder {
  constructor(
    private systemPrompt: string,
    private budget: number,
  ) {}
  build(input: ContextInput): ModelMessage[] {
    const system: ModelMessage = {
      role: 'system',
      content: `${this.systemPrompt}\nAvailable tools (server enforces permissions): ${JSON.stringify(input.tools)}`,
    };
    const envelope = {
      message: input.message,
      task: input.task,
      knowledgeSources: input.knowledgeSources,
      observations: [] as unknown[],
      documents: [] as unknown[],
      recent: [] as unknown[],
      summary: '',
      memories: [] as string[],
    };
    // UTF-8 byte count is a conservative token upper bound for supported BPE providers.
    const fits = () =>
      Buffer.byteLength(system.content) + Buffer.byteLength(JSON.stringify(envelope)) + 256 <=
      this.budget;
    if (!fits()) throw new AppError('CONTEXT_BUDGET', '请求或工具描述超过上下文预算。', 400);
    for (const observation of input.state.observations.toReversed()) {
      envelope.observations.unshift(observation);
      if (!fits()) {
        envelope.observations.shift();
        break;
      }
    }
    for (const doc of [...input.state.retrievedDocuments].sort((a, b) => b.score - a.score)) {
      envelope.documents.push({
        id: doc.id,
        documentId: doc.documentId,
        title: doc.title,
        content: doc.content,
        source: doc.source,
      });
      if (!fits()) envelope.documents.pop();
    }
    for (const message of input.recent.toReversed()) {
      envelope.recent.unshift({ role: message.role, content: message.content });
      if (!fits()) {
        envelope.recent.shift();
        break;
      }
    }
    envelope.summary = input.summary?.summary ?? '';
    if (!fits()) envelope.summary = '';
    for (const memory of input.memories) {
      envelope.memories.push(memory.content);
      if (!fits()) envelope.memories.pop();
    }
    return [system, { role: 'user', content: JSON.stringify(envelope) }];
  }
}
