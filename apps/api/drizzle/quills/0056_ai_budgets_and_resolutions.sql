ALTER TABLE "quills"."settings" ADD COLUMN "assistant_budget_config" jsonb;--> statement-breakpoint
ALTER TABLE "quills"."settings" ADD COLUMN "assistant_provider_secrets" text;--> statement-breakpoint
ALTER TABLE "quills"."ai_usage_log" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."ai_usage_log" ADD COLUMN "estimated_cost_usd" numeric(12, 6);--> statement-breakpoint
ALTER TABLE "quills"."assistant_involvements" ADD COLUMN "reopened_after_resolution_at" timestamp with time zone;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
