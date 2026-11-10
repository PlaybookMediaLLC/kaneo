import { and, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { files } from "../../database/quills/schema/files";
import { defineQuillsRoute } from "../framework/define-route";
import {
  createDownload,
  filePurposes,
  holdVerifiedUpload,
  uploadedObject,
  verifyUpload,
} from "../framework/files";

const file = z.object({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number(),
  family: z.string(),
  createdAt: responseTimestamp,
});
const fileFields = {
  id: files.id,
  name: files.name,
  contentType: files.contentType,
  size: files.size,
  family: files.family,
  createdAt: files.createdAt,
};
const fileParams = z.object({ fileId: flexibleToTypeIdSchema("file") });
const notFound = { 404: "File not found" };
const live = (fileId: z.output<typeof fileParams>["fileId"]) =>
  and(eq(files.id, fileId), isNull(files.deletedAt));

/** The family names the source's preview pipeline uses, from the stored content type. */
const family = (type: string) =>
  type.startsWith("image/")
    ? "image"
    : type.startsWith("video/")
      ? "video"
      : type.startsWith("audio/")
        ? "audio"
        : type === "application/pdf"
          ? "pdf"
          : type === "text/csv"
            ? "csv"
            : type.startsWith("text/")
              ? "text"
              : "other";

const createFile = defineQuillsRoute({
  method: "post",
  path: "/files",
  operationId: "createQuillsFiles",
  summary: "Register an uploaded file",
  description:
    "Verifies an object uploaded with a URL from POST /files/uploads or POST /files/settings-uploads (assistant avatar) and registers it in the workspace's files.",
  action: "create",
  body: uploadedObject.extend({
    name: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .regex(/^[^\\/\p{Cc}]+$/u, "Invalid file name"),
  }),
  // `created` is false when a retry finds the file that an earlier request registered.
  response: file.extend({ created: z.boolean() }),
  responseDescription: "Registered file",
  errors: {
    404: "Upload not found",
    409: "The file for this upload was removed",
  },
  load: ({ body, workspaceId }) =>
    verifyUpload(workspaceId, filePurposes, body, { digest: true }),
  event: (_input, result) =>
    result.created && {
      type: "file.created",
      entityType: "file",
      entityId: result.id,
    },
  handler: async ({ db, actor, body, loaded }) => {
    await holdVerifiedUpload(db, loaded);
    const [row] = await db
      .insert(files)
      .values({
        storageKey: loaded.key,
        name: body.name,
        contentType: loaded.contentType,
        declaredType: body.contentType,
        family: family(loaded.contentType),
        size: loaded.size,
        sha256: loaded.sha256,
        source: "agent",
        uploadedById: actor.principalId,
        // No preview job exists in Kaneo yet.
        previewStatus: "none",
      })
      .onConflictDoNothing()
      .returning(fileFields);
    if (row) return { ...row, created: true };
    const [existing] = await db
      .select(fileFields)
      .from(files)
      .where(and(eq(files.storageKey, loaded.key), isNull(files.deletedAt)))
      .limit(1);
    if (!existing)
      throw new HTTPException(409, {
        message: "The file for this upload was removed",
      });
    return { ...existing, created: false };
  },
});

const getFile = defineQuillsRoute({
  method: "get",
  path: "/files/{fileId}",
  operationId: "getQuillsFile",
  summary: "Get a file and a short-lived download URL",
  action: "read",
  params: fileParams,
  response: file.extend({
    downloadUrl: z.string(),
    downloadExpiresAt: responseTimestamp,
  }),
  responseDescription: "File",
  errors: notFound,
  handler: async ({ db, params }) => {
    const [row] = await db
      .select({ ...fileFields, storageKey: files.storageKey })
      .from(files)
      .where(live(params.fileId))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "File not found" });
    const { storageKey, ...fields } = row;
    return {
      ...fields,
      ...(await createDownload({ ...fields, storageKey })),
    };
  },
});

const openFile = defineQuillsRoute({
  method: "post",
  path: "/files/{fileId}/opened",
  operationId: "createQuillsFilesOpened",
  summary: "Count an open of a file",
  action: "read",
  params: fileParams,
  response: z.object({ openCount: z.number() }),
  responseDescription: "Open count",
  errors: notFound,
  event: { none: "A usage counter, not a change to the file" },
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(files)
      .set({ openCount: sql`${files.openCount} + 1` })
      .where(live(params.fileId))
      .returning({ openCount: files.openCount });
    if (!row) throw new HTTPException(404, { message: "File not found" });
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...createFile)
  .openapi(...getFile)
  .openapi(...openFile);
