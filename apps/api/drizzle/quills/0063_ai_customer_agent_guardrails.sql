CREATE TABLE "quills"."agent_decline_topics" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"policy" text DEFAULT 'quote_only' NOT NULL,
	"examples" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_decline_topics_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "agent_decline_topics_workspace_slug_unique" UNIQUE("workspace_id","slug"),
	CONSTRAINT "agent_decline_topics_policy_check" CHECK ("quills"."agent_decline_topics"."policy" IN ('quote_only','always_handoff'))
);
--> statement-breakpoint
ALTER TABLE "quills"."agent_decline_topics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."ai_eval_runs" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"channel" text DEFAULT 'all' NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"total_cases" integer NOT NULL,
	"passed_cases" integer NOT NULL,
	"grounding_score" real NOT NULL,
	"escalation_score" real NOT NULL,
	"decline_score" real NOT NULL,
	"passed" boolean NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_eval_runs_workspace_id_id_pk" PRIMARY KEY("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "quills"."ai_eval_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quills"."assistant_draft_replies" (
	"workspace_id" text DEFAULT nullif(current_setting('quills.workspace_id', true), '') NOT NULL,
	"id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"trigger_message_id" uuid,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"sent_message_id" uuid,
	"reviewed_by_principal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "assistant_draft_replies_workspace_id_id_pk" PRIMARY KEY("workspace_id","id"),
	CONSTRAINT "assistant_draft_replies_status_check" CHECK ("quills"."assistant_draft_replies"."status" IN ('pending','sent','dismissed'))
);
--> statement-breakpoint
ALTER TABLE "quills"."assistant_draft_replies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD COLUMN "source_conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD COLUMN "source_type" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."agent_decline_topics" ADD CONSTRAINT "agent_decline_topics_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."assistant_draft_replies" ADD CONSTRAINT "assistant_draft_replies_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."assistant_draft_replies" ADD CONSTRAINT "assistant_draft_replies_conversation_id_fkey" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "quills"."conversations"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."assistant_draft_replies" ADD CONSTRAINT "assistant_draft_replies_trigger_message_id_fkey" FOREIGN KEY ("workspace_id","trigger_message_id") REFERENCES "quills"."conversation_messages"("workspace_id","id") ON DELETE SET NULL ("trigger_message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."assistant_draft_replies" ADD CONSTRAINT "assistant_draft_replies_sent_message_id_fkey" FOREIGN KEY ("workspace_id","sent_message_id") REFERENCES "quills"."conversation_messages"("workspace_id","id") ON DELETE SET NULL ("sent_message_id") ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quills"."assistant_draft_replies" ADD CONSTRAINT "assistant_draft_replies_reviewed_by_principal_id_fkey" FOREIGN KEY ("workspace_id","reviewed_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("reviewed_by_principal_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_eval_runs_workspace_created_idx" ON "quills"."ai_eval_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_draft_replies_conv_status_idx" ON "quills"."assistant_draft_replies" USING btree ("workspace_id","conversation_id","status");--> statement-breakpoint
ALTER TABLE "quills"."kb_articles" ADD CONSTRAINT "kb_articles_source_type_check" CHECK ("quills"."kb_articles"."source_type" IN ('manual','learned'));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."agent_decline_topics" AS PERMISSIVE FOR ALL TO public USING ("quills"."agent_decline_topics"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."agent_decline_topics"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."ai_eval_runs" AS PERMISSIVE FOR ALL TO public USING ("quills"."ai_eval_runs"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."ai_eval_runs"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));--> statement-breakpoint
CREATE POLICY "workspace_isolation" ON "quills"."assistant_draft_replies" AS PERMISSIVE FOR ALL TO public USING ("quills"."assistant_draft_replies"."workspace_id" = nullif(current_setting('quills.workspace_id', true), '')) WITH CHECK ("quills"."assistant_draft_replies"."workspace_id" = nullif(current_setting('quills.workspace_id', true), ''));
--> statement-breakpoint
ALTER TABLE "quills"."agent_decline_topics" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."ai_eval_runs" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
ALTER TABLE "quills"."assistant_draft_replies" FORCE ROW LEVEL SECURITY;

--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
