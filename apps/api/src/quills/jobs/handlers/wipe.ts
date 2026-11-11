import { is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import * as schema from "../../../database/quills/schema";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { recordQuillsChange } from "../../events";
import { loadEvent } from "../fanout";
import { eventPayloadSchema, finishQuillsJob } from "../queue";

/**
 * Tables a wipe keeps: settings and the seeded catalogues (as a new workspace has them), the outbox,
 * job queue and delivery ledger, append-only audit history, and custom domains.
 */
const KEPT = new Set([
  "settings",
  "roles",
  "permissions",
  "role_permissions",
  "principal_role_assignments",
  "post_statuses",
  "ticket_statuses",
  "events",
  "job_queue",
  "hook_deliveries",
  "audit_log",
  "custom_domains",
  // Deleting the teams removes their rosters. The roster guard refuses a direct delete for a Kaneo-bound team.
  "team_members",
]);
export const WIPED_TABLES = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableConfig(table).name)
  .filter((name) => !KEPT.has(name));

/**
 * Deletes the workspace's Quills feature data in the caller's transaction. Teammate actors stay;
 * customer, visitor and service actors go. Storage triggers queue the removed object keys for cleanup.
 */
export async function wipeQuillsData(db: Database, workspaceId: string) {
  // Referencing tables go first, so no foreign-key action runs between wiped tables.
  const { rows: edges } = await db.execute<{ child: string; parent: string }>(
    sql`SELECT DISTINCT c.relname AS child, p.relname AS parent FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
      WHERE k.contype = 'f' AND k.conrelid <> k.confrelid
      AND c.relnamespace = 'quills'::regnamespace AND p.relnamespace = 'quills'::regnamespace`,
  );
  let left = WIPED_TABLES;
  while (left.length) {
    const ready = left.filter(
      (table) =>
        !edges.some(
          (edge) => edge.parent === table && left.includes(edge.child),
        ),
    );
    if (!ready.length)
      throw new Error("Quills tables reference each other in a cycle");
    for (const table of ready)
      await db.execute(
        sql`DELETE FROM ${sql.identifier("quills")}.${sql.identifier(table)} WHERE workspace_id = ${workspaceId}${
          table === "principal" ? sql` AND kaneo_user_id IS NULL` : sql``
        }`,
      );
    left = left.filter((table) => !ready.includes(table));
  }
}

/**
 * Runs a requested wipe. The deletes, the completion event and the job's outcome share one
 * transaction: a failure, or a lease that another worker took, rolls everything back, and the
 * retry starts again.
 */
export async function runWipeJob(workspaceId: string, job: JobQueueRow) {
  const { eventId } = eventPayloadSchema.parse(job.payload);
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const event = await loadEvent(db, eventId);
    // Only a recorded request for this workspace starts a wipe.
    if (
      event?.type === "workspace.wipe_requested" &&
      event.entityId === workspaceId
    ) {
      // ponytail: one unbounded transaction per wipe, run inline in the shared drain loop. A large
      // workspace holds its row locks and stalls this instance's Quills jobs until it ends, and
      // another worker can claim it after the five-minute lease. Batch it, or index the foreign keys
      // to `principal`, when a workspace outgrows that.
      await wipeQuillsData(db, workspaceId);
      await recordQuillsChange(db, null, {
        type: "workspace.wiped",
        entityType: "workspace",
        entityId: workspaceId,
        payload: { requestEventId: eventId },
      });
    }
    await finishQuillsJob(db, job.id, job.leaseToken!);
  });
}
