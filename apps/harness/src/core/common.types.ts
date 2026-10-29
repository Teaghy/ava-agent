import type { ToolPermission } from './tools/tool.types.js';
export type Metadata = Record<string, string>;

export interface Principal {
  tenantId: string;
  userId: string;
  permissions: ToolPermission[];
  admin?: boolean;
  /** Trusted process-level code loading, separate from tenant administration. */
  managePlugins?: boolean;
  /** Additional tenants this Ops maintainer may inspect; never granted by request input. */
  inspectTenants?: string[];
}
