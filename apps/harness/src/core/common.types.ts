import type { ToolPermission } from './tools/tool.types.js';
export type Metadata = Record<string, string>;

export interface Principal {
  tenantId: string;
  userId: string;
  permissions: ToolPermission[];
  admin?: boolean;
}
