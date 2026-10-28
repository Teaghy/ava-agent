import type { ToolContext } from './tool-context.js';
import type { ToolDescriptor, ToolPermission } from './tool.types.js';
import type { z } from 'zod';
export interface AgentTool<TInput, TOutput> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  permission: ToolPermission;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
}

export interface ToolService {
  register<I, O>(tool: AgentTool<I, O>): () => void;
  get(name: string): ToolDescriptor | undefined;
  list(): ToolDescriptor[];
  execute(name: string, input: unknown, context: ToolContext): Promise<unknown>;
}
