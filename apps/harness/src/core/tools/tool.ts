import type { ToolContext } from './tool-context.js';
import type { ToolDescriptor, ToolKind, ToolPermission } from './tool.types.js';
import type { z } from 'zod';
export interface AgentTool<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  permission: ToolPermission;
  /** Retrieval counts against the RAG budget. Memory is personal and stays out of business evidence. */
  kind?: ToolKind;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

export interface ToolService {
  register<I, O>(tool: AgentTool<I, O>): () => void;
  get(name: string): ToolDescriptor | undefined;
  list(): ToolDescriptor[];
  execute(name: string, input: unknown, context: ToolContext): Promise<unknown>;
}
