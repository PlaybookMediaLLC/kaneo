import { and, eq, isNull, sql } from "drizzle-orm";
import { ZodError } from "zod";
import db from "../../database";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { events } from "../../database/quills/schema/events";
import type { JobQueueRow } from "../../database/quills/schema/job-queue";
import {
  workspaceRoleTable,
  workspaceUserTable,
  userTable,
} from "../../database/schema";
import { rolesAllow } from "../../utils/role-permissions";
import { splitRoles } from "../../utils/split-roles";
import { broadcastToUserAndWait } from "../../ws";
import { subscribeToEvent } from "../../events";
import { fanOut } from "./fanout";
import { deliverCustomerChange } from "./handlers/customer-stream";
import { fanOutIntegrations, runIntegrationJob } from "./handlers/integration";
import { runAiJob } from "./handlers/ai";
import { runDomainCheckJob } from "./handlers/domain-check";
import { runGitHubCommentJob } from "./handlers/github-comment";
import { runDigestJob } from "./handlers/digest";
import { runMailJob } from "./handlers/mail";
import { runNotificationJob } from "./handlers/notification";
import { runWebhookJob } from "./handlers/webhook";
import { runTransferJob } from "./handlers/transfer";
import { runQuillsSweeps } from "./handlers/sweeps";
import { runWipeJob } from "./handlers/wipe";
import { runWorkflowJob } from "./handlers/workflow";
import { runScheduledSendJob } from "./handlers/scheduled-send";
import { runCrmNoteJob } from "../integrations/crm-notes";
import {
  handOffTaskStatus,
  runTaskSyncJob,
} from "../integrations/task-sync-job";
import { runTaskRuleJob } from "../integrations/task-rule-job";
import { runUpdateMailPage } from "./handlers/update-mail";
import {
  claimFrom,
  enqueueQuillsEvent,
  finishQuillsJob,
  eventPayloadSchema,
  QUILLS_QUEUES,
  type QuillsQueue,
} from "./queue";
import { registerQuillsWaker } from "./wake-hook";

/** Delivery handlers. Each validates its payload and finishes its own job. */
const handlers: Record<
  Exclude<QuillsQueue, "quills.event">,
  (workspaceId: string, job: JobQueueRow) => Promise<unknown>
> = {
  // Integration deliveries and GitHub inbox comments share this queue until a quills.integration queue
  // is runnable (integrations/ROUTES.md). A webhook job names its webhook; a CRM note job names `crm`.
  "quills.webhook": (workspaceId, job) =>
    "operationId" in (job.payload as object)
      ? runIntegrationJob(workspaceId, job)
      : "webhookId" in (job.payload as object)
        ? runWebhookJob(workspaceId, job)
        : "crm" in (job.payload as object)
          ? runCrmNoteJob(workspaceId, job)
          : runGitHubCommentJob(workspaceId, job),
  // The weekly digest (handlers/digest.ts) and an update's mail pages (handlers/update-mail.ts) share
  // the mail queue; a digest job names a week, a page job its update event.
  "quills.mail": (workspaceId, job) =>
    "digest" in (job.payload as object)
      ? runDigestJob(workspaceId, job)
      : "updateMail" in (job.payload as object)
        ? runUpdateMailPage(workspaceId, job)
        : runMailJob(workspaceId, job),
  "quills.notification": runNotificationJob,
  "quills.domain_check": runDomainCheckJob,
  "quills.wipe": runWipeJob,
  "quills.transfer": runTransferJob,
  // A task-sync job (RFC 0003, D12) names its Kaneo task; a board task rule job (RFC 0005) names its rule;
  // a scheduled/undo-send reply (#323) names `scheduledMessageId`.
  "quills.workflow": (workspaceId, job) =>
    "scheduledMessageId" in (job.payload as object)
      ? runScheduledSendJob(workspaceId, job)
      : "taskId" in (job.payload as object)
        ? runTaskSyncJob(workspaceId, job)
        : "rule" in (job.payload as object)
          ? runTaskRuleJob(workspaceId, job)
          : runWorkflowJob(workspaceId, job),
  "quills.ai": runAiJob,
};

// Task sync (RFC 0003, D12): the Kaneo paths that change a task's status publish this event after
// their commit (task controllers, bulk updates and the GitHub, GitLab and Gitea webhooks).
void subscribeToEvent("task.status_changed", handOffTaskStatus);
// A move to another project can put the task in a done column without a status change event.
void subscribeToEvent("task.moved", handOffTaskStatus);

export type QuillsChangeMeta = {
  entityType?: string;
  eventType?: string;
};

export async function deliverQuillsChange(
  workspaceId: string,
  eventId: string,
  meta?: QuillsChangeMeta,
) {
  const [members, storedRoles] = await Promise.all([
    db
      .select({
        userId: workspaceUserTable.userId,
        role: workspaceUserTable.role,
      })
      .from(workspaceUserTable)
      .innerJoin(userTable, eq(userTable.id, workspaceUserTable.userId))
      .where(
        and(
          eq(workspaceUserTable.workspaceId, workspaceId),
          sql`coalesce(${userTable.banned},false)=false`,
        ),
      ),
    db
      .select({
        role: workspaceRoleTable.role,
        permission: workspaceRoleTable.permission,
      })
      .from(workspaceRoleTable)
      .where(eq(workspaceRoleTable.workspaceId, workspaceId)),
  ]);
  const recipients = members
    .filter((member) =>
      rolesAllow(splitRoles(member.role), storedRoles, {
        workspace: ["read"],
        quills: ["read"],
      }),
    )
    .map((member) => member.userId);
  // Fan out concurrently in bounded batches instead of serializing Redis RTTs per member.
  const BATCH = 20;
  for (let i = 0; i < recipients.length; i += BATCH) {
    await Promise.all(
      recipients.slice(i, i + BATCH).map((userId) =>
        // Only invalidate caches: no feature data or credentials cross this channel.
        broadcastToUserAndWait(userId, {
          type: "QUILLS_CHANGED",
          workspaceId,
          eventId,
          ...(meta?.entityType ? { entityType: meta.entityType } : {}),
          ...(meta?.eventType ? { eventType: meta.eventType } : {}),
        }),
      ),
    );
  }
  // The portal customer who owns the conversation or ticket, on the same socket kind.
  await deliverCustomerChange(workspaceId, eventId);
}
export async function drainQuillsWorkspace(
  workspaceId: string,
  deliver = deliverQuillsChange,
  queues: readonly QuillsQueue[] = QUILLS_QUEUES,
) {
  if (queues.includes("quills.event")) {
    await withQuillsSystemWorkspace(workspaceId, async (tx) => {
      const pending = await tx
        .select({ eventId: events.eventId })
        .from(events)
        .where(
          and(
            isNull(events.publishedAt),
            sql`NOT EXISTS (SELECT 1 FROM quills.job_queue j WHERE j.queue='quills.event' AND j.dedupe_key=${events.eventId})`,
          ),
        )
        .orderBy(events.id)
        .limit(100);
      for (const event of pending) await enqueueQuillsEvent(tx, event.eventId);
    });
  }
  let processed = 0,
    failed = 0,
    needsReap = true;
  const deadline = Date.now() + 10000;
  // ponytail: up to 50 jobs per pass inside the 10-second budget; fan-out of large audiences drains over several passes.
  for (let i = 0; i < 50 && Date.now() < deadline; i++) {
    const job = await withQuillsSystemWorkspace(
      workspaceId,
      claimFrom(queues, { reapExpired: needsReap }),
    );
    needsReap = false;
    if (!job) break;
    try {
      if (job.queue !== "quills.event") {
        await handlers[job.queue as keyof typeof handlers](workspaceId, job);
        processed++;
        continue;
      }
      const payload = eventPayloadSchema.parse(job.payload);
      const event = await withQuillsSystemWorkspace(
        workspaceId,
        async (tx) =>
          (
            await tx
              .select({
                id: events.id,
                publishedAt: events.publishedAt,
                type: events.type,
                entityType: events.entityType,
              })
              .from(events)
              .where(eq(events.eventId, payload.eventId))
          )[0],
      );
      if (!event) throw new Error("Outbox event missing");
      if (!event.publishedAt) {
        // Before the broadcast, so a websocket or Redis outage cannot lose deliveries.
        // Enqueue is deduplicated, so a rerun after a failure below adds no second delivery.
        await fanOut(workspaceId, payload.eventId);
        await fanOutIntegrations(workspaceId, payload.eventId);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            deliver(workspaceId, payload.eventId, {
              entityType: event.entityType,
              eventType: event.type,
            }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(
                () => reject(new Error("Broadcast timeout")),
                30000,
              );
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      await withQuillsSystemWorkspace(workspaceId, async (tx) => {
        await finishQuillsJob(tx, job.id, job.leaseToken!);
        await tx
          .update(events)
          .set({ publishedAt: new Date() })
          .where(eq(events.id, event.id));
      });
      processed++;
    } catch (error) {
      failed++;
      needsReap = true;
      try {
        // A payload that fails validation never passes on a retry.
        await withQuillsSystemWorkspace(workspaceId, (tx) =>
          finishQuillsJob(
            tx,
            job.id,
            job.leaseToken!,
            error instanceof ZodError
              ? "Invalid job payload"
              : job.queue === "quills.event"
                ? "Quills event delivery failed"
                : `${job.queue} failed`,
            error instanceof ZodError,
          ),
        );
      } catch {
        /* A replacement worker owns an expired lease. */
      }
    }
  }
  return { processed, failed, degraded: failed > 0 };
}
/** Delivery queues: excludes long-running AI provider calls and full-workspace wipes so neither stalls live events. */
const DELIVERY = QUILLS_QUEUES.filter(
  (queue) => queue !== "quills.ai" && queue !== "quills.wipe",
);
const FAST_WAKE_QUEUES: readonly QuillsQueue[] = [
  "quills.event",
  "quills.workflow",
];
const MAX_CONCURRENT_WAKES = 4;
const MAX_DELAYED_WAKE_MS = 35_000;
let autoWakeEnabled = false;
const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>();
const delayedWakeTimers = new Set<ReturnType<typeof setTimeout>>();
const inFlightWakes = new Set<string>();
const rewakePending = new Set<string>();
const backgroundDrains = new Map<
  "quills.ai" | "quills.wipe",
  { running: boolean; pending: Set<string> }
>();

/** Enables post-commit in-process event wakes when the API scheduler is running. */
export function enableQuillsAutoWake(): void {
  autoWakeEnabled = true;
  registerQuillsWaker(scheduleQuillsWake);
}

/** Disables post-commit wakes and cancels pending timers during graceful shutdown. */
export function disableQuillsAutoWake(): void {
  autoWakeEnabled = false;
  registerQuillsWaker(null);
  for (const timer of wakeTimers.values()) clearTimeout(timer);
  wakeTimers.clear();
  for (const timer of delayedWakeTimers) clearTimeout(timer);
  delayedWakeTimers.clear();
  rewakePending.clear();
}

function startWakeDrain(workspaceId: string): void {
  if (!autoWakeEnabled) return;
  if (
    inFlightWakes.has(workspaceId) ||
    inFlightWakes.size >= MAX_CONCURRENT_WAKES
  ) {
    rewakePending.add(workspaceId);
    return;
  }
  inFlightWakes.add(workspaceId);
  void drainQuillsWorkspace(workspaceId, deliverQuillsChange, FAST_WAKE_QUEUES)
    .catch(() => {})
    .finally(() => {
      inFlightWakes.delete(workspaceId);
      if (!autoWakeEnabled) return;
      if (rewakePending.delete(workspaceId)) {
        scheduleQuillsWake(workspaceId);
      } else if (rewakePending.size > 0) {
        const next = rewakePending.values().next().value;
        if (next) {
          rewakePending.delete(next);
          startWakeDrain(next);
        }
      }
    });
}

/**
 * Schedules a fast debounced drain of `quills.event` / `quills.workflow` after a mutation commits,
 * cutting realtime latency from up to 10s down to ~50ms while bounding in-flight concurrency.
 * An optional `delayMs` (up to 35s) schedules an additional wake right when a short undo-send window ends.
 */
function scheduleQuillsWake(workspaceId: string, delayMs?: number): void {
  if (!autoWakeEnabled || !workspaceId) return;
  if (delayMs && delayMs > 50 && delayMs <= MAX_DELAYED_WAKE_MS) {
    const delayed = setTimeout(() => {
      delayedWakeTimers.delete(delayed);
      startWakeDrain(workspaceId);
    }, delayMs + 100);
    delayed.unref?.();
    delayedWakeTimers.add(delayed);
    return;
  }
  if (inFlightWakes.has(workspaceId)) {
    rewakePending.add(workspaceId);
    return;
  }
  if (wakeTimers.has(workspaceId)) return;
  const timer = setTimeout(() => {
    wakeTimers.delete(workspaceId);
    startWakeDrain(workspaceId);
  }, 50);
  timer.unref?.();
  wakeTimers.set(workspaceId, timer);
}

/**
 * Drains a long-running background queue (`quills.ai` or `quills.wipe`) across runnable
 * workspaces, accumulating newly discovered workspaces while busy so later pages never starve.
 */
function drainBackgroundQueue(
  queue: "quills.ai" | "quills.wipe",
  workspaceIds: readonly string[],
) {
  if (!workspaceIds.length) return;
  let state = backgroundDrains.get(queue);
  if (!state) {
    state = { running: false, pending: new Set() };
    backgroundDrains.set(queue, state);
  }
  for (const id of workspaceIds) state.pending.add(id);
  if (state.running) return;
  state.running = true;
  void (async () => {
    try {
      while (state.pending.size > 0) {
        const workspaceId = state.pending.values().next().value!;
        state.pending.delete(workspaceId);
        await drainQuillsWorkspace(workspaceId, deliverQuillsChange, [
          queue,
        ]).catch(() => {});
      }
    } finally {
      state.running = false;
    }
  })();
}
let cursor = "";
let pass: Promise<{ degraded: boolean }> | undefined;
/**
 * One pass over runnable workspaces. The scheduler and the internal job waker share a pass that is
 * already running, so passes never overlap on this instance or race on the cursor.
 */
export function runQuillsJobs() {
  pass ??= runPass().finally(() => {
    pass = undefined;
  });
  return pass;
}
async function runPass() {
  const page = await db.execute<{ workspaceId: string }>(
    sql`SELECT quills.runnable_workspaces(${cursor}) AS "workspaceId"`,
  );
  if (!page.rows.length) {
    cursor = "";
    return { degraded: false };
  }
  const workspaceIds = page.rows.map((row) => row.workspaceId);
  drainBackgroundQueue("quills.ai", workspaceIds);
  drainBackgroundQueue("quills.wipe", workspaceIds);
  let degraded = false;
  const deadline = Date.now() + 10000;
  for (const row of page.rows) {
    if (Date.now() >= deadline) break;
    try {
      // Timed work first (snooze wakes, scheduled publishes, maintenance bounds): it can queue jobs.
      degraded = (await runQuillsSweeps(row.workspaceId)).degraded || degraded;
      degraded =
        (
          await drainQuillsWorkspace(
            row.workspaceId,
            deliverQuillsChange,
            DELIVERY,
          )
        ).degraded || degraded;
    } catch {
      degraded = true;
    }
    cursor = row.workspaceId;
  }
  return { degraded };
}
