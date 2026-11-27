CREATE TABLE "quills"."support_merge_records" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"entity_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"cross_requester" boolean DEFAULT false NOT NULL,
	"cross_company" boolean DEFAULT false NOT NULL,
	"notify_requester" boolean DEFAULT false NOT NULL,
	"merged_by_principal_id" uuid,
	"snapshot" jsonb NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_merge_records_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "support_merge_records_kind_check" CHECK ("quills"."support_merge_records"."entity_kind" IN ('conversation', 'ticket') AND "quills"."support_merge_records"."source_id" <> "quills"."support_merge_records"."target_id")
);
--> statement-breakpoint
ALTER TABLE "quills"."support_merge_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."conversations" ADD COLUMN "merged_into_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."conversations" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."tickets" ADD COLUMN "merged_into_ticket_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."tickets" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."support_merge_records" ADD CONSTRAINT "support_merge_records_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."support_merge_records" ADD CONSTRAINT "support_merge_records_merged_by_fk" FOREIGN KEY ("workspace_id","merged_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("merged_by_principal_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."support_merge_records" ADD CONSTRAINT "support_merge_records_undone_by_fk" FOREIGN KEY ("workspace_id","undone_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("undone_by_principal_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "support_merge_records_ws_source_idx" ON "quills"."support_merge_records" USING btree ("workspace_id","entity_kind","source_id");--> statement-breakpoint
CREATE INDEX "support_merge_records_ws_target_idx" ON "quills"."support_merge_records" USING btree ("workspace_id","entity_kind","target_id");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."support_merge_records" AS PERMISSIVE FOR ALL TO public USING ("quills"."support_merge_records"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."support_merge_records"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."support_merge_records" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
