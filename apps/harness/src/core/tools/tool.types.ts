export type ToolPermission = 'READ' | 'WRITE' | 'CRITICAL';

export interface ToolDescriptor {
  name: string;
  description: string;
  permission: ToolPermission;
  parameters: unknown;
  kind?: 'retrieval';
}

export interface AuditLog {
  id: string;
  runId: string;
  tenantId: string;
  userId: string;
  tool: string;
  permission: ToolPermission;
  status: 'completed' | 'failed' | 'denied';
  createdAt: string;
}
