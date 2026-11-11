-- Indexes for foreign keys to principal, customer_identity and other parents on small tables, and
-- a unique index on live conversation tag names in any case. The large tables get their indexes
-- CONCURRENTLY after the migrations (schema-ops.ts), as 0014 does; this file does not build them.
-- Each CREATE INDEX here takes a SHARE lock (writes wait) on one small configuration table, held
-- until the migration batch commits. DROP INDEX kb_search_queries_created_at_idx comes last, so its
-- ACCESS EXCLUSIVE lock on that public-traffic table is the shortest; until
-- kb_search_queries_workspace_created_idx is built, the search terms report scans the table.
-- Before the unique index: two concurrent creates could leave live tags that differ only in case
-- (the route checks, then inserts). The lock stops tag writes until the batch commits. In each
-- group the oldest live tag keeps its name; the others get the end of their ID added, as in
-- "bug (0c2fdb9194c4)", within the route's 50 characters. No tag, ID, assignment, macro or
-- workflow changes otherwise. The loop reads each workspace's live tags once, per workspace
-- because the tables force row security on their owner.
-- Rollback: restore the verified backup; the previous application rejects this migration ledger.
LOCK TABLE "quills"."conversation_tags" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
DO $$
DECLARE ws text; previous text := current_setting('quills.workspace_id', true);
BEGIN
  FOR ws IN SELECT id FROM public.workspace LOOP
    PERFORM set_config('quills.workspace_id', ws, true);
    UPDATE quills.conversation_tags c SET name = left(c.name, 35) || ' (' || right(c.id::text, 12) || ')'
      FROM (SELECT id, first_value(id) OVER (PARTITION BY lower(name) ORDER BY created_at, id) AS keep_id
            FROM quills.conversation_tags WHERE workspace_id = ws AND deleted_at IS NULL) t
      WHERE c.workspace_id = ws AND c.id = t.id AND t.id <> t.keep_id;
  END LOOP;
  PERFORM set_config('quills.workspace_id', coalesce(previous, ''), true);
END $$;
--> statement-breakpoint
CREATE INDEX "oauth_client_user_id_fk_idx" ON "quills"."oauth_client" USING btree ("workspace_id","user_id") WHERE "quills"."oauth_client"."user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "principal_role_assignments_granted_by_principal_id_fk_idx" ON "quills"."principal_role_assignments" USING btree ("workspace_id","granted_by_principal_id") WHERE "quills"."principal_role_assignments"."granted_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "post_views_created_by_principal_id_fk_idx" ON "quills"."post_views" USING btree ("workspace_id","created_by_principal_id") WHERE "quills"."post_views"."created_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "integration_platform_credentials_configured_by_fk_idx" ON "quills"."integration_platform_credentials" USING btree ("workspace_id","configured_by_principal_id") WHERE "quills"."integration_platform_credentials"."configured_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "integrations_connected_by_principal_id_fk_idx" ON "quills"."integrations" USING btree ("workspace_id","connected_by_principal_id") WHERE "quills"."integrations"."connected_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "integrations_principal_id_fk_idx" ON "quills"."integrations" USING btree ("workspace_id","principal_id") WHERE "quills"."integrations"."principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "status_incident_components_incident_id_fk_idx" ON "quills"."status_incident_components" USING btree ("workspace_id","incident_id");--> statement-breakpoint
CREATE INDEX "status_incident_updates_created_by_fk_idx" ON "quills"."status_incident_updates" USING btree ("workspace_id","created_by") WHERE "quills"."status_incident_updates"."created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "status_incidents_created_by_fk_idx" ON "quills"."status_incidents" USING btree ("workspace_id","created_by") WHERE "quills"."status_incidents"."created_by" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_tags_live_lower_name_idx" ON "quills"."conversation_tags" USING btree ("workspace_id",lower("name")) WHERE "quills"."conversation_tags"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "conversation_views_created_by_principal_id_fk_idx" ON "quills"."conversation_views" USING btree ("workspace_id","created_by_principal_id") WHERE "quills"."conversation_views"."created_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "teams_rr_cursor_principal_id_fk_idx" ON "quills"."teams" USING btree ("workspace_id","rr_cursor_principal_id") WHERE "quills"."teams"."rr_cursor_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflow_versions_created_by_fk_idx" ON "quills"."workflow_versions" USING btree ("workspace_id","created_by") WHERE "quills"."workflow_versions"."created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "workflows_created_by_fk_idx" ON "quills"."workflows" USING btree ("workspace_id","created_by") WHERE "quills"."workflows"."created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_documents_created_by_id_fk_idx" ON "quills"."assistant_documents" USING btree ("workspace_id","created_by_id") WHERE "quills"."assistant_documents"."created_by_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_snippets_created_by_id_fk_idx" ON "quills"."assistant_snippets" USING btree ("workspace_id","created_by_id") WHERE "quills"."assistant_snippets"."created_by_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_guidance_rules_created_by_id_fk_idx" ON "quills"."assistant_guidance_rules" USING btree ("workspace_id","created_by_id") WHERE "quills"."assistant_guidance_rules"."created_by_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "connectors_created_by_principal_id_fk_idx" ON "quills"."connectors" USING btree ("workspace_id","created_by_principal_id") WHERE "quills"."connectors"."created_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_skills_created_by_principal_id_fk_idx" ON "quills"."agent_skills" USING btree ("workspace_id","created_by_principal_id") WHERE "quills"."agent_skills"."created_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_web_sources_created_by_id_fk_idx" ON "quills"."assistant_web_sources" USING btree ("workspace_id","created_by_id") WHERE "quills"."assistant_web_sources"."created_by_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "macros_created_by_principal_id_fk_idx" ON "quills"."macros" USING btree ("workspace_id","created_by_principal_id") WHERE "quills"."macros"."created_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "import_runs_initiated_by_principal_id_fk_idx" ON "quills"."import_runs" USING btree ("workspace_id","initiated_by_principal_id");--> statement-breakpoint
CREATE INDEX "export_runs_initiated_by_principal_id_fk_idx" ON "quills"."export_runs" USING btree ("workspace_id","initiated_by_principal_id");--> statement-breakpoint
CREATE INDEX "slack_user_links_principal_id_fk_idx" ON "quills"."slack_user_links" USING btree ("workspace_id","principal_id");--> statement-breakpoint
CREATE INDEX "integration_sync_actions_operation_id_fk_idx" ON "quills"."integration_sync_actions" USING btree ("workspace_id","operation_id");--> statement-breakpoint
CREATE INDEX "portal_invites_invited_by_principal_id_fk_idx" ON "quills"."portal_invites" USING btree ("workspace_id","invited_by_principal_id") WHERE "quills"."portal_invites"."invited_by_principal_id" IS NOT NULL;
--> statement-breakpoint
DROP INDEX "quills"."kb_search_queries_created_at_idx";
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
