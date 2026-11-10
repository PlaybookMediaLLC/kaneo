CREATE TABLE "quills"."custom_domains" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"kind" text NOT NULL,
	"domain" text NOT NULL,
	"verification_value" text NOT NULL,
	"verified_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"check_result" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_domains_workspace_id_kind_pk" PRIMARY KEY("workspace_id","kind"),
	CONSTRAINT "custom_domains_kind_check" CHECK ("quills"."custom_domains"."kind" IN ('portal', 'help_center')),
	CONSTRAINT "custom_domains_domain_normalized_check" CHECK ("quills"."custom_domains"."domain" = lower("quills"."custom_domains"."domain") AND right("quills"."custom_domains"."domain", 1) <> '.' AND char_length("quills"."custom_domains"."domain") BETWEEN 3 AND 253)
);
--> statement-breakpoint
ALTER TABLE "quills"."custom_domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."settings" ADD COLUMN "show_powered_by" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."custom_domains" ADD CONSTRAINT "custom_domains_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_domains_domain_unique" ON "quills"."custom_domains" USING btree ("domain");--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."custom_domains" AS PERMISSIVE FOR ALL TO public USING ("quills"."custom_domains"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."custom_domains"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."custom_domains" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- The worker also executes the domain check and wipe queues. Same signature, owner and grants; only the queue list changes.
CREATE OR REPLACE FUNCTION quills.runnable_workspaces(after_workspace text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT q.workspace_id FROM (
  SELECT workspace_id FROM quills.job_queue WHERE queue IN ('quills.event','quills.webhook','quills.mail','quills.notification','quills.domain_check','quills.wipe') AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<=now()))
  UNION ALL SELECT workspace_id FROM quills.events e WHERE published_at IS NULL AND NOT EXISTS (SELECT 1 FROM quills.job_queue j WHERE j.workspace_id=e.workspace_id AND j.queue='quills.event' AND j.dedupe_key=e.event_id)
 ) q JOIN public.workspace w ON w.id=q.workspace_id
 WHERE w.archived_at IS NULL AND q.workspace_id>after_workspace ORDER BY q.workspace_id LIMIT 100;
$$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
