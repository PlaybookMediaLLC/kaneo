import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
} from "drizzle-orm";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import { changelogEntries } from "../../../database/quills/schema/changelog";
import { conversations } from "../../../database/quills/schema/conversation";
import { events } from "../../../database/quills/schema/events";
import { statusIncidents } from "../../../database/quills/schema/status";
import {
  completeMaintenanceWindow,
  startMaintenanceWindow,
} from "../../content/status/maintenance";
import { recordQuillsChange } from "../../events";
import { setStatus } from "../../support/conversation-ops";
import { queueWeeklyDigests } from "./digest";

// Timed work that the earlier slices store but nothing ran. quills.runnable_workspaces (migration
// 0013) lists a workspace when one of these is due; its predicates match the queries below.
// Each sweep is one system transaction in one unarchived workspace, handles at most BATCH rows,
// and changes each row's state so a repeat finds nothing. Changes are recorded with no actor.

const BATCH = 50;

/** Opens snoozed conversations whose wake time has passed, through the status route's domain code. */
async function wakeSnoozedConversations(db: Database) {
  const due = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "snoozed"),
        isNotNull(conversations.snoozedUntil),
        lte(conversations.snoozedUntil, sql`now()`),
      ),
    )
    .orderBy(asc(conversations.snoozedUntil))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  for (const conversation of due) {
    await setStatus(db, conversation, "open");
    await recordQuillsChange(db, null, {
      type: "conversation.status_changed",
      entityType: "conversation",
      entityId: conversation.id,
      payload: { status: "open" },
    });
  }
}

/**
 * Records `changelog.published` once for each entry whose publish time passed in the last day,
 * and stamps `notifiedAt`. An entry published at once already has its event from the route,
 * so it is only stamped. ponytail: a schedule missed by more than a day (an outage) is not
 * announced; the day bound keeps old entries from before this sweep from being announced again.
 */
async function announceScheduledChangelog(db: Database) {
  const due = await db
    .select({ id: changelogEntries.id })
    .from(changelogEntries)
    .where(
      and(
        isNull(changelogEntries.notifiedAt),
        isNull(changelogEntries.deletedAt),
        lte(changelogEntries.publishedAt, sql`now()`),
        gt(changelogEntries.publishedAt, sql`now() - interval '1 day'`),
      ),
    )
    .orderBy(asc(changelogEntries.publishedAt))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  if (!due.length) return;
  const ids = due.map((entry) => entry.id);
  const announced = new Set(
    (
      await db
        .select({ id: events.entityId })
        .from(events)
        .where(
          and(
            eq(events.entityType, "changelog"),
            inArray(events.entityId, ids),
            eq(events.type, "changelog.published"),
          ),
        )
    ).map((row) => row.id),
  );
  for (const id of ids)
    if (!announced.has(id))
      // Scheduled entries store no notify choice, so subscribers hear about them.
      await recordQuillsChange(db, null, {
        type: "changelog.published",
        entityType: "changelog",
        entityId: id,
        payload: { notify: "true" },
      });
  await db
    .update(changelogEntries)
    .set({ notifiedAt: sql`now()` })
    .where(inArray(changelogEntries.id, ids));
}

/**
 * Starts scheduled maintenance windows with auto-start at their planned start and completes
 * windows with auto-complete at their planned end. A window whose end also passed is completed
 * without a start, so its components do not change twice. ponytail: a start missed by more than
 * a day (an outage, or windows planned before this sweep existed) is left for a teammate.
 */
async function runMaintenanceWindows(db: Database) {
  const ended = sql`coalesce(${statusIncidents.autoComplete} and ${statusIncidents.scheduledEndAt} <= now(), false)`;
  const live = and(
    eq(statusIncidents.kind, "maintenance"),
    isNull(statusIncidents.deletedAt),
  );
  const starts = await db
    .select({ id: statusIncidents.id })
    .from(statusIncidents)
    .where(
      and(
        live,
        eq(statusIncidents.status, "scheduled"),
        eq(statusIncidents.autoStart, true),
        lte(statusIncidents.scheduledStartAt, sql`now()`),
        gt(statusIncidents.scheduledStartAt, sql`now() - interval '1 day'`),
        sql`not ${ended}`,
      ),
    )
    .limit(BATCH)
    // The lock re-checks the row, so an edit that turned auto-start off or moved the window wins.
    .for("update", { skipLocked: true });
  for (const { id } of starts)
    if (await startMaintenanceWindow(db, id, null))
      await recordQuillsChange(db, null, {
        type: "status.maintenance_started",
        entityType: "status_incident",
        entityId: id,
      });
  const ends = await db
    .select({ id: statusIncidents.id })
    .from(statusIncidents)
    .where(
      and(
        live,
        inArray(statusIncidents.status, [
          "scheduled",
          "in_progress",
          "verifying",
        ]),
        sql`${ended}`,
      ),
    )
    .limit(BATCH)
    .for("update", { skipLocked: true });
  for (const { id } of ends) {
    const previous = await completeMaintenanceWindow(db, id);
    if (previous)
      await recordQuillsChange(db, null, {
        type: "status.incident_resolved",
        entityType: "status_incident",
        entityId: id,
        payload: {
          kind: "maintenance",
          status: "completed",
          previousStatus: previous,
        },
      });
  }
}

const SWEEPS = [
  wakeSnoozedConversations,
  announceScheduledChangelog,
  runMaintenanceWindows,
  // RFC 0003: the weekly digest. quills.runnable_workspaces lists a workspace until its digest
  // of the last week is done (migration 0027).
  (db: Database) => queueWeeklyDigests(db),
];

/**
 * Runs every sweep for one workspace in one transaction. When that fails, each sweep runs again
 * in its own transaction, so one failing sweep does not block the others.
 */
export async function runQuillsSweeps(workspaceId: string) {
  try {
    await withQuillsSystemWorkspace(workspaceId, async (db) => {
      for (const sweep of SWEEPS) await sweep(db);
    });
    return { degraded: false };
  } catch {
    let degraded = false;
    for (const sweep of SWEEPS)
      try {
        await withQuillsSystemWorkspace(workspaceId, sweep);
      } catch {
        degraded = true;
      }
    return { degraded };
  }
}
