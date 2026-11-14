-- The worker also visits a workspace whose weekly digest is due: posts changed status in the last
-- full ISO week (UTC), and the digest cursor in kv_store (digest:<week>) is not done. Before this,
-- a workspace with no other due work in the week missed its digest. Same signature, owner and
-- grants; the audit_log (event_type, occurred_at) index bounds the scan to one week.
CREATE OR REPLACE FUNCTION quills.runnable_workspaces(after_workspace text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT q.workspace_id FROM (
  SELECT workspace_id FROM quills.job_queue WHERE queue IN ('quills.event','quills.webhook','quills.mail','quills.notification','quills.domain_check','quills.wipe','quills.transfer','quills.workflow','quills.ai') AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<=now()))
  UNION ALL SELECT workspace_id FROM quills.events e WHERE published_at IS NULL AND NOT EXISTS (SELECT 1 FROM quills.job_queue j WHERE j.workspace_id=e.workspace_id AND j.queue='quills.event' AND j.dedupe_key=e.event_id)
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='snoozed' AND snoozed_until IS NOT NULL AND snoozed_until<=now()
  UNION ALL SELECT workspace_id FROM quills.changelog_entries WHERE notified_at IS NULL AND deleted_at IS NULL AND published_at<=now() AND published_at>now()-interval '1 day'
  UNION ALL SELECT workspace_id FROM quills.status_incidents WHERE kind='maintenance' AND deleted_at IS NULL AND ((status='scheduled' AND auto_start AND scheduled_start_at<=now() AND scheduled_start_at>now()-interval '1 day') OR (status IN ('scheduled','in_progress','verifying') AND auto_complete AND scheduled_end_at<=now()))
  UNION ALL SELECT a.workspace_id FROM quills.audit_log a WHERE a.event_type='post.status_changed' AND a.target_type='post' AND a.occurred_at>=(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days') AT TIME ZONE 'UTC' AND a.occurred_at<date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AND NOT EXISTS (SELECT 1 FROM quills.kv_store k WHERE k.workspace_id=a.workspace_id AND k.workspace_key='_' AND k.key='digest:'||to_char(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days', 'IYYY-"W"IW') AND k.value->>'done'='true')
 ) q JOIN public.workspace w ON w.id=q.workspace_id
 WHERE w.archived_at IS NULL AND q.workspace_id>after_workspace ORDER BY q.workspace_id LIMIT 100;
$$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
