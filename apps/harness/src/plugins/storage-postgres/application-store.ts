import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq, gt, asc, isNull, or, sql } from 'drizzle-orm';
import type { Application } from '@ava/protocol';
import type {
  ApplicationCredential,
  ApplicationStore,
} from '../../core/applications/application-store.js';
import * as s from './schema/index.js';

export class PostgresApplicationStore implements ApplicationStore {
  constructor(private db: NodePgDatabase<typeof s>) {}
  async application(tenantId: string, applicationId: string) {
    return (
      await this.db
        .select()
        .from(s.applications)
        .where(
          and(
            eq(s.applications.tenantId, tenantId),
            eq(s.applications.applicationId, applicationId),
          ),
        )
    )[0];
  }
  async list(tenantId: string, after: string | undefined, limit: number) {
    return this.db
      .select()
      .from(s.applications)
      .where(
        and(
          eq(s.applications.tenantId, tenantId),
          after ? gt(s.applications.applicationId, after) : undefined,
        ),
      )
      .orderBy(asc(s.applications.applicationId))
      .limit(limit);
  }
  async create(application: Application) {
    return (
      (
        await this.db
          .insert(s.applications)
          .values(application)
          .onConflictDoNothing()
          .returning({ id: s.applications.applicationId })
      ).length > 0
    );
  }
  async update(tenantId: string, applicationId: string, version: number, active: boolean) {
    return (
      (
        await this.db
          .update(s.applications)
          .set({ active, version: version + 1 })
          .where(
            and(
              eq(s.applications.tenantId, tenantId),
              eq(s.applications.applicationId, applicationId),
              eq(s.applications.version, version),
            ),
          )
          .returning({ id: s.applications.applicationId })
      ).length > 0
    );
  }
  async credential(hash: string) {
    return (
      await this.db.select().from(s.applicationKeys).where(eq(s.applicationKeys.hash, hash))
    )[0];
  }
  async keys(tenantId: string, applicationId: string, after: string | undefined, limit: number) {
    return this.db
      .select()
      .from(s.applicationKeys)
      .where(
        and(
          eq(s.applicationKeys.tenantId, tenantId),
          eq(s.applicationKeys.applicationId, applicationId),
          after ? gt(s.applicationKeys.id, after) : undefined,
        ),
      )
      .orderBy(asc(s.applicationKeys.id))
      .limit(limit);
  }
  async saveKey(key: ApplicationCredential) {
    return (
      (
        await this.db
          .insert(s.applicationKeys)
          .values(key)
          .onConflictDoNothing()
          .returning({ id: s.applicationKeys.id })
      ).length > 0
    );
  }
  async revokeKey(tenantId: string, applicationId: string, keyId: string, now: string) {
    return (
      (
        await this.db
          .update(s.applicationKeys)
          .set({ revokedAt: sql`coalesce(${s.applicationKeys.revokedAt}, ${now}::timestamptz)` })
          .where(
            and(
              eq(s.applicationKeys.tenantId, tenantId),
              eq(s.applicationKeys.applicationId, applicationId),
              eq(s.applicationKeys.id, keyId),
            ),
          )
          .returning({ id: s.applicationKeys.id })
      ).length > 0
    );
  }
  async hasActiveKey(now: string) {
    return (
      (
        await this.db
          .select({ id: s.applicationKeys.id })
          .from(s.applicationKeys)
          .innerJoin(
            s.applications,
            and(
              eq(s.applications.tenantId, s.applicationKeys.tenantId),
              eq(s.applications.applicationId, s.applicationKeys.applicationId),
            ),
          )
          .where(
            and(
              eq(s.applications.active, true),
              isNull(s.applicationKeys.revokedAt),
              or(isNull(s.applicationKeys.expiresAt), gt(s.applicationKeys.expiresAt, now)),
            ),
          )
          .limit(1)
      ).length > 0
    );
  }
}
