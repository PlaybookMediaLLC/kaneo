import { and, eq, isNull, sql } from "drizzle-orm";
import { ZodError } from "zod";
import db from "../../database";
import { withQuillsSystemWorkspace } from "../../database/quills/client";
import { events } from "../../database/quills/schema/events";
import type { JobQueueRow } from "../../database/quills/schema/job-queue";
import { workspaceUserTable, userTable } from "../../database/schema";
import { roleHasWorkspacePermission } from "../../utils/require-workspace-permission";
import { broadcastToUserAndWait } from "../../ws";
import { fanOut } from "./fanout";
import { fanOutIntegrations, runIntegrationJob } from "./handlers/integration";
import { runAiJob } from "./handlers/ai";
import { runDomainCheckJob } from "./handlers/domain-check";
import { runMailJob } from "./handlers/mail";
import { runNotificationJob } from "./handlers/notification";
import { runWebhookJob } from "./handlers/webhook";
import { runWipeJob } from "./handlers/wipe";
import {
  claimFrom,
  enqueueQuillsEvent,
  finishQuillsJob,
  eventPayloadSchema,
  QUILLS_QUEUES,
  type QuillsQueue,
} from "./queue";

/** Delivery handlers. Each validates its payload and finishes its own job. */
const handlers: Record<
  Exclude<QuillsQueue, "quills.event">,
  (workspaceId: string, job: JobQueueRow) => Promise<unknown>
> = {
  // Integration deliveries share this queue until a quills.integration queue is runnable (integrations/ROUTES.md).
  "quills.webhook": (workspaceId, job) =>
    "operationId" in (job.payload as object)
      ? runIntegrationJob(workspaceId, job)
      : runWebhookJob(workspaceId, job),
  "quills.mail": runMailJob,
  "quills.notification": runNotificationJob,
  "quills.domain_check": runDomainCheckJob,
  "quills.wipe": runWipeJob,
  "quills.ai": runAiJob,
};

export async function deliverQuillsChange(
  workspaceId: string,
  eventId: string,
) {
  const members = await db
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
    );
  for (const member of members)
    if (
      await roleHasWorkspacePermission(workspaceId, member.role, {
        workspace: ["read"],
        quills: ["read"],
      })
    ) {
      // Only invalidate caches: no feature data or credentials cross this channel.
      await broadcastToUserAndWait(member.userId, {
        type: "QUILLS_CHANGED",
        workspaceId,
        eventId,
      });
    }
}
export async function drainQuillsWorkspace(
  workspaceId: string,
  deliver = deliverQuillsChange,
  queues: readonly QuillsQueue[] = QUILLS_QUEUES,
) {
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
  let processed = 0,
    failed = 0;
  const deadline = Date.now() + 10000;
  // ponytail: up to 50 jobs per pass inside the 10-second budget; fan-out of large audiences drains over several passes.
  for (let i = 0; i < 50 && Date.now() < deadline; i++) {
    const job = await withQuillsSystemWorkspace(workspaceId, claimFrom(queues));
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
              .select({ id: events.id, publishedAt: events.publishedAt })
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
            deliver(workspaceId, payload.eventId),
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
/** Every queue but quills.ai: provider calls take up to minutes and must not delay a delivery. */
const DELIVERY = QUILLS_QUEUES.filter((queue) => queue !== "quills.ai");
let assistantDrain: Promise<void> | undefined;
let assistantCursor = "";
/**
 * Drains quills.ai in its own loop, one at a time per process, without holding up the delivery
 * pass that the scheduler awaits. A process that stops mid-job leaves a lease that expires and
 * is retried.
 */
function drainAssistantQueue() {
  assistantDrain ??= (async () => {
    try {
      const page = await db.execute<{ workspaceId: string }>(
        sql`SELECT quills.runnable_workspaces(${assistantCursor}) AS "workspaceId"`,
      );
      if (!page.rows.length) assistantCursor = "";
      for (const row of page.rows) {
        await drainQuillsWorkspace(row.workspaceId, deliverQuillsChange, [
          "quills.ai",
        ]).catch(() => {});
        assistantCursor = row.workspaceId;
      }
    } catch {
      /* The next tick retries. */
    } finally {
      assistantDrain = undefined;
    }
  })();
}
let cursor = "";
export async function runQuillsJobs() {
  drainAssistantQueue();
  const page = await db.execute<{ workspaceId: string }>(
    sql`SELECT quills.runnable_workspaces(${cursor}) AS "workspaceId"`,
  );
  if (!page.rows.length) {
    cursor = "";
    return { degraded: false };
  }
  let degraded = false;
  const deadline = Date.now() + 10000;
  for (const row of page.rows) {
    if (Date.now() >= deadline) break;
    try {
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
