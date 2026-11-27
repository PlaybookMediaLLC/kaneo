-- Round 1 & 2 review hardening (#300, #302, #304, #310, #314, #315, #322, #327):
-- 1. Composite tenant FKs + required FK indexes + self-merge & enum CHECK constraints.
-- 2. RLS-scoped export_schedules deduplication + unique workspace index.
-- 3. Update quills.runnable_workspaces with exact sweep-matching predicates & timestamp-leading partial indexes.

ALTER TABLE "quills"."assistant_pending_actions" ADD CONSTRAINT "assistant_pending_actions_procedure_fk" FOREIGN KEY ("workspace_id","procedure_id") REFERENCES "quills"."agent_skills"("workspace_id","id") ON DELETE SET NULL ("procedure_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "assistant_pending_actions_procedure_idx" ON "quills"."assistant_pending_actions" USING btree ("workspace_id","procedure_id") WHERE "procedure_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assistant_pending_actions_proposed_expires_idx" ON "quills"."assistant_pending_actions" USING btree ("expires_at","workspace_id") WHERE "status" = 'proposed';--> statement-breakpoint

ALTER TABLE "quills"."conversations" ADD CONSTRAINT "conversations_merged_into_fk" FOREIGN KEY ("workspace_id","merged_into_conversation_id") REFERENCES "quills"."conversations"("workspace_id","id") ON DELETE SET NULL ("merged_into_conversation_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."conversations" ADD CONSTRAINT "conversations_no_self_merge_check" CHECK ("merged_into_conversation_id" IS NULL OR "merged_into_conversation_id" <> "id");--> statement-breakpoint
CREATE INDEX "conversations_merged_into_idx" ON "quills"."conversations" USING btree ("workspace_id","merged_into_conversation_id") WHERE "merged_into_conversation_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "quills"."tickets" ADD CONSTRAINT "tickets_merged_into_fk" FOREIGN KEY ("workspace_id","merged_into_ticket_id") REFERENCES "quills"."tickets"("workspace_id","id") ON DELETE SET NULL ("merged_into_ticket_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
ALTER TABLE "quills"."tickets" ADD CONSTRAINT "tickets_no_self_merge_check" CHECK ("merged_into_ticket_id" IS NULL OR "merged_into_ticket_id" <> "id");--> statement-breakpoint
CREATE INDEX "tickets_merged_into_idx" ON "quills"."tickets" USING btree ("workspace_id","merged_into_ticket_id") WHERE "merged_into_ticket_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "quills"."principal" ADD CONSTRAINT "principal_no_self_merge_check" CHECK ("merged_into_principal_id" IS NULL OR "merged_into_principal_id" <> "id");--> statement-breakpoint
ALTER TABLE "quills"."contact_merges" ADD CONSTRAINT "contact_merges_distinct_principals_check" CHECK ("source_principal_id" <> "target_principal_id");--> statement-breakpoint
CREATE INDEX "contact_merges_merged_by_idx" ON "quills"."contact_merges" USING btree ("workspace_id","merged_by_principal_id") WHERE "merged_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "contact_merges_undone_by_idx" ON "quills"."contact_merges" USING btree ("workspace_id","undone_by_principal_id") WHERE "undone_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_merge_records_merged_by_idx" ON "quills"."support_merge_records" USING btree ("workspace_id","merged_by_principal_id") WHERE "merged_by_principal_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "support_merge_records_undone_by_idx" ON "quills"."support_merge_records" USING btree ("workspace_id","undone_by_principal_id") WHERE "undone_by_principal_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "quills"."ai_usage_log" ADD CONSTRAINT "ai_usage_log_conversation_fk" FOREIGN KEY ("workspace_id","conversation_id") REFERENCES "quills"."conversations"("workspace_id","id") ON DELETE SET NULL ("conversation_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "ai_usage_log_conversation_idx" ON "quills"."ai_usage_log" USING btree ("workspace_id","conversation_id") WHERE "conversation_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "quills"."kb_search_queries" ADD CONSTRAINT "kb_search_queries_clicked_article_fk" FOREIGN KEY ("workspace_id","clicked_article_id") REFERENCES "quills"."kb_articles"("workspace_id","id") ON DELETE SET NULL ("clicked_article_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "kb_search_queries_clicked_article_idx" ON "quills"."kb_search_queries" USING btree ("workspace_id","clicked_article_id") WHERE "clicked_article_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "quills"."post_votes" ADD CONSTRAINT "post_votes_source_signal_fk" FOREIGN KEY ("workspace_id","source_signal_id") REFERENCES "quills"."feedback_signals"("workspace_id","id") ON DELETE SET NULL ("source_signal_id") ON UPDATE no action DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
CREATE INDEX "post_votes_source_signal_idx" ON "quills"."post_votes" USING btree ("workspace_id","source_signal_id") WHERE "source_signal_id" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "quills"."kb_article_links" ADD CONSTRAINT "kb_article_links_target_kind_check" CHECK ("target_kind" IN ('changelog', 'post', 'url'));--> statement-breakpoint
ALTER TABLE "quills"."export_schedules" ADD CONSTRAINT "export_schedules_cadence_check" CHECK ("cadence" IN ('daily', 'weekly', 'monthly'));--> statement-breakpoint
ALTER TABLE "quills"."export_runs" ADD CONSTRAINT "export_runs_format_check" CHECK ("format" IN ('csv', 'zip'));--> statement-breakpoint

CREATE INDEX "kb_articles_due_review_idx" ON "quills"."kb_articles" USING btree ("review_by","workspace_id") WHERE "deleted_at" IS NULL AND "stale_flagged_at" IS NULL AND "review_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kb_articles_unreviewed_unhelpful_idx" ON "quills"."kb_articles" USING btree ("workspace_id") WHERE "deleted_at" IS NULL AND "stale_flagged_at" IS NULL AND "last_reviewed_at" IS NULL AND ("helpful_count" + "not_helpful_count") >= 5 AND ("not_helpful_count" * 10) >= (("helpful_count" + "not_helpful_count") * 4);--> statement-breakpoint
CREATE INDEX "kb_articles_reviewed_active_idx" ON "quills"."kb_articles" USING btree ("workspace_id","id","last_reviewed_at") WHERE "deleted_at" IS NULL AND "stale_flagged_at" IS NULL AND "last_reviewed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "kb_article_feedback_ws_article_created_idx" ON "quills"."kb_article_feedback" USING btree ("workspace_id","article_id","created_at","helpful");--> statement-breakpoint

-- Deduplicate export_schedules per workspace under FORCE ROW LEVEL SECURITY.
DO $$ DECLARE ws text; BEGIN
 FOR ws IN SELECT id FROM public.workspace LOOP
  PERFORM set_config('quills.workspace_id', ws, true);
  DELETE FROM quills.export_schedules a
  USING quills.export_schedules b
  WHERE a.workspace_id = b.workspace_id
    AND (a.updated_at < b.updated_at OR (a.updated_at = b.updated_at AND a.id < b.id));
 END LOOP;
 PERFORM set_config('quills.workspace_id', '', true);
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX "export_schedules_workspace_uq" ON "quills"."export_schedules" USING btree ("workspace_id");--> statement-breakpoint

CREATE OR REPLACE FUNCTION quills.runnable_workspaces(after_workspace text) RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT DISTINCT q.workspace_id FROM (
  SELECT workspace_id FROM quills.job_queue WHERE queue IN ('quills.event','quills.webhook','quills.mail','quills.notification','quills.domain_check','quills.wipe','quills.transfer','quills.workflow','quills.ai') AND ((status='pending' AND run_at<=now()) OR (status='running' AND locked_until<=now()))
  UNION ALL SELECT workspace_id FROM quills.events e WHERE published_at IS NULL AND NOT EXISTS (SELECT 1 FROM quills.job_queue j WHERE j.workspace_id=e.workspace_id AND j.queue='quills.event' AND j.dedupe_key=e.event_id)
  UNION ALL SELECT workspace_id FROM quills.conversations WHERE status='snoozed' AND snoozed_until IS NOT NULL AND snoozed_until<=now()
  UNION ALL SELECT workspace_id FROM quills.changelog_entries WHERE notified_at IS NULL AND deleted_at IS NULL AND published_at<=now() AND published_at>now()-interval '1 day'
  UNION ALL SELECT workspace_id FROM quills.status_incidents WHERE kind='maintenance' AND deleted_at IS NULL AND ((status='scheduled' AND auto_start AND scheduled_start_at<=now() AND scheduled_start_at>now()-interval '1 day') OR (status IN ('scheduled','in_progress','verifying') AND auto_complete AND scheduled_end_at<=now()))
  UNION ALL SELECT d.id FROM public.workspace d WHERE EXISTS (SELECT 1 FROM quills.audit_log a WHERE a.workspace_id=d.id AND a.event_type='post.status_changed' AND a.target_type='post' AND a.occurred_at>=(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days') AT TIME ZONE 'UTC' AND a.occurred_at<date_trunc('week', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AND NOT EXISTS (SELECT 1 FROM quills.kv_store k WHERE k.workspace_id=d.id AND k.workspace_key='_' AND k.key='digest:'||to_char(date_trunc('week', now() AT TIME ZONE 'UTC') - interval '7 days', 'IYYY-"W"IW') AND k.value->>'done'='true')
  UNION ALL SELECT workspace_id FROM quills.assistant_involvements WHERE status='active' AND last_assistant_answer_at<=now()-interval '24 hours'
  UNION ALL SELECT workspace_id FROM quills.assistant_web_sources WHERE enabled AND fetched_at<=now()-interval '7 days' AND updated_at<=now()-interval '1 day'
  UNION ALL SELECT workspace_id FROM quills.assistant_pending_actions WHERE status='proposed' AND expires_at<=now()
  UNION ALL SELECT workspace_id FROM quills.kb_articles WHERE deleted_at IS NULL AND stale_flagged_at IS NULL AND review_by IS NOT NULL AND review_by<=now()
  UNION ALL SELECT workspace_id FROM quills.kb_articles WHERE deleted_at IS NULL AND stale_flagged_at IS NULL AND last_reviewed_at IS NULL AND (helpful_count + not_helpful_count) >= 5 AND (not_helpful_count * 10) >= ((helpful_count + not_helpful_count) * 4)
  UNION ALL SELECT a.workspace_id FROM quills.kb_articles a JOIN quills.kb_article_feedback f ON f.workspace_id=a.workspace_id AND f.article_id=a.id WHERE a.deleted_at IS NULL AND a.stale_flagged_at IS NULL AND a.last_reviewed_at IS NOT NULL AND f.created_at > a.last_reviewed_at GROUP BY a.workspace_id, a.id HAVING count(*) >= 5 AND (count(*) FILTER (WHERE f.helpful = false) * 10) >= (count(*) * 4)
 ) q JOIN public.workspace w ON w.id=q.workspace_id
 WHERE w.archived_at IS NULL AND q.workspace_id>after_workspace ORDER BY q.workspace_id LIMIT 100;
$$;
--> statement-breakpoint
SELECT quills_migrations.capture_schema_manifest();
