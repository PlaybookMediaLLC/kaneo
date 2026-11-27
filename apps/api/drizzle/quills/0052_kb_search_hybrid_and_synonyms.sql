CREATE TABLE "quills"."kb_search_synonyms" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"term" text NOT NULL,
	"synonyms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kb_search_synonyms_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."kb_search_synonyms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."kb_search_queries" ADD COLUMN "clicked_article_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."kb_search_queries" ADD COLUMN "clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."kb_search_synonyms" ADD CONSTRAINT "kb_search_synonyms_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kb_search_synonyms_ws_term_uq" ON "quills"."kb_search_synonyms" USING btree ("workspace_id",lower("term"));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."kb_search_synonyms" AS PERMISSIVE FOR ALL TO public USING ("quills"."kb_search_synonyms"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."kb_search_synonyms"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."kb_search_synonyms" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
