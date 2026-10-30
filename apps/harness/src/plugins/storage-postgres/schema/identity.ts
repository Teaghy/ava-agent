import { pgTable, text, timestamp, integer, boolean, primaryKey, index } from 'drizzle-orm/pg-core';
import type { MemberRole } from '@ava/protocol';

export const localAccounts = pgTable(
  'local_accounts',
  {
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    displayName: text('display_name').notNull(),
    role: text('role').$type<MemberRole>().notNull(),
    active: boolean('active').notNull().default(true),
    passwordHash: text('password_hash').notNull(),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.userId] })],
);

export const loginSessions = pgTable(
  'login_sessions',
  {
    hash: text('hash').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    version: integer('version').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  },
  (t) => [index('login_sessions_expires_at_idx').on(t.expiresAt)],
);
