export interface MemoryInput {
  tenantId: string;
  userId: string;
  content: string;
  category: 'preference' | 'fact' | 'device' | 'history';
}

export interface MemoryItem extends MemoryInput {
  id: string;
  createdAt: string;
}

export interface RecallOptions {
  tenantId: string;
  userId: string;
  limit?: number;
  signal?: AbortSignal;
}
