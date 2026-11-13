import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  notInArray,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { FileId, PostId, PostCommentId, PrincipalId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { z } from "../../../openapi";
import { files } from "../../../database/quills/schema/files";
import type { Database } from "../../framework/define-route";

export const attachmentIds = z
  .array(flexibleToTypeIdSchema("file"))
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, "Duplicate attachments")
  .optional();
export const attachment = z.object({
  id: z.string(),
  name: z.string(),
  contentType: z.string(),
  size: z.number(),
});
const fields = {
  id: files.id,
  name: files.name,
  contentType: files.contentType,
  size: files.size,
};
type Target =
  | { postId: PostId; commentId?: never }
  | { commentId: PostCommentId; postId?: never };
const whereTarget = (target: Target) =>
  target.postId
    ? eq(files.postId, target.postId)
    : eq(files.commentId, target.commentId!);

/** Called only after the parent has been authorized, within its mutation transaction. */
export async function saveAttachments(
  db: Database,
  owner: PrincipalId,
  target: Target,
  ids: FileId[] | undefined,
) {
  if (ids === undefined) return;
  const rows = ids.length
    ? await db
        .select({
          id: files.id,
          uploadedById: files.uploadedById,
          source: files.source,
          postId: files.postId,
          commentId: files.commentId,
          messageId: files.messageId,
          deletedAt: files.deletedAt,
        })
        .from(files)
        .where(inArray(files.id, ids))
        .orderBy(asc(files.id))
        .for("update")
    : [];
  if (
    rows.length !== ids.length ||
    rows.some(
      (row) =>
        row.uploadedById !== owner ||
        row.source !== "portal" ||
        row.deletedAt ||
        row.messageId ||
        (row.postId && row.postId !== target.postId) ||
        (row.commentId && row.commentId !== target.commentId),
    )
  ) {
    throw new HTTPException(404, { message: "Attachment not found" });
  }
  // Deleting the reference queues its object through the existing storage trigger.
  await db
    .delete(files)
    .where(
      and(
        whereTarget(target),
        ids.length ? notInArray(files.id, ids) : undefined,
      ),
    );
  if (ids.length)
    await db
      .update(files)
      .set({ ...target, attachedAt: new Date() })
      .where(inArray(files.id, ids));
}
export async function readAttachments(
  db: Database,
  targets: { postIds?: PostId[]; commentIds?: PostCommentId[] },
) {
  const conditions: SQL[] = [isNull(files.deletedAt)];
  if (targets.postIds?.length)
    conditions.push(inArray(files.postId, targets.postIds));
  else if (targets.commentIds?.length)
    conditions.push(inArray(files.commentId, targets.commentIds));
  else return [];
  return db
    .select({ ...fields, postId: files.postId, commentId: files.commentId })
    .from(files)
    .where(and(...conditions))
    .orderBy(asc(files.createdAt), asc(files.id));
}
export function attachmentFields(row: z.infer<typeof attachment>) {
  return {
    id: row.id,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
  };
}
