import { pgTable, text, timestamp, jsonb, bigserial, index } from 'drizzle-orm/pg-core';

import type { Citation } from '@ava/protocol';
import { conversations } from './conversation.js';
const time = () =>
  timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow();
export const messages = pgTable(
  'messages',
  {
    sequence: bigserial('sequence', { mode: 'number' }).primaryKey(),
    id: text('id').notNull().unique(),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
    runId: text('run_id'),
    createdAt: time(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.sequence)],
);
