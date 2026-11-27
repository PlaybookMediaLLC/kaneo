ALTER TABLE "quills"."assistant_pending_actions" ADD COLUMN "preview_diff" jsonb;--> statement-breakpoint
ALTER TABLE "quills"."assistant_pending_actions" ADD COLUMN "approval_token_hash" text;--> statement-breakpoint
ALTER TABLE "quills"."assistant_pending_actions" ADD COLUMN "procedure_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."assistant_pending_actions" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "quills"."agent_skills" ADD COLUMN "allowed_tools" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
