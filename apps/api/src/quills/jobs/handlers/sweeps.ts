import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import { assistantInvolvements } from "../../../database/quills/schema/assistant";
import { assistantWebSources } from "../../../database/quills/schema/assistant-web-sources";
import { changelogEntries } from "../../../database/quills/schema/changelog";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { events } from "../../../database/quills/schema/events";
import {
  inAppNotifications,
  notificationPreferences,
} from "../../../database/quills/schema/notifications";
import { statusIncidents } from "../../../database/quills/schema/status";
import {
  completeMaintenanceWindow,
  startMaintenanceWindow,
} from "../../content/status/maintenance";
import { recordQuillsChange } from "../../events";
import { requireClosable, setStatus } from "../../support/conversation-ops";
import { readReopenPolicy } from "../../support/support-settings";
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
 * Gap G-31, auto-resolve after silence: the customer agent answered and the customer stayed quiet
 * for a day, so the conversation is resolved as assumed. When the customer wrote last (the agent
 * never answered it), the agent steps back and the team keeps the open conversation. A
 * conversation that a teammate took or that closed meanwhile only ends the involvement.
 */
async function resolveQuietAgentConversations(db: Database) {
  const due = await db
    .select({
      id: assistantInvolvements.id,
      conversationId: assistantInvolvements.conversationId,
    })
    .from(assistantInvolvements)
    .where(
      and(
        eq(assistantInvolvements.status, "active"),
        lte(
          assistantInvolvements.lastAssistantAnswerAt,
          sql`now() - interval '24 hours'`,
        ),
      ),
    )
    .orderBy(asc(assistantInvolvements.lastAssistantAnswerAt))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  for (const involvement of due) {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, involvement.conversationId))
      .for("update");
    const [last] = await db
      .select({ senderType: conversationMessages.senderType })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, involvement.conversationId),
          eq(conversationMessages.isInternal, false),
          isNull(conversationMessages.deletedAt),
        ),
      )
      .orderBy(
        sql`${conversationMessages.createdAt} desc`,
        sql`${conversationMessages.id} desc`,
      )
      .limit(1);
    // Required attributes still gate a close: an automatic close never skips them.
    const closable =
      !!conversation &&
      (await requireClosable(db, conversation).then(
        () => true,
        () => false,
      ));
    const resolve =
      closable &&
      conversation?.status === "open" &&
      !conversation.assignedAgentPrincipalId &&
      last?.senderType !== "visitor";
    await db
      .update(assistantInvolvements)
      .set({
        status: resolve ? "resolved_assumed" : "abandoned",
        endedAt: sql`now()`,
      })
      .where(eq(assistantInvolvements.id, involvement.id));
    if (!resolve || !conversation) continue;
    await setStatus(db, conversation, "closed");
    await recordQuillsChange(db, null, {
      type: "conversation.status_changed",
      entityType: "conversation",
      entityId: conversation.id,
      payload: { status: "closed", reason: "assistant_assumed_resolution" },
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
    .select({ id: changelogEntries.id, title: changelogEntries.title })
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
  const titleById = new Map(due.map((entry) => [entry.id, entry.title]));
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
  const newlyPublished: (typeof due)[number]["id"][] = [];
  for (const id of ids) {
    if (!announced.has(id)) {
      newlyPublished.push(id);
      // Scheduled entries store no notify choice, so subscribers hear about them.
      await recordQuillsChange(db, null, {
        type: "changelog.published",
        entityType: "changelog",
        entityId: id,
        payload: { notify: "true" },
      });
    }
  }
  if (newlyPublished.length) {
    const [{ changelogEntryPosts }, { flagLinkedArticlesOnChangelogPublish }] =
      await Promise.all([
        import("../../../database/quills/schema/changelog"),
        import("../../content/help-center/freshness"),
      ]);
    const linkedRows = await db
      .select({
        entryId: changelogEntryPosts.changelogEntryId,
        postId: changelogEntryPosts.postId,
      })
      .from(changelogEntryPosts)
      .where(
        inArray(
          changelogEntryPosts.changelogEntryId,
          newlyPublished as never[],
        ),
      );
    const postsByEntry = new Map<string, string[]>();
    for (const r of linkedRows) {
      const list = postsByEntry.get(r.entryId) ?? [];
      list.push(r.postId);
      postsByEntry.set(r.entryId, list);
    }
    for (const id of newlyPublished) {
      await flagLinkedArticlesOnChangelogPublish(
        db,
        id,
        titleById.get(id) ?? "Changelog update",
        postsByEntry.get(id) ?? [],
      );
    }
  }
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

/**
 * Fetches web sources again once a week (migration 0043 lists the workspace): an enabled source
 * whose last successful fetch is 7 days old and that nothing touched for a day. Moving
 * updated_at keeps a source that keeps failing to one attempt a day.
 */
async function refreshStaleWebSources(db: Database) {
  const due = await db
    .select({ id: assistantWebSources.id })
    .from(assistantWebSources)
    .where(
      and(
        eq(assistantWebSources.enabled, true),
        lte(assistantWebSources.fetchedAt, sql`now() - interval '7 days'`),
        lte(assistantWebSources.updatedAt, sql`now() - interval '1 day'`),
      ),
    )
    .orderBy(asc(assistantWebSources.fetchedAt))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  for (const source of due) {
    await db
      .update(assistantWebSources)
      .set({ updatedAt: new Date() })
      .where(eq(assistantWebSources.id, source.id));
    await recordQuillsChange(db, null, {
      type: "assistant_web_source.updated",
      entityType: "assistant_web_source",
      entityId: source.id,
      payload: { refresh: "true" },
    });
  }
}

/** Marks overdue proposed assistant actions as expired (15-minute TTL, #300). */
async function expirePendingAssistantActions(db: Database) {
  await db.execute(sql`
    UPDATE quills.assistant_pending_actions
    SET status = 'expired', approval_token_hash = NULL
    WHERE (workspace_id, id) IN (
      SELECT workspace_id, id
      FROM quills.assistant_pending_actions
      WHERE status = 'proposed' AND expires_at <= now()
      ORDER BY expires_at
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    )
  `);
}

/** Flags KB articles that passed review_by or crossed >=40% unhelpful rate with >=5 post-review votes (#314). */
export async function flagOverdueAndUnhelpfulArticles(db: Database) {
  const { helpCenterArticles } =
    await import("../../../database/quills/schema/kb");
  const now = new Date();
  await db
    .update(helpCenterArticles)
    .set({
      staleReason: "review_overdue",
      staleDetails: "Scheduled review date passed",
      staleFlaggedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        isNull(helpCenterArticles.deletedAt),
        isNull(helpCenterArticles.staleFlaggedAt),
        isNotNull(helpCenterArticles.reviewBy),
        lte(helpCenterArticles.reviewBy, sql`now()`),
      ),
    );
  // If an article was already reviewed, only votes cast AFTER last_reviewed_at count toward
  // unhelpful_spike so marking an article reviewed does not immediately re-flag it on the next sweep.
  await db.execute(sql`
    UPDATE quills.kb_articles a
    SET
      stale_reason = 'unhelpful_spike',
      stale_details = 'Unhelpful feedback ratio reached 40% or higher',
      stale_flagged_at = ${now},
      updated_at = ${now}
    WHERE a.deleted_at IS NULL
      AND a.stale_flagged_at IS NULL
      AND (
        (
          a.last_reviewed_at IS NULL
          AND (a.helpful_count + a.not_helpful_count) >= 5
          AND (a.not_helpful_count * 10) >= ((a.helpful_count + a.not_helpful_count) * 4)
        )
        OR EXISTS (
          SELECT 1
          FROM quills.kb_article_feedback f
          WHERE f.article_id = a.id
            AND a.last_reviewed_at IS NOT NULL
            AND f.created_at > a.last_reviewed_at
          GROUP BY f.article_id
          HAVING count(*) >= 5
            AND (count(*) FILTER (WHERE f.helpful = false) * 10) >= (count(*) * 4)
        )
      )
  `);
}

/**
 * Sends one proactive apology update when an open waiting conversation passes its
 * promised reply deadline (#333). Stamps `breach_update_sent_at` atomically so it
 * never fires twice.
 */
export async function notifyPromisedReplyBreaches(db: Database) {
  const due = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "open"),
        isNotNull(conversations.waitingSince),
        isNotNull(conversations.promisedReplyAt),
        isNull(conversations.breachUpdateSentAt),
        lte(conversations.promisedReplyAt, sql`now()`),
      ),
    )
    .orderBy(asc(conversations.promisedReplyAt))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  for (const conversation of due) {
    const now = new Date();
    await db
      .update(conversations)
      .set({ breachUpdateSentAt: now, updatedAt: now })
      .where(eq(conversations.id, conversation.id));
    await db.insert(conversationMessages).values({
      conversationId: conversation.id,
      senderType: "system",
      isInternal: false,
      content:
        "We're busier than expected right now — we haven't forgotten your request and will reply as soon as we can.",
      metadata: { systemKind: "promised_reply_breach_update" },
    });
    await recordQuillsChange(db, null, {
      type: "conversation.breach_update_sent",
      entityType: "conversation",
      entityId: conversation.id,
      payload: {},
    });
  }
}

/**
 * Quiet auto-close lifecycle for solution-offered conversations (#311):
 * 1. Sends at most ONE polite reminder when `auto_close_at` is within 24h and
 *    `close_reminder_sent_at` is NULL.
 * 2. Quietly closes the conversation once `auto_close_at <= now()`.
 */
export async function processSolutionConfirmations(db: Database) {
  const policy = await readReopenPolicy(db);
  const reminderCutoff = new Date(
    Date.now() + policy.reminderBeforeCloseHours * 3_600_000,
  );
  // 1. Send single polite reminder before auto-close
  const remindersDue = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "open"),
        isNotNull(conversations.solutionOfferedAt),
        isNull(conversations.closeReminderSentAt),
        isNotNull(conversations.autoCloseAt),
        gt(conversations.autoCloseAt, sql`now()`),
        lte(conversations.autoCloseAt, reminderCutoff),
      ),
    )
    .orderBy(asc(conversations.autoCloseAt))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  for (const conversation of remindersDue) {
    const now = new Date();
    await db
      .update(conversations)
      .set({ closeReminderSentAt: now, updatedAt: now })
      .where(eq(conversations.id, conversation.id));
    await db.insert(conversationMessages).values({
      conversationId: conversation.id,
      senderType: "system",
      isInternal: false,
      content:
        "Just checking in — if everything is sorted, we'll close this thread quietly soon. Simply reply any time if you still need help.",
      metadata: { systemKind: "solution_close_reminder" },
    });
  }

  // 2. Quietly close due conversations (respecting required-to-close attributes)
  const closesDue = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.status, "open"),
        isNotNull(conversations.solutionOfferedAt),
        isNotNull(conversations.autoCloseAt),
        lte(conversations.autoCloseAt, sql`now()`),
      ),
    )
    .orderBy(asc(conversations.autoCloseAt))
    .limit(BATCH)
    .for("update", { skipLocked: true });
  for (const conversation of closesDue) {
    const now = new Date();
    let closable = true;
    try {
      await requireClosable(db, conversation);
    } catch {
      closable = false;
    }
    if (!closable) {
      await db
        .update(conversations)
        .set({ autoCloseAt: null, updatedAt: now })
        .where(eq(conversations.id, conversation.id));
      continue;
    }
    await db
      .update(conversations)
      .set({
        status: "closed",
        endReason: "resolved",
        resolvedAt: now,
        autoCloseAt: null,
        waitingSince: null,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));
    await recordQuillsChange(db, null, {
      type: "conversation.status_changed",
      entityType: "conversation",
      entityId: conversation.id,
      payload: { status: "closed", autoClosed: "true" },
    });
  }
}

/**
 * Teammate hourly / daily notification digests (#321).
 * Locks due `notification_preferences` rows under FOR UPDATE SKIP LOCKED,
 * stamps `digest_last_sent_at` atomically so concurrent sweeps never double-send,
 * and records a summary digest entry when unread notifications exist.
 */
export async function sendTeammateDigests(db: Database) {
  const due = await db
    .select()
    .from(notificationPreferences)
    .where(
      or(
        and(
          eq(notificationPreferences.digestFrequency, "hourly"),
          or(
            isNull(notificationPreferences.digestLastSentAt),
            lte(
              notificationPreferences.digestLastSentAt,
              sql`now() - interval '1 hour'`,
            ),
          ),
        ),
        and(
          eq(notificationPreferences.digestFrequency, "daily"),
          or(
            isNull(notificationPreferences.digestLastSentAt),
            lte(
              notificationPreferences.digestLastSentAt,
              sql`now() - interval '24 hours'`,
            ),
          ),
        ),
      ),
    )
    .orderBy(sql`${notificationPreferences.digestLastSentAt} ASC NULLS FIRST`)
    .limit(BATCH)
    .for("update", { skipLocked: true });

  const now = new Date();
  for (const pref of due) {
    const since =
      pref.digestLastSentAt ??
      new Date(
        now.getTime() -
          (pref.digestFrequency === "hourly" ? 3600_000 : 86_400_000),
      );
    await db
      .update(notificationPreferences)
      .set({ digestLastSentAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(notificationPreferences.id, pref.id));

    if (pref.emailMuted) continue;
    const unread = await db
      .select({
        title: inAppNotifications.title,
        type: inAppNotifications.type,
      })
      .from(inAppNotifications)
      .where(
        and(
          eq(inAppNotifications.principalId, pref.principalId),
          isNull(inAppNotifications.readAt),
          isNull(inAppNotifications.archivedAt),
          gt(inAppNotifications.createdAt, since),
        ),
      )
      .limit(25);
    if (unread.length === 0) continue;

    await recordQuillsChange(db, null, {
      type: "notification.digest_sent",
      entityType: "notification",
      entityId: pref.principalId,
      payload: {
        frequency: pref.digestFrequency,
        count: String(unread.length),
      },
    });
  }
}

const SWEEPS = [
  wakeSnoozedConversations,
  notifyPromisedReplyBreaches,
  processSolutionConfirmations,
  sendTeammateDigests,
  resolveQuietAgentConversations,
  expirePendingAssistantActions,
  flagOverdueAndUnhelpfulArticles,
  refreshStaleWebSources,
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
