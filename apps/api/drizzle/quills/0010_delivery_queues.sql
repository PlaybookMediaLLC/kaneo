-- The worker now executes delivery queues too. Same signature, owner and grants; only the queue list changes.
CREATE OR REPLACE FUNCTION quills.runnable_workspaces(after_workspace text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT q.workspace_id FROM (
  SELECT workspace_id FROM quills.job_queue WHERE queue IN ('quills.event','quills.webhook','quills.mail','quills.notification') AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<=now()))
  UNION ALL SELECT workspace_id FROM quills.events e WHERE published_at IS NULL AND NOT EXISTS (SELECT 1 FROM quills.job_queue j WHERE j.workspace_id=e.workspace_id AND j.queue='quills.event' AND j.dedupe_key=e.event_id)
 ) q JOIN public.workspace w ON w.id=q.workspace_id
 WHERE w.archived_at IS NULL AND q.workspace_id>after_workspace ORDER BY q.workspace_id LIMIT 100;
$$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
