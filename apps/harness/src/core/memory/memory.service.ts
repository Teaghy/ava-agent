import type { MemoryInput, MemoryItem, RecallOptions } from './memory.types.js';
export interface MemoryService {
  remember(input: MemoryInput): Promise<MemoryItem>;
  recall(query: string, options: RecallOptions): Promise<MemoryItem[]>;
  forget(id: string, owner: RecallOptions): Promise<void>;
}
