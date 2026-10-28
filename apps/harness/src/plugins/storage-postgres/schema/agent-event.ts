import { pgTable, text, timestamp, jsonb, bigserial, index } from 'drizzle-orm/pg-core';

import { runs } from './agent-run.js';
const time = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
export const events = pgTable(
  'agent_events',
  {
    sequence: bigserial('sequence', { mode: 'number' }).primaryKey(),
    id: text('id').notNull().unique(),
    runId: text('run_id')
      .notNull()
      .references(() => runs.id),
    conversationId: text('conversation_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    createdAt: time(),
  },
  (t) => [index('events_run_idx').on(t.tenantId, t.runId, t.sequence)],
);
