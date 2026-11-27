CREATE TABLE "quills"."contact_identities" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"principal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_identities_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "contact_identities_kind_value_check" CHECK ("quills"."contact_identities"."kind" IN ('email','external_id','phone','slack_id','github_id') AND char_length("quills"."contact_identities"."value") BETWEEN 1 AND 320)
);
--> statement-breakpoint
ALTER TABLE "quills"."contact_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."contact_merges" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"source_principal_id" uuid NOT NULL,
	"target_principal_id" uuid NOT NULL,
	"merged_by_principal_id" uuid,
	"reason" text,
	"snapshot" jsonb NOT NULL,
	"reversible_until" timestamp with time zone NOT NULL,
	"undone_at" timestamp with time zone,
	"undone_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_merges_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."contact_merges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."principal" ADD COLUMN "merged_into_principal_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."principal" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."contact_identities" ADD CONSTRAINT "contact_identities_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."contact_identities" ADD CONSTRAINT "contact_identities_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."contact_merges" ADD CONSTRAINT "contact_merges_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."contact_merges" ADD CONSTRAINT "contact_merges_source_fk" FOREIGN KEY ("workspace_id","source_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."contact_merges" ADD CONSTRAINT "contact_merges_target_fk" FOREIGN KEY ("workspace_id","target_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."contact_merges" ADD CONSTRAINT "contact_merges_merged_by_fk" FOREIGN KEY ("workspace_id","merged_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("merged_by_principal_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."contact_merges" ADD CONSTRAINT "contact_merges_undone_by_fk" FOREIGN KEY ("workspace_id","undone_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("undone_by_principal_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_identities_ws_kind_value_uq" ON "quills"."contact_identities" USING btree ("workspace_id","kind",lower("value"));--> statement-breakpoint
CREATE INDEX "contact_identities_ws_principal_idx" ON "quills"."contact_identities" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "contact_merges_ws_source_idx" ON "quills"."contact_merges" USING btree ("workspace_id","source_principal_id");--> statement-breakpoint
CREATE INDEX "contact_merges_ws_target_idx" ON "quills"."contact_merges" USING btree ("workspace_id","target_principal_id");--> statement-breakpoint
ALTER TABLE "quills"."principal" ADD CONSTRAINT "principal_merged_into_fk" FOREIGN KEY ("workspace_id","merged_into_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("merged_into_principal_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "principal_merged_into_idx" ON "quills"."principal" USING btree ("workspace_id","merged_into_principal_id") WHERE "merged_into_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."contact_identities" AS PERMISSIVE FOR ALL TO public USING ("quills"."contact_identities"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."contact_identities"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."contact_merges" AS PERMISSIVE FOR ALL TO public USING ("quills"."contact_merges"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."contact_merges"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."contact_identities" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."contact_merges" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
