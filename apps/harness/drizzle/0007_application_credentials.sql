CREATE TABLE "application_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"hash" text NOT NULL,
	"label" text NOT NULL,
	"hint" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"allow_chat" boolean NOT NULL,
	"manage_knowledge" boolean NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"tenant_id" text NOT NULL,
	"application_id" text NOT NULL,
	"knowledge_space_id" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "applications_tenant_id_application_id_pk" PRIMARY KEY("tenant_id","application_id")
);
--> statement-breakpoint
ALTER TABLE "application_keys" ADD CONSTRAINT "application_keys_tenant_id_application_id_applications_tenant_id_application_id_fk" FOREIGN KEY ("tenant_id","application_id") REFERENCES "public"."applications"("tenant_id","application_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_keys_hash_idx" ON "application_keys" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "application_keys_scope_idx" ON "application_keys" USING btree ("tenant_id","application_id","id");