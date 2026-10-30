import type { Account, IdentityStore, LoginSession } from '../../core/identity/identity-store.js';

export class MemoryIdentityStore implements IdentityStore {
  private accounts = new Map<string, Account>();
  private sessions = new Map<string, LoginSession>();
  private key(tenantId: string, userId: string) {
    return JSON.stringify([tenantId, userId]);
  }
  async account(tenantId: string, userId: string) {
    return structuredClone(this.accounts.get(this.key(tenantId, userId)));
  }
  async members(tenantId: string, after: string | undefined, limit: number) {
    return structuredClone(
      [...this.accounts.values()]
        .filter((a) => a.tenantId === tenantId && (!after || a.userId > after))
        .sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
        .slice(0, limit),
    );
  }
  async create(account: Account) {
    const key = this.key(account.tenantId, account.userId);
    if (this.accounts.has(key)) return false;
    this.accounts.set(key, structuredClone(account));
    return true;
  }
  async update(
    tenantId: string,
    userId: string,
    version: number,
    patch: Partial<Pick<Account, 'role' | 'active' | 'passwordHash'>>,
  ) {
    const account = this.accounts.get(this.key(tenantId, userId));
    if (!account || account.version !== version) return false;
    Object.assign(account, patch, { version: version + 1 });
    return true;
  }
  async session(hash: string) {
    return structuredClone(this.sessions.get(hash));
  }
  async saveSession(session: LoginSession) {
    this.sessions.set(session.hash, structuredClone(session));
  }
  async deleteSession(hash: string) {
    this.sessions.delete(hash);
  }
  async deleteExpiredSessions(now: string) {
    for (const [hash, session] of this.sessions)
      if (session.expiresAt <= now) this.sessions.delete(hash);
  }
}
