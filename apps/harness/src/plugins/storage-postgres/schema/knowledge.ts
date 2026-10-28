import { pgTable, text, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

import type { RetrievedDocument } from '../../../core/rag/retrieval.types.js';

export const documents = pgTable(
  'knowledge_documents',
  {
    key: text('key').primaryKey(),
    id: text('id').notNull(),
    tenantId: text('tenant_id').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    source: text('source'),
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull(),
  },
  (t) => [uniqueIndex('documents_tenant_id_idx').on(t.tenantId, t.id)],
);

export const chunks = pgTable(
  'knowledge_chunks',
  {
    id: text('id').primaryKey(),
    documentKey: text('document_key')
      .notNull()
      .references(() => documents.key),
    tenantId: text('tenant_id').notNull(),
    content: text('content').notNull(),
    metadata: jsonb('metadata').$type<Record<string, string>>().notNull(),
    data: jsonb('data').$type<RetrievedDocument>().notNull(),
  },
  (t) => [index('chunks_tenant_idx').on(t.tenantId)],
);
