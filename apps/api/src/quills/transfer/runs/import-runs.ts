import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../../openapi";
import { files } from "../../../database/quills/schema/files";
import { importRuns } from "../../../database/quills/schema/import-runs";
import { defineQuillsRoute } from "../../framework/define-route";
import {
  holdVerifiedUpload,
  uploadedObject,
  verifyUpload,
} from "../../framework/files";
import { findBoard, loadProjects } from "../../feedback/visibility";
import { importRunFields, importRunItem } from "./data-runs";

// Post CSV import runs. The request verifies the upload, keeps the object referenced and records
// the run; the quills.transfer job validates every row and imports all of them or none.

/** The largest CSV file an import reads. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const csvTypes = new Set([
  "text/csv",
  "text/plain",
  "application/csv",
  "application/vnd.ms-excel",
]);
const runParams = z.object({ runId: flexibleToTypeIdSchema("import_run") });

const createRun = defineQuillsRoute({
  method: "post",
  path: "/transfer/import-runs",
  operationId: "createQuillsImport",
  summary: "Start a post CSV import run",
  description:
    "Upload the CSV with a URL from POST /files/uploads (purpose `file`), then start the run. Columns: `title` and `content` (required), and `status`, `tags`, `board`, `author_email`, `author_name`, `created_at` and `source_id`. Rows without `board` go to `boardId`. The job checks every row first: one invalid row fails the run with an error report and imports nothing. A row whose `source_id` an earlier import created is skipped.",
  action: "manage_settings",
  body: uploadedObject.extend({
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^\\/\p{Cc}]+$/u, "Invalid file name"),
    boardId: flexibleToTypeIdSchema("board"),
  }),
  response: z.object({
    runId: z.string(),
    status: z.enum(importRuns.status.enumValues),
    fileId: z.string(),
  }),
  responseDescription: "The queued run",
  errors: {
    404: "Upload or board not found",
    409: "This upload is already registered",
  },
  load: async ({ body, workspaceId, userId }) => {
    if (!csvTypes.has(body.contentType) || body.size > MAX_IMPORT_BYTES)
      throw new HTTPException(400, {
        message: "Upload a CSV file of at most 10 MB",
      });
    return {
      projects: await loadProjects({ workspaceId, userId }),
      upload: await verifyUpload(workspaceId, ["file"], body, { digest: true }),
    };
  },
  event: ({ body }, result) => ({
    type: "import.requested",
    entityType: "import_run",
    entityId: result.runId,
    payload: { fileId: result.fileId, boardId: body.boardId },
  }),
  handler: async ({ db, actor, body, loaded }) => {
    await findBoard(db, body.boardId, loaded.projects);
    await holdVerifiedUpload(db, loaded.upload);
    const [file] = await db
      .insert(files)
      .values({
        storageKey: loaded.upload.key,
        name: body.name,
        contentType: loaded.upload.contentType,
        declaredType: body.contentType,
        family: "csv",
        size: loaded.upload.size,
        sha256: loaded.upload.sha256,
        source: "import",
        uploadedById: actor.principalId,
        previewStatus: "none",
        // Hidden from file reads: the row only keeps the object referenced until the job removes it.
        deletedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning({ id: files.id });
    if (!file)
      throw new HTTPException(409, {
        message: "This upload is already registered",
      });
    const [run] = await db
      .insert(importRuns)
      .values({
        source: "csv",
        fileName: body.name,
        initiatedByPrincipalId: actor.principalId,
      })
      .returning({ id: importRuns.id, status: importRuns.status });
    return { runId: run!.id, status: run!.status, fileId: file.id };
  },
});

const getRun = defineQuillsRoute({
  method: "get",
  path: "/transfer/import-runs/{runId}",
  operationId: "getQuillsImportRuns",
  summary: "Get an import run with its totals and error report",
  action: "manage_settings",
  params: runParams,
  response: importRunItem,
  responseDescription: "Import run",
  errors: { 404: "Import run not found" },
  handler: async ({ db, params }) => {
    const [run] = await db
      .select(importRunFields)
      .from(importRuns)
      .where(eq(importRuns.id, params.runId))
      .limit(1);
    if (!run) throw new HTTPException(404, { message: "Import run not found" });
    return run;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...createRun)
  .openapi(...getRun);
