import type { Application, ApplicationKeyView } from '@ava/protocol';

export interface ApplicationCredential extends ApplicationKeyView {
  tenantId: string;
  hash: string;
}
export interface ApplicationStore {
  application(tenantId: string, applicationId: string): Promise<Application | undefined>;
  list(tenantId: string, after: string | undefined, limit: number): Promise<Application[]>;
  create(application: Application): Promise<boolean>;
  update(
    tenantId: string,
    applicationId: string,
    version: number,
    active: boolean,
  ): Promise<boolean>;
  credential(hash: string): Promise<ApplicationCredential | undefined>;
  keys(
    tenantId: string,
    applicationId: string,
    after: string | undefined,
    limit: number,
  ): Promise<ApplicationCredential[]>;
  saveKey(key: ApplicationCredential): Promise<boolean>;
  revokeKey(tenantId: string, applicationId: string, keyId: string, now: string): Promise<boolean>;
  hasActiveKey(now: string): Promise<boolean>;
}
