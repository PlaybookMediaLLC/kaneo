-- No route could publish a workflow before this release, so every live workflow came from an
-- import. Pause them: each runs again only after a teammate here publishes it and becomes its
-- acting teammate. Row security applies, so each workspace is scoped in turn; workflows are
-- configuration, so each update is small.
DO $$ DECLARE ws text; BEGIN
 FOR ws IN SELECT id FROM public.workspace LOOP
  PERFORM set_config('quills.workspace_id', ws, true);
  UPDATE quills.workflows SET status='paused', updated_at=now() WHERE status='live';
 END LOOP;
 PERFORM set_config('quills.workspace_id', '', true);
END $$;
--> statement-breakpoint
-- The worker also executes workflow runs, and visits a workspace when timed work is due there:
-- a snooze wake, a scheduled changelog announcement or a maintenance window bound.
-- Same signature, owner and grants; only the queue list and the due-work branches change.
CREATE OR REPLACE FUNCTION quills.runnable_workspaces(after_workspace text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT q.workspace_id FROM (
  SELECT workspace_id FROM quills.job_queue WHERE queue IN ('quills.event','quills.webhook','quills.mail','quills.notification','quills.domain_check','quills.wipe','quills.transfer','quills.workflow') AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<=now()))
  UNION ALL SELECT workspace_id FROM quills.events e WHERE published_at IS NULL AND NOT EXISTS (SELECT 1 FROM quills.job_queue j WHERE j.workspace_id=e.workspace_id AND j.queue='quills.event' AND j.dedupe_key=e.event_id)
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='snoozed' AND snoozed_until IS NOT NULL AND snoozed_until<=now()
  UNION ALL SELECT workspace_id FROM quills.changelog_entries WHERE notified_at IS NULL AND deleted_at IS NULL AND published_at<=now() AND published_at>now()-interval '1 day'
  UNION ALL SELECT workspace_id FROM quills.status_incidents WHERE kind='maintenance' AND deleted_at IS NULL AND ((status='scheduled' AND auto_start AND scheduled_start_at<=now() AND scheduled_start_at>now()-interval '1 day') OR (status IN ('scheduled','in_progress','verifying') AND auto_complete AND scheduled_end_at<=now()))
 ) q JOIN public.workspace w ON w.id=q.workspace_id
 WHERE w.archived_at IS NULL AND q.workspace_id>after_workspace ORDER BY q.workspace_id LIMIT 100;
$$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
