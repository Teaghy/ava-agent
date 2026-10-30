import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

import type { ConversationSummary } from '../../../core/session/session.types.js';

const time = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  externalId: text('external_id').notNull(),
  createdAt: time(),
});

export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
  createdAt: time(),
});

export const summaries = pgTable('conversation_summaries', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id),
  data: jsonb('data').$type<ConversationSummary>().notNull(),
});
