import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import type { TypeId } from "@kaneo/ids";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import {
  postCommentEditHistory,
  postCommentReactions,
  postComments,
  posts,
} from "../../database/quills/schema/posts";
import {
  defineQuillsRoute,
  type Database,
  type QuillsActor,
} from "../framework/define-route";
import { recordActivity } from "./activity";
import { lockMergeTarget, recount } from "./thread-counts";
import {
  findComment,
  findPost,
  loadProjects,
  notFound,
  notTest,
} from "./visibility";

const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const commentParams = z.object({
  commentId: flexibleToTypeIdSchema("post_comment"),
});
const pinParams = postParams.extend(commentParams.shape);
const content = z.string().trim().min(1).max(5000);
const errors = {
  404: "Post or comment not found",
  409: "The comment is not in the required state",
};

const reactions = z.array(
  z.object({ emoji: z.string(), count: z.number(), reacted: z.boolean() }),
);
const commentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  parentId: z.string().nullable(),
  principalId: z.string(),
  authorName: z.string().nullable(),
  content: z.string(),
  isTeamMember: z.boolean(),
  isPrivate: z.boolean(),
  moderationState: z.string(),
  createdAt: responseTimestamp,
  updatedAt: nullableResponseTimestamp,
  deletedAt: nullableResponseTimestamp,
  isRemovedByTeam: z.boolean(),
  reactions,
});

/** Reaction counts per comment, without test customers. */
async function reactionsFor(
  db: Database,
  actor: QuillsActor,
  ids: TypeId<"post_comment">[],
) {
  if (!ids.length) return [];
  return db
    .select({
      commentId: postCommentReactions.commentId,
      emoji: postCommentReactions.emoji,
      count: count(),
      reacted: sql<boolean>`bool_or(${postCommentReactions.principalId} = ${sql.param(actor.principalId, postCommentReactions.principalId)})`,
    })
    .from(postCommentReactions)
    .where(
      and(
        inArray(postCommentReactions.commentId, ids),
        notTest(postCommentReactions.principalId),
      ),
    )
    .groupBy(postCommentReactions.commentId, postCommentReactions.emoji)
    .orderBy(asc(postCommentReactions.emoji));
}

/** Comments in the response shape. A deleted comment keeps its place in the thread but not its text. */
async function loadComments(
  db: Database,
  actor: QuillsActor,
  where: SQL,
  page = { offset: 0, limit: 1 },
) {
  const rows = await db
    .select({
      id: postComments.id,
      postId: postComments.postId,
      parentId: postComments.parentId,
      principalId: postComments.principalId,
      authorName: principal.displayName,
      content: postComments.content,
      isTeamMember: postComments.isTeamMember,
      isPrivate: postComments.isPrivate,
      moderationState: postComments.moderationState,
      createdAt: postComments.createdAt,
      updatedAt: postComments.updatedAt,
      deletedAt: postComments.deletedAt,
      deletedByPrincipalId: postComments.deletedByPrincipalId,
    })
    .from(postComments)
    .leftJoin(principal, eq(principal.id, postComments.principalId))
    .where(where)
    .orderBy(asc(postComments.createdAt), asc(postComments.id))
    .offset(page.offset)
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const counts = await reactionsFor(
    db,
    actor,
    items.map((row) => row.id),
  );
  return {
    items: items.map(({ deletedByPrincipalId, ...row }) => ({
      ...row,
      content: row.deletedAt ? "" : row.content,
      isRemovedByTeam:
        !!row.deletedAt &&
        !!deletedByPrincipalId &&
        deletedByPrincipalId !== row.principalId,
      reactions: counts
        .filter((reaction) => reaction.commentId === row.id)
        .map(({ emoji, count, reacted }) => ({ emoji, count, reacted })),
    })),
    nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
  };
}

const loadComment = async (
  db: Database,
  actor: QuillsActor,
  id: TypeId<"post_comment">,
) => (await loadComments(db, actor, eq(postComments.id, id))).items[0]!;

/**
 * Moves the post's comment count, and recounts `target`, the post it is merged into, which the
 * caller locked with lockMergeTarget before its first write. Private and held comments, and
 * comments by or on test customers, never count, as in the source.
 */
async function countComment(
  db: Database,
  comment: {
    postId: TypeId<"post">;
    principalId: TypeId<"principal">;
    isPrivate: boolean;
    moderationState: string;
  },
  delta: 1 | -1,
  target: TypeId<"post"> | null,
) {
  if (comment.isPrivate || comment.moderationState === "pending") return;
  await db
    .update(posts)
    .set({ commentCount: sql`greatest(0, ${posts.commentCount} + ${delta})` })
    .where(
      and(
        eq(posts.id, comment.postId),
        notTest(posts.principalId),
        notTest(comment.principalId),
      ),
    );
  if (target) await recount(db, target);
}

const commentEvent =
  (type: "comment.created" | "comment.deleted" | "comment.restored") =>
  (_input: unknown, result: { id: string; postId: string }) => ({
    type,
    entityType: "comment" as const,
    entityId: result.id,
    payload: { postId: result.postId },
  });

const listComments = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/comments",
  operationId: "listQuillsPostComments",
  summary: "List a post's comments, oldest first",
  description:
    "A flat list; `parentId` builds the thread. Internal comments are marked `isPrivate`. Deleted comments keep their place without their text.",
  action: "read",
  params: postParams,
  query: z.object({
    offset: pagingNumber(0, 1000000, 0),
    limit: pagingNumber(1, 100, 100),
  }),
  response: z.object({
    items: z.array(commentSchema),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Comments",
  errors,
  load: loadProjects,
  handler: async ({ db, actor, params, query, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    return loadComments(db, actor, eq(postComments.postId, post.id), query);
  },
});

const getComment = defineQuillsRoute({
  method: "get",
  path: "/comments/{commentId}",
  operationId: "getQuillsComment",
  summary: "Get a comment",
  action: "read",
  params: commentParams,
  response: commentSchema,
  responseDescription: "Comment",
  errors,
  load: loadProjects,
  handler: async ({ db, actor, params, loaded: projects }) => {
    await findComment(db, params.commentId, projects);
    return loadComment(db, actor, params.commentId);
  },
});

const createComment = defineQuillsRoute({
  method: "post",
  path: "/posts/{postId}/comments",
  operationId: "createQuillsComment",
  summary: "Comment on a post",
  description:
    "The caller is the author. A reply to an internal comment is internal too. The parent must be a comment of the same post.",
  action: "create",
  params: postParams,
  body: z.object({
    content,
    parentId: flexibleToTypeIdSchema("post_comment").nullable().optional(),
    isPrivate: z.boolean().default(false),
  }),
  response: commentSchema,
  responseDescription: "Created comment",
  errors,
  event: commentEvent("comment.created"),
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    const parent = body.parentId
      ? await findComment(db, body.parentId, projects, true)
      : undefined;
    if (parent && parent.postId !== post.id) throw notFound("Parent comment");
    // Before the insert, which takes a key-share lock on the post.
    const target = await lockMergeTarget(db, post.id);
    const [comment] = await db
      .insert(postComments)
      .values({
        postId: post.id,
        parentId: parent?.id ?? null,
        principalId: actor.principalId,
        content: body.content,
        isTeamMember: true,
        isPrivate: body.isPrivate || !!parent?.isPrivate,
      })
      .returning();
    await countComment(db, comment!, 1, target);
    return loadComment(db, actor, comment!.id);
  },
});

const updateComment = defineQuillsRoute({
  method: "patch",
  path: "/comments/{commentId}",
  operationId: "updateQuillsComment",
  summary: "Edit a comment",
  description:
    "Keeps the previous text in the edit history with the editor, so an edit of another author's comment is recorded as a moderation edit.",
  action: "update",
  params: commentParams,
  body: z.object({ content }),
  response: commentSchema,
  responseDescription: "Updated comment",
  errors,
  event: ({ params }, result) => ({
    type: "comment.updated",
    entityType: "comment",
    entityId: params.commentId,
    payload: { postId: result.postId },
  }),
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    const comment = await findComment(db, params.commentId, projects);
    await db.insert(postCommentEditHistory).values({
      commentId: comment.id,
      editorPrincipalId: actor.principalId,
      previousContent: comment.content,
      previousContentJson: comment.contentJson,
    });
    await db
      .update(postComments)
      // Rich content from the source no longer matches edited text.
      .set({ content: body.content, contentJson: null, updatedAt: new Date() })
      .where(eq(postComments.id, comment.id));
    return loadComment(db, actor, comment.id);
  },
});

const deleteComment = defineQuillsRoute({
  method: "delete",
  path: "/comments/{commentId}",
  operationId: "deleteQuillsComment",
  summary: "Delete a comment",
  description:
    "Soft delete. Needs the update action; another person's comment also needs the delete action. A pinned comment is unpinned.",
  action: "update",
  callerActions: true,
  params: commentParams,
  response: commentSchema,
  responseDescription: "Deleted comment",
  errors,
  event: commentEvent("comment.deleted"),
  load: loadProjects,
  handler: async ({ db, actor, params, loaded: projects, actions }) => {
    const comment = await findComment(db, params.commentId, projects);
    if (comment.principalId !== actor.principalId && !actions.has("delete"))
      throw new HTTPException(403, {
        message: "Deleting another person's comment needs the delete action",
      });
    const target = await lockMergeTarget(db, comment.postId);
    // The state in WHERE makes the second of two parallel deletes a 404, so the count moves once.
    const [row] = await db
      .update(postComments)
      .set({ deletedAt: new Date(), deletedByPrincipalId: actor.principalId })
      .where(
        and(eq(postComments.id, comment.id), isNull(postComments.deletedAt)),
      )
      .returning({ id: postComments.id });
    if (!row) throw notFound("Comment");
    await db
      .update(posts)
      .set({ pinnedCommentId: null })
      .where(
        and(
          eq(posts.id, comment.postId),
          eq(posts.pinnedCommentId, comment.id),
        ),
      );
    await countComment(db, comment, -1, target);
    await recordActivity(db, actor, comment.postId, {
      type:
        comment.principalId === actor.principalId
          ? "comment.deleted"
          : "comment.removed",
      metadata: {
        commentId: comment.id,
        commentAuthorPrincipalId: comment.principalId,
      },
    });
    return loadComment(db, actor, comment.id);
  },
});

const restoreComment = defineQuillsRoute({
  method: "post",
  path: "/comments/{commentId}/restore",
  operationId: "restoreQuillsComment",
  summary: "Restore a deleted comment",
  description: "Returns 409 when the comment is not deleted.",
  action: "delete",
  params: commentParams,
  response: commentSchema,
  responseDescription: "Restored comment",
  errors,
  event: commentEvent("comment.restored"),
  load: loadProjects,
  handler: async ({ db, actor, params, loaded: projects }) => {
    const comment = await findComment(db, params.commentId, projects, true);
    const target = await lockMergeTarget(db, comment.postId);
    const [row] = await db
      .update(postComments)
      .set({ deletedAt: null, deletedByPrincipalId: null })
      .where(
        and(eq(postComments.id, comment.id), isNotNull(postComments.deletedAt)),
      )
      .returning({ id: postComments.id });
    if (!row)
      throw new HTTPException(409, { message: "Comment is not deleted" });
    await countComment(db, comment, 1, target);
    await recordActivity(db, actor, comment.postId, {
      type: "comment.restored",
      metadata: {
        commentId: comment.id,
        commentAuthorPrincipalId: comment.principalId,
      },
    });
    return loadComment(db, actor, comment.id);
  },
});

const pin = <M extends "put" | "delete">(method: M) =>
  defineQuillsRoute({
    method,
    path: "/posts/{postId}/pinned-comment/{commentId}",
    operationId:
      method === "put" ? "setQuillsCommentPin" : "removeQuillsCommentPin",
    summary:
      method === "put"
        ? "Pin a comment as the post's official response"
        : "Unpin a post's pinned comment",
    description:
      method === "put"
        ? "Only a public, root-level teammate comment can be pinned (409 otherwise). It replaces the current pin."
        : "`changed` is false when this comment is not the pinned one.",
    action: "update",
    params: pinParams,
    response: z.object({ changed: z.boolean() }),
    responseDescription: "Pin result",
    errors,
    event: ({ params }, result) =>
      result.changed && {
        type: method === "put" ? "comment.pinned" : "comment.unpinned",
        entityType: "comment",
        entityId: params.commentId,
        payload: { postId: params.postId },
      },
    load: loadProjects,
    handler: async ({ db, actor, params, loaded: projects }) => {
      const post = await findPost(db, params.postId, projects);
      // A deleted comment can still be unpinned, never pinned.
      const comment = await findComment(
        db,
        params.commentId,
        projects,
        method === "delete",
      );
      if (comment.postId !== post.id) throw notFound("Comment");
      if (method === "delete") {
        const unpinned = await db
          .update(posts)
          .set({ pinnedCommentId: null })
          .where(
            and(eq(posts.id, post.id), eq(posts.pinnedCommentId, comment.id)),
          )
          .returning({ id: posts.id });
        if (!unpinned.length) return { changed: false };
        await recordActivity(db, actor, post.id, { type: "comment.unpinned" });
        return { changed: true };
      }
      if (comment.parentId || !comment.isTeamMember || comment.isPrivate)
        throw new HTTPException(409, {
          message: "Only a public, root-level teammate comment can be pinned",
        });
      const pinned = await db
        .update(posts)
        .set({ pinnedCommentId: comment.id })
        .where(
          and(
            eq(posts.id, post.id),
            or(
              isNull(posts.pinnedCommentId),
              ne(posts.pinnedCommentId, comment.id),
            ),
          ),
        )
        .returning({ id: posts.id });
      if (!pinned.length) return { changed: false };
      await recordActivity(db, actor, post.id, {
        type: "comment.pinned",
        metadata: { commentId: comment.id },
      });
      return { changed: true };
    },
  });

// One emoji, never free text: the source's shape check. MCP and the API accept any single emoji.
const element = String.raw`\p{Extended_Pictographic}[\u{1F3FB}-\u{1F3FF}]?[\u{FE0E}\u{FE0F}]?`;
const single = [
  new RegExp(`^${element}(?:\\u200D${element})*$`, "u"),
  /^\p{Regional_Indicator}{2}$/u,
  /^\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}$/u,
  /^[0-9#*]\u{FE0F}?\u{20E3}$/u,
];
const isEmoji = (value: string) => single.some((shape) => shape.test(value));

const reaction = <M extends "put" | "delete">(method: M) =>
  defineQuillsRoute({
    method,
    path: "/comments/{commentId}/reactions",
    operationId:
      method === "put"
        ? "setQuillsCommentReaction"
        : "removeQuillsCommentReaction",
    summary:
      method === "put"
        ? "Add the caller's emoji reaction to a comment"
        : "Remove the caller's emoji reaction from a comment",
    description:
      method === "put"
        ? "Idempotent. `emoji` is one emoji."
        : "Idempotent. Accepts any stored value, so older reactions can be removed.",
    action: "update",
    params: commentParams,
    query: z.object({
      emoji:
        method === "put"
          ? z
              .string()
              .min(1)
              .max(32)
              .refine(isEmoji, "A reaction must be a single emoji")
          : z.string().min(1).max(32),
    }),
    response: z.object({ changed: z.boolean(), reactions }),
    responseDescription: "Reaction result",
    errors,
    event: ({ params, query }, result) =>
      result.changed && {
        type: method === "put" ? "comment.reacted" : "comment.unreacted",
        entityType: "comment",
        entityId: params.commentId,
        payload: { emoji: query.emoji },
      },
    load: loadProjects,
    handler: async ({ db, actor, params, query, loaded: projects }) => {
      const comment = await findComment(db, params.commentId, projects);
      const key = and(
        eq(postCommentReactions.commentId, comment.id),
        eq(postCommentReactions.principalId, actor.principalId),
        eq(postCommentReactions.emoji, query.emoji),
      );
      const rows =
        method === "put"
          ? await db
              .insert(postCommentReactions)
              .values({
                commentId: comment.id,
                principalId: actor.principalId,
                emoji: query.emoji,
              })
              .onConflictDoNothing()
              .returning({ id: postCommentReactions.id })
          : await db
              .delete(postCommentReactions)
              .where(key)
              .returning({ id: postCommentReactions.id });
      const counts = await reactionsFor(db, actor, [comment.id]);
      return {
        changed: rows.length > 0,
        reactions: counts.map(({ emoji, count, reacted }) => ({
          emoji,
          count,
          reacted,
        })),
      };
    },
  });

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listComments)
  .openapi(...getComment)
  .openapi(...createComment)
  .openapi(...updateComment)
  .openapi(...deleteComment)
  .openapi(...restoreComment)
  .openapi(...pin("put"))
  .openapi(...pin("delete"))
  .openapi(...reaction("put"))
  .openapi(...reaction("delete"));
