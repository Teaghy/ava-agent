import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  primaryKey,
  uniqueIndex,
  foreignKey,
  index,
} from 'drizzle-orm/pg-core';
import type { ApplicationKeyView } from '@ava/protocol';

export const applications = pgTable(
  'applications',
  {
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    knowledgeSpaceId: text('knowledge_space_id').notNull(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.applicationId] })],
);
export const applicationKeys = pgTable(
  'application_keys',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    applicationId: text('application_id').notNull(),
    hash: text('hash').notNull(),
    label: text('label').notNull(),
    hint: text('hint').notNull(),
    permissions: jsonb('permissions').$type<ApplicationKeyView['permissions']>().notNull(),
    allowChat: boolean('allow_chat').notNull(),
    manageKnowledge: boolean('manage_knowledge').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' })
      .notNull()
      .defaultNow(),
    source: text('source').$type<ApplicationKeyView['source']>().notNull(),
  },
  (t) => [
    uniqueIndex('application_keys_hash_idx').on(t.hash),
    index('application_keys_scope_idx').on(t.tenantId, t.applicationId, t.id),
    foreignKey({
      columns: [t.tenantId, t.applicationId],
      foreignColumns: [applications.tenantId, applications.applicationId],
    }),
  ],
);
