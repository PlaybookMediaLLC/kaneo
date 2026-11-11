-- The workspace that owns one integration, for signed inbound webhooks (framework/signed.ts).
-- A signed request names an integration row; the verifier checks that row's secret under workspace RLS.
-- Only the application credential may execute it (migrate.ts grants it); quills_runtime and PUBLIC may not.
-- Null when no row or more than one row has the ID.
CREATE FUNCTION quills.integration_workspace(integration uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT CASE WHEN count(*)=1 THEN min(workspace_id) END FROM quills.integrations WHERE id=integration;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION quills.integration_workspace(uuid) FROM PUBLIC;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
