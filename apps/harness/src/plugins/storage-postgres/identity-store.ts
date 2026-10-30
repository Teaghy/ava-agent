import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, gt, lt, asc } from 'drizzle-orm';
import type { Account, IdentityStore, LoginSession } from '../../core/identity/identity-store.js';
import * as s from './schema/index.js';

export class PostgresIdentityStore implements IdentityStore {
  constructor(private db: NodePgDatabase<typeof s>) {}
  async account(tenantId: string, userId: string) {
    return (
      await this.db
        .select()
        .from(s.localAccounts)
        .where(and(eq(s.localAccounts.tenantId, tenantId), eq(s.localAccounts.userId, userId)))
    )[0];
  }
  async members(tenantId: string, after: string | undefined, limit: number) {
    return this.db
      .select()
      .from(s.localAccounts)
      .where(
        and(
          eq(s.localAccounts.tenantId, tenantId),
          after ? gt(s.localAccounts.userId, after) : undefined,
        ),
      )
      .orderBy(asc(s.localAccounts.userId))
      .limit(limit);
  }
  async create(account: Account) {
    return (
      (
        await this.db
          .insert(s.localAccounts)
          .values(account)
          .onConflictDoNothing()
          .returning({ userId: s.localAccounts.userId })
      ).length > 0
    );
  }
  async update(
    tenantId: string,
    userId: string,
    version: number,
    patch: Partial<Pick<Account, 'role' | 'active' | 'passwordHash'>>,
  ) {
    return (
      (
        await this.db
          .update(s.localAccounts)
          .set({ ...patch, version: version + 1 })
          .where(
            and(
              eq(s.localAccounts.tenantId, tenantId),
              eq(s.localAccounts.userId, userId),
              eq(s.localAccounts.version, version),
            ),
          )
          .returning({ userId: s.localAccounts.userId })
      ).length > 0
    );
  }
  async session(hash: string) {
    return (await this.db.select().from(s.loginSessions).where(eq(s.loginSessions.hash, hash)))[0];
  }
  async saveSession(session: LoginSession) {
    await this.db.insert(s.loginSessions).values(session);
  }
  async deleteSession(hash: string) {
    await this.db.delete(s.loginSessions).where(eq(s.loginSessions.hash, hash));
  }
  async deleteExpiredSessions(now: string) {
    await this.db.delete(s.loginSessions).where(lt(s.loginSessions.expiresAt, now));
  }
}
