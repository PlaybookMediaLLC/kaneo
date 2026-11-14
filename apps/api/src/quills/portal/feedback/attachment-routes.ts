import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, responseTimestamp, z } from "../../../openapi";
import { files } from "../../../database/quills/schema/files";
import { postComments } from "../../../database/quills/schema/posts";
import { defineQuillsRoute } from "../../framework/define-route";
import { createDownload } from "../../framework/files";
import { attachment, CUSTOMER_SOURCES } from "./attachments";
import {
  commentVisible,
  findPost,
  principalOf,
  viewerFor,
  visibleBoards,
} from "./viewer";

const params = z.object({ fileId: flexibleToTypeIdSchema("file") });
const missing = () =>
  new HTTPException(404, { message: "Attachment not found" });
const getAttachment = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/portal/files/{fileId}",
  operationId: "getQuillsPortalFile",
  summary:
    "Get an accessible feedback attachment and a short-lived download URL",
  action: "read",
  params,
  response: attachment.extend({
    downloadUrl: z.string(),
    downloadExpiresAt: responseTimestamp,
  }),
  responseDescription: "Attachment",
  errors: { 403: "Portal access denied", 404: "Attachment not found" },
  handler: async ({ db, caller, params }) => {
    const viewer = await viewerFor(db, "portal", caller);
    const [file] = await db
      .select({
        id: files.id,
        name: files.name,
        contentType: files.contentType,
        size: files.size,
        storageKey: files.storageKey,
        postId: files.postId,
        commentId: files.commentId,
        uploadedById: files.uploadedById,
        messageId: files.messageId,
        source: files.source,
      })
      .from(files)
      .where(and(eq(files.id, params.fileId), isNull(files.deletedAt)))
      .limit(1);
    if (!file || !CUSTOMER_SOURCES.includes(file.source) || file.messageId)
      throw missing();
    let postId = file.postId;
    if (file.commentId) {
      const [comment] = await db
        .select({ postId: postComments.postId })
        .from(postComments)
        .where(
          and(
            eq(postComments.id, file.commentId),
            isNull(postComments.deletedAt),
            commentVisible(viewer),
          ),
        )
        .limit(1);
      if (!comment) throw missing();
      postId = comment.postId;
    }
    if (postId)
      await findPost(db, viewer, await visibleBoards(db, viewer), postId);
    else if (!viewer.principalId || viewer.principalId !== file.uploadedById)
      throw missing();
    const { id, name, contentType, size } = file;
    return { id, name, contentType, size, ...(await createDownload(file)) };
  },
});
const discardAttachment = defineQuillsRoute({
  audience: "portal",
  method: "delete",
  path: "/portal/files/{fileId}",
  operationId: "discardQuillsPortalFile",
  summary: "Discard the caller's unattached feedback upload",
  action: "delete",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "Discarded upload",
  errors: { 403: "Portal access denied", 404: "Unattached upload not found" },
  event: (_input, result) => ({
    type: "file.deleted",
    entityType: "file",
    entityId: result.id,
  }),
  handler: async ({ db, caller, params }) => {
    const me = principalOf(await viewerFor(db, "portal", caller));
    const [row] = await db
      .delete(files)
      .where(
        and(
          eq(files.id, params.fileId),
          eq(files.uploadedById, me),
          eq(files.source, "portal"),
          isNull(files.postId),
          isNull(files.commentId),
          isNull(files.messageId),
        ),
      )
      .returning({ id: files.id });
    if (!row) throw missing();
    return row;
  },
});
export default apiRouter()
  .openapi(...getAttachment)
  .openapi(...discardAttachment);
