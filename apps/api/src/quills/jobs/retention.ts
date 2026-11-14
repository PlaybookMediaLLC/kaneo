import { sql } from "drizzle-orm";
import { z } from "zod";
import db from "../../database";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../database/quills/client";
import { refreshVisitorAnalytics } from "../../database/quills/visitor-rollup";
import { pruneAnonymousVisitors } from "./anonymous-visitors";
const days = z.coerce.number().int().min(1).max(3650);
export const retentionSchema = z.object({
  events: days.default(90),
  jobs: days.default(7),
  logs: days.default(90),
});
export async function pruneQuillsWorkspace(
  tx: Database,
  input: z.input<typeof retentionSchema> = {},
) {
  const policy = retentionSchema.parse(input);
  // Keep this month's billing inputs even when an operator selects a shorter log retention.
  const statements = [
    // Registered portal drafts expire after a day; row locks keep attachment commits safe.
    sql`DELETE FROM quills.files WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.files WHERE source='portal' AND deleted_at IS NULL AND post_id IS NULL AND comment_id IS NULL AND message_id IS NULL AND attached_at IS NULL AND created_at<now()-interval '1 day' ORDER BY created_at LIMIT 1000 FOR UPDATE SKIP LOCKED)`,
    sql`DELETE FROM quills.events WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.events WHERE published_at IS NOT NULL AND published_at<now()-${policy.events}*interval '1 day' ORDER BY id LIMIT 1000)`,
    sql`DELETE FROM quills.job_queue WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.job_queue WHERE (status='succeeded' OR (status='failed' AND NOT EXISTS (SELECT 1 FROM quills.events e WHERE e.event_id=job_queue.dedupe_key AND e.published_at IS NULL))) AND finished_at<now()-${policy.jobs}*interval '1 day' ORDER BY id LIMIT 1000)`,
    // Delivery ledger rows outlive their jobs, so a replayed job finds them. Kept while their event is unpublished.
    sql`DELETE FROM quills.hook_deliveries WHERE (workspace_id,job_id) IN (SELECT workspace_id,job_id FROM quills.hook_deliveries h WHERE processed_at<now()-${policy.events}*interval '1 day' AND NOT EXISTS (SELECT 1 FROM quills.events e WHERE e.workspace_id=h.workspace_id AND e.event_id=split_part(h.job_id,':',2) AND e.published_at IS NULL) ORDER BY processed_at LIMIT 1000)`,
    sql`DELETE FROM quills.email_log WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.email_log WHERE created_at<least(now()-${policy.logs}*interval '1 day',date_trunc('month',now())) ORDER BY created_at LIMIT 1000)`,
    sql`DELETE FROM quills.ai_usage_log WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.ai_usage_log WHERE created_at<least(now()-${policy.logs}*interval '1 day',date_trunc('month',now())) ORDER BY created_at LIMIT 1000)`,
    sql`UPDATE quills.export_runs SET s3_key=NULL WHERE expires_at<=now() AND s3_key IS NOT NULL`,
    // Finished workflow runs, with their events (cascade), after the event retention.
    sql`DELETE FROM quills.workflow_runs WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.workflow_runs WHERE state IN ('done','interrupted') AND started_at<now()-${policy.events}*interval '1 day' ORDER BY started_at LIMIT 1000)`,
    // Rows that anonymous portal and widget traffic creates: expired widget sessions, install
    // codes and rate-limit windows. Both indexes on expiry back these batches.
    sql`DELETE FROM quills.kv_store WHERE (workspace_id,workspace_key,key) IN (SELECT workspace_id,workspace_key,key FROM quills.kv_store WHERE expires_at<=now() LIMIT 1000)`,
    // The page-view beacon (reporting/track.ts) keeps one row per visitor IP: a larger batch.
    sql`DELETE FROM quills.rate_bucket WHERE (workspace_id,workspace_key,key) IN (SELECT workspace_id,workspace_key,key FROM quills.rate_bucket WHERE window_expires_at<=now() LIMIT 10000)`,
    sql`DELETE FROM quills.kb_search_queries WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.kb_search_queries WHERE created_at<now()-${policy.logs}*interval '1 day' ORDER BY created_at LIMIT 1000)`,
    // A token stops working when it expires or is used; least() skips a NULL used_at.
    sql`DELETE FROM quills.unsubscribe_tokens WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.unsubscribe_tokens WHERE least(expires_at,used_at)<now()-interval '30 days' ORDER BY least(expires_at,used_at) LIMIT 1000)`,
    // Attempts and their results go; the operation row stays, as its operation_key stops a second
    // external create, and keeps the remote link the sync history shows.
    sql`DELETE FROM quills.integration_sync_attempts WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.integration_sync_attempts WHERE finished_at<now()-${policy.logs}*interval '1 day' ORDER BY finished_at LIMIT 1000)`,
    // The translation cache (RFC 0003): an edit leaves the old row behind, and a request translates again.
    sql`DELETE FROM quills.content_translations WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.content_translations WHERE created_at<now()-${policy.logs}*interval '1 day' ORDER BY created_at LIMIT 1000)`,
    // Expired, canceled and pending-but-expired invites. An accepted invite grants portal access.
    sql`DELETE FROM quills.portal_invites WHERE (workspace_id,id) IN (SELECT workspace_id,id FROM quills.portal_invites WHERE status<>'accepted' AND expires_at<now()-${policy.logs}*interval '1 day' LIMIT 1000)`,
  ];
  let removed = 0;
  for (const statement of statements)
    removed += (await tx.execute(statement)).rowCount ?? 0;
  return removed + (await pruneAnonymousVisitors(tx));
}

export async function runQuillsRetention() {
  const policy = retentionSchema.parse({
    events: process.env.QUILLS_EVENT_RETENTION_DAYS,
    jobs: process.env.QUILLS_JOB_RETENTION_DAYS,
    logs: process.env.QUILLS_LOG_RETENTION_DAYS,
  });
  let cursor = "";
  let degraded = false;
  for (;;) {
    const page = await db.execute<{ id: string }>(
      sql`SELECT id FROM public.workspace WHERE id>${cursor} ORDER BY id LIMIT 100`,
    );
    if (!page.rows.length) break;
    for (const row of page.rows) {
      try {
        await withQuillsSystemWorkspace(
          row.id,
          (tx) => pruneQuillsWorkspace(tx, policy),
          { allowArchived: true },
        );
      } catch {
        degraded = true;
      }
      try {
        // The hourly visitor rollup; visitor analytics reads only its tables.
        await withQuillsSystemWorkspace(row.id, refreshVisitorAnalytics, {
          allowArchived: true,
        });
      } catch {
        degraded = true;
      }
      cursor = row.id;
    }
  }
  return { degraded };
}
