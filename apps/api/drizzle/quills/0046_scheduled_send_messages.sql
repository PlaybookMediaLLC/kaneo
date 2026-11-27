ALTER TABLE "quills"."conversation_messages" ADD COLUMN "send_status" text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD COLUMN "scheduled_send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD COLUMN "recalled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD COLUMN "recalled_by_principal_id" uuid;--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD CONSTRAINT "conversation_messages_recalled_by_principal_id_fkey" FOREIGN KEY ("workspace_id","recalled_by_principal_id") REFERENCES "quills"."principal"("workspace_id","id") ON DELETE SET NULL ("recalled_by_principal_id") ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_messages_recalled_by_principal_idx" ON "quills"."conversation_messages" USING btree ("recalled_by_principal_id") WHERE "recalled_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "conversation_messages_scheduled_send_idx" ON "quills"."conversation_messages" USING btree ("workspace_id","scheduled_send_at") WHERE "quills"."conversation_messages"."send_status" = 'scheduled';
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
