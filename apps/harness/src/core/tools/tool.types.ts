import type { Principal } from '../common.types.js';

export type ToolPermission = 'READ' | 'WRITE' | 'CRITICAL';
export type ToolKind = 'retrieval' | 'memory';

export interface ToolDescriptor {
  name: string;
  description: string;
  permission: ToolPermission;
  parameters: unknown;
  kind?: ToolKind;
}

export function canUseTool(tool: ToolDescriptor, principal: Principal): boolean {
  return (
    principal.permissions.includes(tool.permission) &&
    (tool.kind !== 'memory' || !principal.applicationId)
  );
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
