import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

const time = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
export const audits = pgTable('tool_audit_logs', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id').notNull(),
  tool: text('tool').notNull(),
  permission: text('permission').notNull(),
  status: text('status').notNull(),
  createdAt: time(),
});
