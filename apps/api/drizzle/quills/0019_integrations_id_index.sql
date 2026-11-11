CREATE INDEX "integrations_id_idx" ON "quills"."integrations" USING btree ("id");
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
