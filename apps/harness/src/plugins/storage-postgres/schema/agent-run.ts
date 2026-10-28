import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import type { AgentState } from '../../../core/agent/agent.types.js';

import { conversations } from './conversation.js';
const time = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
export const runs = pgTable('agent_runs', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id),
  tenantId: text('tenant_id').notNull(),
  state: jsonb('state').$type<AgentState>().notNull(),
  createdAt: time(),
});
