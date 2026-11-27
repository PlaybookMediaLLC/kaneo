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
  // Short database work; it must not wait behind slow webhook and mail backlogs.
  "quills.workflow",
  "quills.webhook",
  "quills.mail",
  "quills.notification",
  "quills.domain_check",
  "quills.wipe",
  "quills.transfer",
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
  delaySeconds = 0,
) {
  const [row] = await db
    .insert(jobQueue)
    .values({
      jobId: createId("job"),
      queue,
      payload,
      dedupeKey,
      maxAttempts,
      ...(delaySeconds > 0 && {
        runAt: sql`now()+${delaySeconds}*interval '1 second'`,
      }),
    })
    .onConflictDoNothing()
    .returning();
  return row;
}
export interface QuillsJobInput {
  queue: QuillsQueue;
  payload: Record<string, string>;
  dedupeKey: string;
  maxAttempts: number;
  delaySeconds?: number;
}

/** Bulk-enqueues jobs in bounded batches; duplicates per (queue, dedupeKey) are ignored. */
export async function enqueueQuillsJobs(
  db: Database,
  jobs: readonly QuillsJobInput[],
): Promise<void> {
  const BATCH = 250;
  for (let i = 0; i < jobs.length; i += BATCH) {
    const chunk = jobs.slice(i, i + BATCH);
    await db
      .insert(jobQueue)
      .values(
        chunk.map((job) => ({
          jobId: createId("job"),
          queue: job.queue,
          payload: job.payload,
          dedupeKey: job.dedupeKey,
          maxAttempts: job.maxAttempts,
          ...(job.delaySeconds && job.delaySeconds > 0
            ? {
                runAt: sql`now()+${job.delaySeconds}*interval '1 second'`,
              }
            : {}),
        })),
      )
      .onConflictDoNothing();
  }
}

export async function enqueueQuillsEvent(db: Database, eventId: string) {
  const payload = eventPayloadSchema.parse({ eventId });
  return enqueueQuillsJob(db, "quills.event", payload, payload.eventId, 3);
}
/** A claimer for the next due job of `queues`, in list order. */
export const claimFrom =
  (queues: readonly QuillsQueue[], options: { reapExpired?: boolean } = {}) =>
  async (db: Database) => {
    if (!queues.length) return;
    const queueList = sql.join(
      queues.map((queue) => sql`${queue}`),
      sql`,`,
    );
    if (options.reapExpired !== false) {
      await db.execute(
        sql`UPDATE quills.job_queue SET status=CASE WHEN attempts<max_attempts THEN 'pending' ELSE 'failed' END,run_at=now(),finished_at=CASE WHEN attempts>=max_attempts THEN now() ELSE NULL END,lease_token=NULL,locked_until=NULL,locked_by=NULL,last_error='Worker lease expired',updated_at=now() WHERE queue IN (${queueList}) AND status='running' AND locked_until<=now()`,
      );
    }
    // Single round-trip priority claim using LATERAL + unnest WITH ORDINALITY so PostgreSQL
    // drives an O(1) index scan per queue on job_queue_claim_idx without sorting the backlog.
    const picked = await db.execute<{ id: string; attempts: number }>(sql`
      SELECT j.id, j.attempts
      FROM unnest(ARRAY[${queueList}]::text[]) WITH ORDINALITY AS q(queue, ord)
      CROSS JOIN LATERAL (
        SELECT id, attempts
        FROM quills.job_queue
        WHERE queue = q.queue AND status = 'pending' AND run_at <= now()
        ORDER BY run_at, id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ) j
      LIMIT 1
    `);
    const job = picked.rows[0];
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
      .where(eq(jobQueue.id, BigInt(job.id)))
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
