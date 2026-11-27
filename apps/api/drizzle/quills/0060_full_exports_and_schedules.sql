CREATE TABLE "quills"."export_schedules" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"destination_endpoint" text NOT NULL,
	"bucket" text NOT NULL,
	"prefix" text DEFAULT 'kaneo-backups/' NOT NULL,
	"region" text DEFAULT 'auto' NOT NULL,
	"sealed_credentials" text NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"last_status" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "export_schedules_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."export_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."export_runs" ADD COLUMN "format" text DEFAULT 'csv' NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."export_runs" ADD COLUMN "since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."export_runs" ADD COLUMN "file_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."export_runs" ADD COLUMN "manifest_json" jsonb;--> statement-breakpoint
ALTER TABLE "quills"."export_schedules" ADD CONSTRAINT "export_schedules_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."export_schedules" AS PERMISSIVE FOR ALL TO public USING ("quills"."export_schedules"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."export_schedules"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."export_schedules" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
