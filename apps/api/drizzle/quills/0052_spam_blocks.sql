CREATE TABLE "quills"."spam_blocks" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"reason" text,
	"created_by_principal_id" uuid,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spam_blocks_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "spam_blocks_kind_value_check" CHECK ("quills"."spam_blocks"."kind" IN ('ip_cidr', 'email_domain', 'visitor_principal') AND char_length("quills"."spam_blocks"."value") BETWEEN 1 AND 255 AND ("quills"."spam_blocks"."reason" IS NULL OR char_length("quills"."spam_blocks"."reason") <= 500))
);
--> statement-breakpoint
ALTER TABLE "quills"."spam_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."spam_blocks" ADD CONSTRAINT "spam_blocks_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."spam_blocks" ADD CONSTRAINT "spam_blocks_created_by_fk" FOREIGN KEY ("workspace_id","created_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("created_by_principal_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE UNIQUE INDEX "spam_blocks_workspace_kind_value_uq" ON "quills"."spam_blocks" USING btree ("workspace_id","kind","value");--> statement-breakpoint
CREATE INDEX "spam_blocks_workspace_expires_idx" ON "quills"."spam_blocks" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "spam_blocks_created_by_idx" ON "quills"."spam_blocks" USING btree ("created_by_principal_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."spam_blocks" AS PERMISSIVE FOR ALL TO public USING ("quills"."spam_blocks"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."spam_blocks"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."spam_blocks" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
