ALTER TABLE "quills"."post_votes" ADD COLUMN "source_signal_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD COLUMN "first_team_response_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD COLUMN "ack_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD COLUMN "vote_burst_flagged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."posts" ADD COLUMN "vote_burst_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."companies" ADD COLUMN "churn_risk" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
