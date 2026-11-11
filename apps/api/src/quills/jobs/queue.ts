import { randomUUID } from "node:crypto";
import { createId } from "@kaneo/ids";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../database/quills/client";
import { jobQueue } from "../../database/quills/schema/job-queue";

export const eventPayloadSchema = z
  .object({ eventId: z.string().min(1).max(200) })
  .strict();
export const LEASE_SECONDS = 300;
/** Queues the worker executes. A row in any other queue is never claimed. Keep in step with quills.runnable_workspaces. */
export const QUILLS_QUEUES = [
  "quills.event",
  "quills.webhook",
  "quills.mail",
  "quills.notification",
  "quills.domain_check",
  "quills.wipe",
  "quills.ai",
] as const;
export type QuillsQueue = (typeof QUILLS_QUEUES)[number];
/** Enqueues once per queue and deduplication key; a repeat returns undefined. */
export async function enqueueQuillsJob(
  db: Database,
  queue: QuillsQueue,
  payload: Record<string, string>,
  dedupeKey: string,
  maxAttempts: number,
) {
  const [row] = await db
    .insert(jobQueue)
    .values({ jobId: createId("job"), queue, payload, dedupeKey, maxAttempts })
    .onConflictDoNothing()
    .returning();
  return row;
}
export async function enqueueQuillsEvent(db: Database, eventId: string) {
  const payload = eventPayloadSchema.parse({ eventId });
  return enqueueQuillsJob(db, "quills.event", payload, payload.eventId, 3);
}
/** A claimer for the next due job of `queues`, in list order. */
export const claimFrom =
  (queues: readonly QuillsQueue[]) => async (db: Database) => {
    await db.execute(
      sql`UPDATE quills.job_queue SET status=CASE WHEN attempts<max_attempts THEN 'pending' ELSE 'failed' END,run_at=now(),finished_at=CASE WHEN attempts>=max_attempts THEN now() ELSE NULL END,lease_token=NULL,locked_until=NULL,locked_by=NULL,last_error='Worker lease expired',updated_at=now() WHERE queue IN (${sql.join(
        queues.map((queue) => sql`${queue}`),
        sql`,`,
      )}) AND status='running' AND locked_until<=now()`,
    );
    // One indexed query per queue, in list order: cache invalidations never wait behind deliveries.
    // ponytail: fixed priority; a constantly ready webhook backlog delays mail. Add a fair order if both grow.
    let job: typeof jobQueue.$inferSelect | undefined;
    for (const queue of queues) {
      [job] = await db
        .select()
        .from(jobQueue)
        .where(
          and(
            eq(jobQueue.queue, queue),
            sql`${jobQueue.status}='pending' AND ${jobQueue.runAt}<=now()`,
          ),
        )
        .orderBy(jobQueue.runAt, jobQueue.id)
        .for("update", { skipLocked: true })
        .limit(1);
      if (job) break;
    }
    if (!job) return;
    const token = randomUUID();
    const [claimed] = await db
      .update(jobQueue)
      .set({
        status: "running",
        attempts: job.attempts + 1,
        leaseToken: token,
        lockedUntil: sql`now()+${LEASE_SECONDS}*interval '1 second'`,
        lockedBy: `api:${process.pid}`,
        startedAt: new Date(),
        updatedAt: new Date(),
        finishedAt: null,
      })
      .where(eq(jobQueue.id, job.id))
      .returning();
    return claimed;
  };
/** Claims the next due job of every executed queue. */
export const claimQuillsJob = claimFrom(QUILLS_QUEUES);
export async function finishQuillsJob(
  db: Database,
  jobId: bigint,
  leaseToken: string,
  error?: string,
  /** Fail now, even with attempts left: a retry cannot succeed or could repeat an external effect. */
  permanent = false,
) {
  const [job] = await db
    .select()
    .from(jobQueue)
    .where(
      and(
        eq(jobQueue.id, jobId),
        eq(jobQueue.leaseToken, leaseToken),
        sql`${jobQueue.status}='running' AND ${jobQueue.lockedUntil}>now()`,
      ),
    )
    .for("update");
  if (!job) throw new Error("Quills job lease lost");
  const retry = Boolean(error && !permanent && job.attempts < job.maxAttempts);
  await db
    .update(jobQueue)
    .set({
      status: retry ? "pending" : error ? "failed" : "succeeded",
      lastError: error ?? null,
      runAt: sql`now()+${Math.min(3600, 2 ** job.attempts * 10)}*interval '1 second'`,
      finishedAt: retry ? null : new Date(),
      leaseToken: null,
      lockedUntil: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(jobQueue.id, jobId));
}
