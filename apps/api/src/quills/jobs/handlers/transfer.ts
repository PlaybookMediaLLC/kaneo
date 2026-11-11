import type { TypeId } from "@kaneo/ids";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import { principal } from "../../../database/quills/schema/auth";
import { exportRuns } from "../../../database/quills/schema/export-runs";
import { files } from "../../../database/quills/schema/files";
import { importRuns } from "../../../database/quills/schema/import-runs";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { recordQuillsChange } from "../../events";
import {
  exportKey,
  isQuillsStorageConfigured,
  putObject,
  readObject,
} from "../../framework/files";
import {
  accessibleProjectIds,
  memberUserIds,
  quillsReaders,
} from "../../framework/platform-reads";
import { buildExport } from "../../transfer/runs/export-files";
import { exportKinds } from "../../transfer/runs/export-runs";
import {
  importPosts,
  readRecords,
  type CsvRecord,
} from "../../transfer/runs/import-posts";
import { MAX_IMPORT_BYTES } from "../../transfer/runs/import-runs";
import { loadEvent } from "../fanout";
import { eventPayloadSchema, finishQuillsJob } from "../queue";

// Export and import runs. A run is claimed once (pending → running) and never retried: every
// outcome, including an error, settles the run and finishes the job in one transaction. A later
// attempt that finds the run still running (a lost lease or a crash) fails it, and clearing its
// export key lets the storage trigger queue the partial file for cleanup.
//
// ponytail: each run executes inline in the shared drain loop, like the wipe job. While a run works,
// this instance delivers no other Quills job (cache events, webhooks, mail). Give runs their own
// drain (scheduler/index.ts is an upstream file) when exports grow toward the five-minute lease.

const EXPORT_TTL_MS = 7 * 86_400_000;
const exportPayload = z.object({ kind: z.enum(exportKinds) });
const importPayload = z.object({
  fileId: z.string().min(1).max(200),
  boardId: z.string().min(1).max(200),
});
type Outcome<T> = T | { error: string };

/** The run's outcome and the job's finish commit together, so a lost lease rolls both back. */
const settle = (
  workspaceId: string,
  job: JobQueueRow,
  work: (db: Database) => Promise<unknown>,
) =>
  withQuillsSystemWorkspace(workspaceId, async (db) => {
    await work(db);
    await finishQuillsJob(db, job.id, job.leaseToken!);
  });

/** Reads the run's rows as its initiator would: undefined when they can no longer read Quills here. */
async function initiatorProjects(workspaceId: string, userId: string | null) {
  if (!userId || !(await quillsReaders(workspaceId, [userId])).has(userId))
    return undefined;
  return accessibleProjectIds(workspaceId, userId);
}

/** Never store a raw storage or database error on the run; operators get its name in the log. */
const unexpected = (what: string, runId: string) => (error: unknown) => {
  console.error(`Quills ${what} run failed`, {
    runId,
    name: (error as Error | null)?.name,
  });
  return { error: `The ${what} failed` };
};
/** Logs a failed settle, then lets the worker record the job's failure. */
const logged = (what: string, runId: string) => (error: unknown) => {
  unexpected(what, runId)(error);
  throw error;
};

/**
 * Queues `key` for cleanup when the run no longer holds it: another attempt settled the run while
 * this one uploaded. Setting and then clearing the key fires the storage trigger, the only path that
 * queues cleanup from a Quills transaction.
 */
async function releaseKey(
  workspaceId: string,
  runId: TypeId<"export_run">,
  key: string,
) {
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [run] = await db
      .select({ key: exportRuns.s3Key })
      .from(exportRuns)
      .where(eq(exportRuns.id, runId))
      .for("update");
    if (!run || run.key === key) return;
    await db
      .update(exportRuns)
      .set({ s3Key: key })
      .where(eq(exportRuns.id, runId));
    await db
      .update(exportRuns)
      .set({ s3Key: run.key })
      .where(eq(exportRuns.id, runId));
  });
}

async function initiatorUser(db: Database, id: TypeId<"principal">) {
  const [row] = await db
    .select({ userId: principal.kaneoUserId })
    .from(principal)
    .where(eq(principal.id, id));
  return row?.userId ?? null;
}

async function failExport(
  db: Database,
  runId: TypeId<"export_run">,
  error: string,
) {
  const [failed] = await db
    .update(exportRuns)
    .set({ status: "failed", error, s3Key: null, finishedAt: new Date() })
    .where(
      and(
        eq(exportRuns.id, runId),
        inArray(exportRuns.status, ["pending", "running"]),
      ),
    )
    .returning({ id: exportRuns.id });
  if (failed)
    await recordQuillsChange(db, null, {
      type: "export.finished",
      entityType: "export_run",
      entityId: runId,
      payload: { status: "failed" },
    });
}

async function runExport(
  workspaceId: string,
  job: JobQueueRow,
  runId: TypeId<"export_run">,
  payload: unknown,
) {
  const { kind } = exportPayload.parse(payload);
  if (!isQuillsStorageConfigured())
    return settle(workspaceId, job, (db) =>
      failExport(db, runId, "File storage is not configured"),
    );
  const key = exportKey(workspaceId, "csv");
  // The key is on the row before the upload, so every way out of this run can let it go.
  const run = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [claimed] = await db
      .update(exportRuns)
      .set({ status: "running", s3Key: key })
      .where(and(eq(exportRuns.id, runId), eq(exportRuns.status, "pending")))
      .returning({ initiator: exportRuns.initiatedByPrincipalId });
    return claimed && { userId: await initiatorUser(db, claimed.initiator) };
  });
  if (!run)
    return settle(workspaceId, job, (db) =>
      failExport(db, runId, "The export stopped before it finished"),
    );
  let uploaded = false;
  try {
    await finishExport(workspaceId, job, runId, kind, key, run.userId, () => {
      uploaded = true;
    });
  } finally {
    if (uploaded)
      await releaseKey(workspaceId, runId, key).catch(
        unexpected("export", runId),
      );
  }
}

async function finishExport(
  workspaceId: string,
  job: JobQueueRow,
  runId: TypeId<"export_run">,
  kind: z.output<typeof exportPayload>["kind"],
  key: string,
  userId: string | null,
  uploading: () => void,
) {
  const outcome: Outcome<{ csv: string; count: number }> = await (async () => {
    const projects = await initiatorProjects(workspaceId, userId);
    if (!projects)
      return {
        error: "The teammate who started this export can no longer read it",
      };
    const built = await withQuillsSystemWorkspace(
      workspaceId,
      (db) => buildExport(db, kind, projects),
      { snapshot: true },
    );
    if ("error" in built) return built;
    // A timed-out upload can still land, so the key counts as used from here.
    uploading();
    await putObject(key, built.csv, "text/csv; charset=utf-8");
    return built;
  })().catch(unexpected("export", runId));
  if ("error" in outcome)
    return settle(workspaceId, job, (db) =>
      failExport(db, runId, outcome.error),
    );
  await settle(workspaceId, job, async (db) => {
    const finishedAt = new Date();
    const [done] = await db
      .update(exportRuns)
      .set({
        status: "completed",
        sizeBytes: Buffer.byteLength(outcome.csv),
        entityCounts: { [kind]: outcome.count },
        finishedAt,
        expiresAt: new Date(finishedAt.getTime() + EXPORT_TTL_MS),
      })
      .where(and(eq(exportRuns.id, runId), eq(exportRuns.status, "running")))
      .returning({ id: exportRuns.id });
    if (done)
      await recordQuillsChange(db, null, {
        type: "export.finished",
        entityType: "export_run",
        entityId: runId,
        payload: { status: "completed" },
      });
  }).catch(logged("export", runId));
}

async function failImport(
  db: Database,
  runId: TypeId<"import_run">,
  fileId: TypeId<"file">,
  message: string,
) {
  const [failed] = await db
    .update(importRuns)
    .set({
      status: "failed",
      errorReport: [{ row: 0, message }],
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(importRuns.id, runId),
        inArray(importRuns.status, ["pending", "running"]),
      ),
    )
    .returning({ id: importRuns.id });
  // The storage trigger queues the uploaded CSV for cleanup.
  await db.delete(files).where(eq(files.id, fileId));
  if (failed)
    await recordQuillsChange(db, null, {
      type: "import.finished",
      entityType: "import_run",
      entityId: runId,
      payload: { status: "failed" },
    });
}

async function runImport(
  workspaceId: string,
  job: JobQueueRow,
  runId: TypeId<"import_run">,
  payload: unknown,
) {
  const parsed = importPayload.parse(payload);
  const fileId = parsed.fileId as TypeId<"file">;
  const run = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [claimed] = await db
      .update(importRuns)
      .set({ status: "running" })
      .where(and(eq(importRuns.id, runId), eq(importRuns.status, "pending")))
      .returning({ initiator: importRuns.initiatedByPrincipalId });
    if (!claimed) return undefined;
    const [file] = await db
      .select({ key: files.storageKey })
      .from(files)
      .where(eq(files.id, fileId));
    return {
      initiator: claimed.initiator,
      userId: await initiatorUser(db, claimed.initiator),
      key: file?.key,
    };
  });
  if (!run)
    return settle(workspaceId, job, (db) =>
      failImport(db, runId, fileId, "The import stopped before it finished"),
    );
  const outcome: Outcome<{
    records: CsvRecord[];
    projects: string[];
    teammateEmails: Set<string>;
  }> = await (async () => {
    const projects = await initiatorProjects(workspaceId, run.userId);
    if (!projects)
      return {
        error: "The teammate who started this import can no longer read Quills",
      };
    if (!run.key) return { error: "The uploaded file is missing" };
    const read = readRecords(
      (await readObject(run.key, MAX_IMPORT_BYTES)).toString("utf8"),
    );
    if ("error" in read) return read;
    const teammates = await quillsReaders(
      workspaceId,
      await memberUserIds(workspaceId),
    );
    return {
      records: read.records,
      projects,
      teammateEmails: new Set(
        [...teammates.values()].map((t) => t.email.toLowerCase()),
      ),
    };
  })().catch(unexpected("import", runId));
  if ("error" in outcome)
    return settle(workspaceId, job, (db) =>
      failImport(db, runId, fileId, outcome.error),
    );
  await settle(workspaceId, job, async (db) => {
    // One import settles at a time per workspace, so a second run sees the first one's source links.
    await db.execute(
      sql`select pg_advisory_xact_lock(hashtext('quills-import'), hashtext(${workspaceId}))`,
    );
    const [current] = await db
      .select({ status: importRuns.status })
      .from(importRuns)
      .where(eq(importRuns.id, runId))
      .for("update");
    if (current?.status !== "running") return;
    const result = await importPosts(db, {
      records: outcome.records,
      boardId: parsed.boardId as TypeId<"board">,
      projects: outcome.projects,
      initiator: run.initiator,
      teammateEmails: outcome.teammateEmails,
    });
    const status = result.totals.errors ? "failed" : "completed";
    await db
      .update(importRuns)
      .set({
        status,
        totals: result.totals,
        errorReport: result.errors.length ? result.errors : null,
        finishedAt: new Date(),
      })
      .where(eq(importRuns.id, runId));
    await db.delete(files).where(eq(files.id, fileId));
    await recordQuillsChange(db, null, {
      type: "import.finished",
      entityType: "import_run",
      entityId: runId,
      payload: { status },
    });
  }).catch(logged("import", runId));
}

/** Runs the export or import that a recorded request names. Anything else finishes the job. */
export async function runTransferJob(workspaceId: string, job: JobQueueRow) {
  const { eventId } = eventPayloadSchema.parse(job.payload);
  const event = await withQuillsSystemWorkspace(workspaceId, (db) =>
    loadEvent(db, eventId),
  );
  if (event?.type === "export.requested")
    return runExport(
      workspaceId,
      job,
      event.entityId as TypeId<"export_run">,
      event.payload,
    );
  if (event?.type === "import.requested")
    return runImport(
      workspaceId,
      job,
      event.entityId as TypeId<"import_run">,
      event.payload,
    );
  await settle(workspaceId, job, async () => {});
}
