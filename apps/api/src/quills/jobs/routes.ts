import { and, desc, eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { jobQueue } from "../../database/quills/schema/job-queue";
import { auditLog } from "../../database/quills/schema/audit-log";
import { defineQuillsRoute } from "../framework/define-route";

const listJobs = defineQuillsRoute({
  method: "get",
  path: "/jobs",
  operationId: "listQuillsJobs",
  summary: "List recent Quills jobs",
  action: "manage_settings",
  query: z.object({
    before: z
      .string()
      .max(19)
      .regex(/^\d+$/)
      .refine((value) => value.length < 19 || value <= "9223372036854775807")
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({
    jobs: z.array(
      z.object({
        id: z.string(),
        jobId: z.string(),
        queue: z.string(),
        status: z.string(),
        attempts: z.number(),
        maxAttempts: z.number(),
        lastError: z.string().nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
  responseDescription: "Recent jobs",
  errors: { 403: "Insufficient permission" },
  handler: async ({ db, query: { before, limit } }) => {
    const rows = await db
      .select({
        id: jobQueue.id,
        jobId: jobQueue.jobId,
        queue: jobQueue.queue,
        status: jobQueue.status,
        attempts: jobQueue.attempts,
        maxAttempts: jobQueue.maxAttempts,
        lastError: jobQueue.lastError,
      })
      .from(jobQueue)
      .where(before ? sql`${jobQueue.id}<${BigInt(before)}` : undefined)
      .orderBy(desc(jobQueue.id))
      .limit(limit + 1);
    return {
      jobs: rows.slice(0, limit).map((row) => ({ ...row, id: String(row.id) })),
      nextCursor: rows.length > limit ? String(rows[limit - 1]!.id) : null,
    };
  },
});

const retryJob = defineQuillsRoute({
  method: "post",
  path: "/jobs/{jobId}/retry",
  operationId: "retryQuillsJob",
  summary: "Retry a failed Quills job",
  action: "manage_settings",
  params: z.object({ jobId: z.string().min(1).max(200) }),
  response: z.object({ retried: z.boolean() }),
  responseDescription: "Job queued",
  errors: {
    403: "Insufficient permission",
    409: "Job is not a failed registered job",
  },
  event: {
    none: "A retry records an audit entry only; job.retried is not in the event catalogue.",
  },
  handler: async ({ db, actor, params: { jobId } }) => {
    const rows = await db
      .update(jobQueue)
      .set({
        status: "pending",
        attempts: 0,
        runAt: new Date(),
        lastError: null,
        finishedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobQueue.jobId, jobId),
          eq(jobQueue.status, "failed"),
          eq(jobQueue.queue, "quills.event"),
        ),
      )
      .returning({ id: jobQueue.id });
    if (!rows.length)
      throw new HTTPException(409, {
        message: "Job is not a failed registered job",
      });
    await db.insert(auditLog).values({
      eventType: "job.retried",
      actorType: "user",
      actorPrincipalId: actor.principalId,
      targetType: "job",
      targetId: jobId,
      channel: "api",
    });
    return { retried: true };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listJobs)
  .openapi(...retryJob);
