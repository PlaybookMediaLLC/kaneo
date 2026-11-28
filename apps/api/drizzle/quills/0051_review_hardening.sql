CREATE INDEX "notification_preferences_digest_due_idx" ON "quills"."notification_preferences" USING btree ("digest_last_sent_at") WHERE "quills"."notification_preferences"."digest_frequency" <> 'off';--> statement-breakpoint
CREATE UNIQUE INDEX "brands_workspace_default_idx" ON "quills"."brands" USING btree ("workspace_id") WHERE "quills"."brands"."is_default" = true;--> statement-breakpoint
ALTER TABLE "quills"."conversation_messages" ADD CONSTRAINT "conversation_messages_send_status_check" CHECK ("quills"."conversation_messages"."send_status" IN ('sent', 'scheduled', 'recalled'));
--> statement-breakpoint
CREATE TRIGGER quills_storage_changes BEFORE INSERT OR UPDATE OR DELETE ON quills.brands FOR EACH ROW EXECUTE FUNCTION quills.track_storage_changes();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION quills.runnable_workspaces(after_workspace text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT q.workspace_id FROM (
  SELECT workspace_id FROM quills.job_queue WHERE queue IN ('quills.event','quills.webhook','quills.mail','quills.notification','quills.domain_check','quills.wipe','quills.transfer','quills.workflow','quills.ai') AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<=now()))
  UNION ALL SELECT workspace_id FROM quills.events e WHERE published_at IS NULL AND NOT EXISTS (SELECT 1 FROM quills.job_queue j WHERE j.workspace_id=e.workspace_id AND j.queue='quills.event' AND j.dedupe_key=e.event_id)
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='snoozed' AND snoozed_until IS NOT NULL AND snoozed_until<=now()
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='open' AND waiting_since IS NOT NULL AND promised_reply_at IS NOT NULL AND breach_update_sent_at IS NULL AND promised_reply_at<=now()
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='open' AND solution_offered_at IS NOT NULL AND auto_close_at IS NOT NULL AND (auto_close_at<=now() OR (close_reminder_sent_at IS NULL AND auto_close_at<=now()+interval '72 hours'))
  UNION ALL SELECT workspace_id FROM quills.notification_preferences WHERE (digest_frequency='hourly' AND (digest_last_sent_at IS NULL OR digest_last_sent_at<=now()-interval '1 hour')) OR (digest_frequency='daily' AND (digest_last_sent_at IS NULL OR digest_last_sent_at<=now()-interval '24 hours'))
  UNION ALL SELECT workspace_id FROM quills.changelog_entries WHERE notified_at IS NULL AND deleted_at IS NULL AND published_at<=now() AND published_at>now()-interval '1 day'
  UNION ALL SELECT workspace_id FROM quills.status_incidents WHERE kind='maintenance' AND deleted_at IS NULL AND ((status='scheduled' AND auto_start AND scheduled_start_at<=now() AND scheduled_start_at>now()-interval '1 day') OR (status IN ('scheduled','in_progress','verifying') AND auto_complete AND scheduled_end_at<=now()))
  UNION ALL SELECT d.id FROM public.workspace d WHERE EXISTS (SELECT 1 FROM quills.audit_log a WHERE a.workspace_id=d.id AND a.event_type='post.status_changed' AND a.target_type='post' AND a.occurred_at>=(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days') AT TIME ZONE 'UTC' AND a.occurred_at<date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AND NOT EXISTS (SELECT 1 FROM quills.kv_store k WHERE k.workspace_id=d.id AND k.workspace_key='_' AND k.key='digest:'||to_char(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days', 'IYYY-"W"IW') AND k.value->>'done'='true')
  UNION ALL SELECT workspace_id FROM quills.assistant_involvements WHERE status='active' AND last_assistant_answer_at<=now()-interval '24 hours'
  UNION ALL SELECT workspace_id FROM quills.assistant_web_sources WHERE enabled AND fetched_at<=now()-interval '7 days' AND updated_at<=now()-interval '1 day'
 ) q JOIN public.workspace w ON w.id=q.workspace_id
 WHERE w.archived_at IS NULL AND q.workspace_id>after_workspace ORDER BY q.workspace_id LIMIT 100;
$$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
