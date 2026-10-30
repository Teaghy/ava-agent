import type { Member } from '@ava/protocol';

export interface Account extends Member {
  passwordHash: string;
}
export interface LoginSession {
  hash: string;
  tenantId: string;
  userId: string;
  version: number;
  expiresAt: string;
}
export interface IdentityStore {
  account(tenantId: string, userId: string): Promise<Account | undefined>;
  members(tenantId: string, after: string | undefined, limit: number): Promise<Account[]>;
  create(account: Account): Promise<boolean>;
  update(
    tenantId: string,
    userId: string,
    version: number,
    patch: Partial<Pick<Account, 'role' | 'active' | 'passwordHash'>>,
  ): Promise<boolean>;
  session(hash: string): Promise<LoginSession | undefined>;
  saveSession(session: LoginSession): Promise<void>;
  deleteSession(hash: string): Promise<void>;
  deleteExpiredSessions(now: string): Promise<void>;
}
