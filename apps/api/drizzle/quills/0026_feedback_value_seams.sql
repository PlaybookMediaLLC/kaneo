-- RFC 0003 seams: six new tables and nullable columns on boards, posts and post_votes. Each new
-- CHECK on posts and post_votes reads that table once under the ACCESS EXCLUSIVE lock of its ADD
-- COLUMN (the new columns are null, so no row fails). The locks stay until the batch commits.
-- Rollback: restore the verified backup; the previous application rejects this migration ledger.
CREATE TABLE "quills"."feedback_signals" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"conversation_id" uuid,
	"ticket_id" uuid,
	"source_message_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"suggested_title" text NOT NULL,
	"matched_post_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_principal_id" uuid,
	"decided_at" timestamp with time zone,
	"resulting_post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_signals_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "feedback_signals_source_check" CHECK (num_nonnulls("quills"."feedback_signals"."conversation_id", "quills"."feedback_signals"."ticket_id") = 1),
	CONSTRAINT "feedback_signals_status_check" CHECK ("quills"."feedback_signals"."status" IN ('pending','accepted','dismissed')),
	CONSTRAINT "feedback_signals_decided_check" CHECK (("quills"."feedback_signals"."status" = 'pending') = ("quills"."feedback_signals"."decided_at" IS NULL)),
	CONSTRAINT "feedback_signals_excerpt_check" CHECK (char_length("quills"."feedback_signals"."excerpt") BETWEEN 1 AND 2000),
	CONSTRAINT "feedback_signals_suggested_title_check" CHECK (char_length("quills"."feedback_signals"."suggested_title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."survey_responses" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"survey_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"score" integer,
	"choice" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "survey_responses_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "survey_responses_score_check" CHECK ("quills"."survey_responses"."score" IS NULL OR "quills"."survey_responses"."score" BETWEEN 0 AND 10),
	CONSTRAINT "survey_responses_choice_check" CHECK ("quills"."survey_responses"."choice" IS NULL OR char_length("quills"."survey_responses"."choice") BETWEEN 1 AND 200),
	CONSTRAINT "survey_responses_comment_check" CHECK ("quills"."survey_responses"."comment" IS NULL OR char_length("quills"."survey_responses"."comment") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "quills"."survey_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."surveys" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"type" text NOT NULL,
	"question" text NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"target_segment_ids" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "surveys_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "surveys_type_check" CHECK ("quills"."surveys"."type" IN ('nps','csat','ces','pmf','poll','open')),
	CONSTRAINT "surveys_status_check" CHECK ("quills"."surveys"."status" IN ('draft','active','closed')),
	CONSTRAINT "surveys_question_check" CHECK (char_length("quills"."surveys"."question") BETWEEN 1 AND 500),
	CONSTRAINT "surveys_options_check" CHECK (jsonb_typeof("quills"."surveys"."options") = 'array' AND jsonb_array_length("quills"."surveys"."options") <= 20 AND octet_length("quills"."surveys"."options"::text) <= 4000),
	CONSTRAINT "surveys_target_segment_ids_array_check" CHECK ("quills"."surveys"."target_segment_ids" IS NULL OR jsonb_typeof("quills"."surveys"."target_segment_ids") = 'array')
);
--> statement-breakpoint
ALTER TABLE "quills"."surveys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."changelog_reactions" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"changelog_entry_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changelog_reactions_pk" PRIMARY KEY("workspace_id","changelog_entry_id","principal_id","emoji"),
	CONSTRAINT "changelog_reactions_emoji_check" CHECK ("quills"."changelog_reactions"."emoji" IN ('👍','❤️','🎉','😄','😕','👀','🚀'))
);
--> statement-breakpoint
ALTER TABLE "quills"."changelog_reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."changelog_reads" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"principal_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "changelog_reads_workspace_id_principal_id_pk" PRIMARY KEY("workspace_id","principal_id")
);
--> statement-breakpoint
ALTER TABLE "quills"."changelog_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."content_translations" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"post_id" uuid,
	"comment_id" uuid,
	"locale" text NOT NULL,
	"title" text,
	"content" text NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_translations_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "content_translations_entity_check" CHECK (num_nonnulls("quills"."content_translations"."post_id", "quills"."content_translations"."comment_id") = 1),
	CONSTRAINT "content_translations_title_check" CHECK ("quills"."content_translations"."title" IS NULL OR char_length("quills"."content_translations"."title") <= 400),
	CONSTRAINT "content_translations_locale_check" CHECK (char_length("quills"."content_translations"."locale") BETWEEN 2 AND 35),
	CONSTRAINT "content_translations_content_check" CHECK (char_length("quills"."content_translations"."content") <= 20000),
	CONSTRAINT "content_translations_source_hash_check" CHECK ("quills"."content_translations"."source_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "quills"."content_translations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."boards" ADD COLUMN "visible_segment_ids" jsonb;--> statement-breakpoint
ALTER TABLE "quills"."post_votes" ADD COLUMN "importance" text;--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD COLUMN "score_reach" integer;--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD COLUMN "score_impact" real;--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD COLUMN "score_confidence" integer;--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD COLUMN "score_effort" real;--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ADD CONSTRAINT "feedback_signals_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ADD CONSTRAINT "feedback_signals_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "quills"."conversations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ADD CONSTRAINT "feedback_signals_ticket_fk" FOREIGN KEY ("workspace_id","ticket_id") REFERENCES "quills"."tickets"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ADD CONSTRAINT "feedback_signals_source_message_fk" FOREIGN KEY ("workspace_id","source_message_id") REFERENCES "quills"."conversation_messages"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ADD CONSTRAINT "feedback_signals_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ADD CONSTRAINT "feedback_signals_matched_post_fk" FOREIGN KEY ("workspace_id","matched_post_id") REFERENCES "quills"."posts"("workspace_id","id") ON DELETE SET NULL ("matched_post_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ADD CONSTRAINT "feedback_signals_resulting_post_fk" FOREIGN KEY ("workspace_id","resulting_post_id") REFERENCES "quills"."posts"("workspace_id","id") ON DELETE SET NULL ("resulting_post_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" ADD CONSTRAINT "feedback_signals_decided_by_principal_fk" FOREIGN KEY ("workspace_id","decided_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("decided_by_principal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."survey_responses" ADD CONSTRAINT "survey_responses_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."survey_responses" ADD CONSTRAINT "survey_responses_survey_fk" FOREIGN KEY ("workspace_id","survey_id") REFERENCES "quills"."surveys"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."survey_responses" ADD CONSTRAINT "survey_responses_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."surveys" ADD CONSTRAINT "surveys_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."surveys" ADD CONSTRAINT "surveys_created_by_principal_fk" FOREIGN KEY ("workspace_id","created_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("created_by_principal_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."changelog_reactions" ADD CONSTRAINT "changelog_reactions_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."changelog_reactions" ADD CONSTRAINT "changelog_reactions_entry_fk" FOREIGN KEY ("workspace_id","changelog_entry_id") REFERENCES "quills"."changelog_entries"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."changelog_reactions" ADD CONSTRAINT "changelog_reactions_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."changelog_reads" ADD CONSTRAINT "changelog_reads_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."changelog_reads" ADD CONSTRAINT "changelog_reads_principal_fk" FOREIGN KEY ("workspace_id","principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."content_translations" ADD CONSTRAINT "content_translations_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."content_translations" ADD CONSTRAINT "content_translations_post_fk" FOREIGN KEY ("workspace_id","post_id") REFERENCES "quills"."posts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."content_translations" ADD CONSTRAINT "content_translations_comment_fk" FOREIGN KEY ("workspace_id","comment_id") REFERENCES "quills"."post_comments"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_signals_source_message_idx" ON "quills"."feedback_signals" USING btree ("workspace_id","source_message_id");--> statement-breakpoint
CREATE INDEX "feedback_signals_status_created_idx" ON "quills"."feedback_signals" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "feedback_signals_conversation_id_fk_idx" ON "quills"."feedback_signals" USING btree ("workspace_id","conversation_id") WHERE "quills"."feedback_signals"."conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feedback_signals_ticket_id_fk_idx" ON "quills"."feedback_signals" USING btree ("workspace_id","ticket_id") WHERE "quills"."feedback_signals"."ticket_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feedback_signals_principal_id_fk_idx" ON "quills"."feedback_signals" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "feedback_signals_matched_post_id_fk_idx" ON "quills"."feedback_signals" USING btree ("workspace_id","matched_post_id") WHERE "quills"."feedback_signals"."matched_post_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feedback_signals_resulting_post_id_fk_idx" ON "quills"."feedback_signals" USING btree ("workspace_id","resulting_post_id") WHERE "quills"."feedback_signals"."resulting_post_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "feedback_signals_decided_by_principal_id_fk_idx" ON "quills"."feedback_signals" USING btree ("workspace_id","decided_by_principal_id") WHERE "quills"."feedback_signals"."decided_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "survey_responses_survey_principal_idx" ON "quills"."survey_responses" USING btree ("workspace_id","survey_id","principal_id");--> statement-breakpoint
CREATE INDEX "survey_responses_principal_id_fk_idx" ON "quills"."survey_responses" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "surveys_status_created_idx" ON "quills"."surveys" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "surveys_created_by_principal_id_fk_idx" ON "quills"."surveys" USING btree ("workspace_id","created_by_principal_id") WHERE "quills"."surveys"."created_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "changelog_reactions_principal_id_fk_idx" ON "quills"."changelog_reactions" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_translations_post_idx" ON "quills"."content_translations" USING btree ("workspace_id","post_id","locale","source_hash") WHERE "quills"."content_translations"."post_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "content_translations_comment_idx" ON "quills"."content_translations" USING btree ("workspace_id","comment_id","locale","source_hash") WHERE "quills"."content_translations"."comment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "content_translations_created_at_idx" ON "quills"."content_translations" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "quills"."boards" ADD CONSTRAINT "boards_visible_segment_ids_array_check" CHECK ("quills"."boards"."visible_segment_ids" IS NULL OR jsonb_typeof("quills"."boards"."visible_segment_ids") = 'array');--> statement-breakpoint
ALTER TABLE "quills"."post_votes" ADD CONSTRAINT "post_votes_importance_check" CHECK ("quills"."post_votes"."importance" IS NULL OR "quills"."post_votes"."importance" IN ('nice','important','critical'));--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD CONSTRAINT "posts_score_reach_check" CHECK ("quills"."posts"."score_reach" IS NULL OR "quills"."posts"."score_reach" >= 0);--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD CONSTRAINT "posts_score_impact_check" CHECK ("quills"."posts"."score_impact" IS NULL OR "quills"."posts"."score_impact" IN (0.25, 0.5, 1, 2, 3));--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD CONSTRAINT "posts_score_confidence_check" CHECK ("quills"."posts"."score_confidence" IS NULL OR "quills"."posts"."score_confidence" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD CONSTRAINT "posts_score_effort_check" CHECK ("quills"."posts"."score_effort" IS NULL OR ("quills"."posts"."score_effort" > 0 AND "quills"."posts"."score_effort" <= 10000));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."feedback_signals" AS PERMISSIVE FOR ALL TO public USING ("quills"."feedback_signals"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."feedback_signals"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."survey_responses" AS PERMISSIVE FOR ALL TO public USING ("quills"."survey_responses"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."survey_responses"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."surveys" AS PERMISSIVE FOR ALL TO public USING ("quills"."surveys"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."surveys"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."changelog_reactions" AS PERMISSIVE FOR ALL TO public USING ("quills"."changelog_reactions"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."changelog_reactions"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."changelog_reads" AS PERMISSIVE FOR ALL TO public USING ("quills"."changelog_reads"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."changelog_reads"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."content_translations" AS PERMISSIVE FOR ALL TO public USING ("quills"."content_translations"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."content_translations"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."feedback_signals" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."survey_responses" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."surveys" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."changelog_reactions" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."changelog_reads" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."content_translations" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
-- A workspace import inserts tables in any order and defers foreign keys until commit
-- (transfer/import-archive.ts), as 0005 and 0025 set up for the older tables.
DO $$ DECLARE fk record; BEGIN
 FOR fk IN SELECT c.conname, t.relname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relnamespace = 'quills'::regnamespace AND c.contype = 'f' AND c.conparentid = 0
  AND t.relname IN ('feedback_signals','surveys','survey_responses','changelog_reactions','changelog_reads','content_translations') LOOP
  EXECUTE format('ALTER TABLE quills.%I ALTER CONSTRAINT %I DEFERRABLE INITIALLY IMMEDIATE', fk.relname, fk.conname);
 END LOOP;
END $$;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
