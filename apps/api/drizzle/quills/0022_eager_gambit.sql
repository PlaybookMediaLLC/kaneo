ALTER TABLE "quills"."apps" ALTER COLUMN "oauth_client_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."apps" ADD COLUMN "api_key_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "apps_api_key_id_idx" ON "quills"."apps" USING btree ("workspace_id","api_key_id") WHERE "quills"."apps"."api_key_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "quills"."apps" ADD CONSTRAINT "apps_credential_check" CHECK (num_nonnulls("quills"."apps"."oauth_client_id", "quills"."apps"."api_key_id") <= 1);
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
