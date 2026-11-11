import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import { settings } from "../../../database/quills/schema/auth";
import { events } from "../../../database/quills/schema/events";
import { exportRuns } from "../../../database/quills/schema/export-runs";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import {
  defineQuillsRoute,
  type Database,
  type QuillsActor,
} from "../../framework/define-route";
import {
  createDownload,
  isQuillsStorageConfigured,
} from "../../framework/files";
import { exportRunFields, exportRunItem } from "./data-runs";

// Export runs: the request records the run and its event; the quills.transfer job
// (jobs/handlers/transfer.ts) writes the CSV through the storage lifecycle after commit.

/** The CSV files an export run can produce. */
export const exportKinds = [
  "posts",
  "users",
  "companies",
  "conversations",
] as const;

const runParams = z.object({ runId: flexibleToTypeIdSchema("export_run") });

/** The caller's own run. Another teammate's run is not found. */
async function ownRun(
  db: Database,
  actor: QuillsActor,
  runId: z.output<typeof runParams>["runId"],
) {
  const [run] = await db
    .select({ ...exportRunFields, s3Key: exportRuns.s3Key })
    .from(exportRuns)
    .where(
      and(
        eq(exportRuns.id, runId),
        eq(exportRuns.initiatedByPrincipalId, actor.principalId),
      ),
    )
    .limit(1);
  if (!run) throw new HTTPException(404, { message: "Export run not found" });
  return run;
}

const createRun = defineQuillsRoute({
  method: "post",
  path: "/transfer/export-runs",
  operationId: "createQuillsExportWorkspace",
  summary: "Start an export run",
  description:
    "Queues a CSV export of posts, users, companies or conversations. The file holds only rows that the caller can read: posts on boards the caller can see, no test customers and no deleted rows. One export runs per workspace at a time. Poll GET /transfer/export-runs/{runId}, then request a download URL.",
  action: "manage_settings",
  body: z.object({ kind: z.enum(exportKinds) }),
  response: z.object({ runId: z.string() }),
  responseDescription: "The queued run",
  errors: { 409: "An export is already running" },
  event: ({ body }, result) => ({
    type: "export.requested",
    entityType: "export_run",
    entityId: result.runId,
    payload: { kind: body.kind },
  }),
  handler: async ({ db, actor, body }) => {
    if (!isQuillsStorageConfigured())
      throw new HTTPException(503, {
        message: "File storage is not configured",
      });
    // The one active run (a partial unique index) holds the workspace's export slot. When no live job
    // will settle it (its job failed or was removed), fail it now; clearing its key lets the storage
    // trigger queue a partial file for cleanup. A pending or running job, even with an expired
    // lease, still settles its run, so this never touches a run that a worker can finish.
    const [active] = await db
      .select({ id: exportRuns.id })
      .from(exportRuns)
      .where(inArray(exportRuns.status, ["pending", "running"]));
    const [live] = active
      ? await db
          .select({ id: jobQueue.id })
          .from(events)
          .innerJoin(jobQueue, eq(jobQueue.dedupeKey, events.eventId))
          .where(
            and(
              eq(events.entityType, "export_run"),
              eq(events.entityId, active.id),
              eq(events.type, "export.requested"),
              inArray(jobQueue.queue, ["quills.event", "quills.transfer"]),
              inArray(jobQueue.status, ["pending", "running"]),
            ),
          )
          .limit(1)
      : [];
    if (active && !live)
      await db
        .update(exportRuns)
        .set({
          status: "failed",
          error: "The export stopped before it finished",
          s3Key: null,
          finishedAt: new Date(),
        })
        .where(
          and(
            eq(exportRuns.id, active.id),
            inArray(exportRuns.status, ["pending", "running"]),
          ),
        );
    const [workspace] = await db.select({ slug: settings.slug }).from(settings);
    if (!workspace) throw new Error("Quills settings were not initialized");
    const [run] = await db
      .insert(exportRuns)
      .values({
        fileName: `${body.kind}-${workspace.slug}-${new Date().toISOString().slice(0, 10)}.csv`,
        initiatedByPrincipalId: actor.principalId,
      })
      // The partial unique index allows one pending or running run per workspace.
      .onConflictDoNothing()
      .returning({ id: exportRuns.id });
    if (!run)
      throw new HTTPException(409, { message: "An export is already running" });
    return { runId: run.id };
  },
});

const getRun = defineQuillsRoute({
  method: "get",
  path: "/transfer/export-runs/{runId}",
  operationId: "getQuillsExportRuns",
  summary: "Get one of the caller's export runs",
  action: "manage_settings",
  params: runParams,
  response: exportRunItem,
  responseDescription: "Export run",
  errors: { 404: "Export run not found" },
  handler: async ({ db, actor, params }) => {
    const { s3Key: _, ...run } = await ownRun(db, actor, params.runId);
    return run;
  },
});

const download = defineQuillsRoute({
  method: "get",
  path: "/transfer/export-runs/{runId}/download",
  operationId: "listQuillsExportRunsDownload",
  summary: "Get a short-lived download URL for a finished export",
  description:
    "The URL expires after the storage presign lifetime. The file itself is removed when the run expires.",
  action: "manage_settings",
  params: runParams,
  response: z.object({
    fileName: z.string(),
    downloadUrl: z.string(),
    downloadExpiresAt: responseTimestamp,
  }),
  responseDescription: "Download URL",
  errors: {
    404: "Export run not found",
    409: "The export is not finished, failed or expired",
  },
  handler: async ({ db, actor, params }) => {
    const run = await ownRun(db, actor, params.runId);
    if (run.status !== "completed" || !run.s3Key)
      throw new HTTPException(409, {
        message:
          run.status === "failed"
            ? "This export failed"
            : run.status === "completed"
              ? "This export has expired"
              : "This export is not ready yet",
      });
    if (!run.expiresAt || run.expiresAt <= new Date())
      throw new HTTPException(409, { message: "This export has expired" });
    return {
      fileName: run.fileName,
      ...(await createDownload({
        storageKey: run.s3Key,
        name: run.fileName,
        contentType: "text/csv",
      })),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...createRun)
  .openapi(...getRun)
  .openapi(...download);
