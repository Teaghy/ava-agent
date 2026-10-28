import { pgTable, text, jsonb, index } from 'drizzle-orm/pg-core';

import type { MemoryItem } from '../../../core/memory/memory.types.js';

export const memories = pgTable(
  'long_term_memories',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    data: jsonb('data').$type<MemoryItem>().notNull(),
  },
  (t) => [index('memories_owner_idx').on(t.tenantId, t.userId)],
);
