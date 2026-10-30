DROP INDEX "documents_tenant_id_idx";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "application_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "knowledge_space_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_documents" ADD COLUMN "knowledge_space_id" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_space_id_idx" ON "knowledge_documents" USING btree ("tenant_id","knowledge_space_id","id");