import {
  attachment,
  attachmentIds,
  attachmentFields,
  readAttachments,
  saveAttachments,
} from "./attachments";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PostCommentId, PostId, PrincipalId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  responseTimestamp,
  z,
} from "../../../openapi";
import { principal } from "../../../database/quills/schema/auth";
import { FEEDBACK_REACTION_EMOJIS } from "../../../database/quills/types";
import {
  postCommentEditHistory,
  postCommentReactions,
  postComments,
  posts,
} from "../../../database/quills/schema/posts";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { notFound, notTest } from "../../feedback/visibility";
import { claimReceipt } from "./receipts";
import {
  activity,
  capabilities,
  commentVisible,
  findPost,
  forbidden,
  held,
  httpUrl,
  postVisible,
  principalOf,
  title,
  viewerFor,
  visibleBoards,
  type Board,
  type Customer,
  type Viewer,
} from "./viewer";

// Customer comment routes, declared with audience: "portal" here and audience: "widget" in
// ../../widget/feedback. Private (internal) comments, other people's held comments and
// test-customer comments never reach a customer. A deleted comment keeps its place without text.

const MAX_DEPTH = 10;
const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const commentParams = z.object({
  commentId: flexibleToTypeIdSchema("post_comment"),
});
const content = z.string().trim().min(1).max(5000);
const errors = {
  403: "Blocked account, no portal access, or the action is not allowed",
  404: "Post or comment not found",
};

const reactions = z.array(
  z.object({ emoji: z.string(), count: z.number(), reacted: z.boolean() }),
);
const comment = z.object({
  attachments: z.array(attachment),
  id: z.string(),
  parentId: z.string().nullable(),
  content: z.string(),
  author: z.object({
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    isTeamMember: z.boolean(),
  }),
  isAuthor: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  pending: z.boolean(),
  deleted: z.boolean(),
  createdAt: responseTimestamp,
  updatedAt: nullableResponseTimestamp,
  reactions,
});

/** Reaction counts per comment without test customers, and whether the caller reacted. */
async function reactionsFor(
  db: Database,
  viewer: Viewer,
  ids: PostCommentId[],
) {
  if (!ids.length) return [];
  return db
    .select({
      commentId: postCommentReactions.commentId,
      emoji: postCommentReactions.emoji,
      count: count(),
      reacted: viewer.principalId
        ? sql<boolean>`bool_or(${postCommentReactions.principalId} = ${sql.param(viewer.principalId, postCommentReactions.principalId)})`
        : sql<boolean>`false`,
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

const reactionList = (
  counts: Awaited<ReturnType<typeof reactionsFor>>,
  id: string,
) =>
  counts
    .filter((r) => r.commentId === id)
    .map(({ emoji, count, reacted }) => ({ emoji, count, reacted }));

/** Shared with mutation authorization so hidden team notes never change public capabilities. */
async function commentsWithTeamReplies(db: Database, ids: PostCommentId[]) {
  if (!ids.length) return new Set<PostCommentId>();
  const replies = await db
    .select({ parentId: postComments.parentId })
    .from(postComments)
    .where(
      and(
        inArray(postComments.parentId, ids),
        eq(postComments.isTeamMember, true),
        eq(postComments.isPrivate, false),
        eq(postComments.moderationState, "published"),
        isNull(postComments.deletedAt),
      ),
    );
  return new Set(replies.map((reply) => reply.parentId));
}

async function loadComments(
  db: Database,
  viewer: Viewer,
  where: SQL,
  page = { offset: 0, limit: 1 },
) {
  const rows = await db
    .select({
      id: postComments.id,
      parentId: postComments.parentId,
      principalId: postComments.principalId,
      content: postComments.content,
      isTeamMember: postComments.isTeamMember,
      moderationState: postComments.moderationState,
      createdAt: postComments.createdAt,
      updatedAt: postComments.updatedAt,
      deletedAt: postComments.deletedAt,
      authorName: principal.displayName,
      authorType: principal.type,
      authorAvatar: principal.avatarUrl,
    })
    .from(postComments)
    .leftJoin(principal, eq(principal.id, postComments.principalId))
    .where(and(where, commentVisible(viewer)))
    .orderBy(asc(postComments.createdAt), asc(postComments.id))
    .offset(page.offset)
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const replied = await commentsWithTeamReplies(
    db,
    items.map((row) => row.id),
  );
  const counts = await reactionsFor(
    db,
    viewer,
    items.map((row) => row.id),
  );
  const attachments = await readAttachments(db, {
    commentIds: items.filter((row) => !row.deletedAt).map((row) => row.id),
  });
  return {
    items: items.map((row) => {
      const hidden = !!row.deletedAt || row.authorType === "anonymous";
      const isAuthor =
        !row.deletedAt &&
        !!viewer.principalId &&
        row.principalId === viewer.principalId;
      const canChange = isAuthor && !replied.has(row.id);
      return {
        id: row.id,
        parentId: row.parentId,
        attachments: attachments
          .filter((file) => file.commentId === row.id)
          .map(attachmentFields),
        content: row.deletedAt ? "" : row.content,
        author: {
          name: hidden ? null : (row.authorName ?? null),
          avatarUrl: hidden ? null : httpUrl(row.authorAvatar),
          isTeamMember: row.isTeamMember,
        },
        isAuthor,
        canEdit: canChange,
        canDelete: canChange,
        pending: row.moderationState === "pending",
        deleted: !!row.deletedAt,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        reactions: row.deletedAt ? [] : reactionList(counts, row.id),
      };
    }),
    nextOffset: rows.length > page.limit ? page.offset + page.limit : null,
  };
}

/** One comment in the response shape; 404 when the caller cannot see it. */
async function loadComment(db: Database, viewer: Viewer, id: PostCommentId) {
  const [found] = (await loadComments(db, viewer, eq(postComments.id, id)))
    .items;
  if (!found) throw notFound("Comment");
  return found;
}

/** A live comment that the caller may see, on a post it may see. 404 otherwise. */
async function findComment(
  db: Database,
  viewer: Viewer,
  boardList: Board[],
  id: PostCommentId,
) {
  const [row] = await db
    .select({
      id: postComments.id,
      postId: postComments.postId,
      principalId: postComments.principalId,
      content: postComments.content,
      contentJson: postComments.contentJson,
      isPrivate: postComments.isPrivate,
      moderationState: postComments.moderationState,
      boardId: posts.boardId,
    })
    .from(postComments)
    .innerJoin(posts, eq(posts.id, postComments.postId))
    .where(
      and(
        eq(postComments.id, id),
        isNull(postComments.deletedAt),
        commentVisible(viewer),
        postVisible(
          viewer,
          boardList.map((b) => b.id),
        ),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Comment");
  return { ...row, board: boardList.find((b) => b.id === row.boardId)! };
}

/** Moves the post's public comment count, as the teammate path does. */
async function countComment(
  db: Database,
  postId: PostId,
  author: PrincipalId,
  delta: 1 | -1,
) {
  await db
    .update(posts)
    .set({ commentCount: sql`greatest(0, ${posts.commentCount} + ${delta})` })
    .where(
      and(eq(posts.id, postId), notTest(posts.principalId), notTest(author)),
    );
}

/**
 * The author's own comment while no teammate has replied to it (the source's rule). Only a
 * public, published reply counts, so a refusal never shows that a private note exists.
 */
async function ownComment(
  db: Database,
  viewer: Viewer,
  boardList: Board[],
  id: PostCommentId,
  verb: "edit" | "delete",
) {
  await db
    .select({ id: postComments.id })
    .from(postComments)
    .where(eq(postComments.id, id))
    .for("update");
  const found = await findComment(db, viewer, boardList, id);
  if (found.principalId !== viewer.principalId)
    throw forbidden(`You can only ${verb} your own comments`);
  if ((await commentsWithTeamReplies(db, [found.id])).has(found.id))
    throw forbidden(
      `Comments with a team reply cannot be ${verb === "edit" ? "edited" : "deleted"}`,
    );
  return found;
}

export const listComments = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/posts/{postId}/comments`,
    operationId: `listQuills${title(audience)}PostComments`,
    summary: "List a post's public comments, oldest first",
    description:
      "A flat list; parentId builds the thread. The caller's own held comments are marked pending. A deleted comment has empty content and no author.",
    action: "read",
    params: postParams,
    query: z.object({
      offset: pagingNumber(0, 1000000, 0),
      limit: pagingNumber(1, 100, 100),
    }),
    response: z.object({
      items: z.array(comment),
      nextOffset: z.number().nullable(),
    }),
    responseDescription: "Comments",
    errors,
    handler: async ({ db, caller, params, query }) => {
      const viewer = await viewerFor(db, audience, caller);
      const boardList = await visibleBoards(db, viewer);
      const post = await findPost(db, viewer, boardList, params.postId);
      return loadComments(db, viewer, eq(postComments.postId, post.id), query);
    },
  });

export const createComment = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    ensureCustomer: audience === "portal",
    method: "post",
    path: `/${audience}/posts/{postId}/comments`,
    operationId: `createQuills${title(audience)}Comment`,
    summary: "Comment on a post",
    description: `Plain text. The parent is a live comment of the same post that the caller can see; replies nest at most ${MAX_DEPTH} levels (409). Locked, merged and author-only threads are 403 for others. A held comment waits for review and does not count until approved. idempotencyKey returns the first comment for a repeated request.`,
    action: "create",
    rateLimit: { limit: 30, windowSeconds: 600 },
    params: postParams,
    body: z.object({
      content,
      attachmentIds,
      parentId: flexibleToTypeIdSchema("post_comment").optional(),
      idempotencyKey: z.string().min(1).max(128).optional(),
    }),
    response: comment.extend({ postId: z.string(), replayed: z.boolean() }),
    responseDescription: "The created comment",
    errors: { ...errors, 409: "Idempotency key reused or thread too deep" },
    event: (_input, result) =>
      !result.replayed && {
        type: "comment.created",
        entityType: "comment",
        entityId: result.id,
        payload: { postId: result.postId },
      },
    handler: async ({ db, caller, params, body }) => {
      const viewer = await viewerFor(db, audience, caller);
      const me = principalOf(viewer);
      const boardList = await visibleBoards(db, viewer);
      const post = await findPost(db, viewer, boardList, params.postId);
      if (!capabilities(viewer, post.board.access).canComment)
        throw forbidden("Comments are not open to you on this board");
      if (post.board.access.authorOnly && post.principalId !== me)
        throw forbidden(
          "Only the post author and the team can reply on this board",
        );
      if (post.isCommentsLocked)
        throw forbidden("Comments are locked on this post");
      if (post.canonicalPostId)
        throw forbidden("This post was merged into another post");
      if (body.parentId) {
        const parent = await findComment(db, viewer, boardList, body.parentId);
        if (parent.postId !== post.id) throw notFound("Parent comment");
        const depth = await db.execute<{ depth: number }>(
          sql`with recursive chain(id, parent_id, depth) as (
                select id, parent_id, 1 from ${postComments} where id = ${sql.param(parent.id, postComments.id)}
                union all
                select c.id, c.parent_id, chain.depth + 1 from ${postComments} c join chain on c.id = chain.parent_id
                where chain.depth <= ${MAX_DEPTH})
              select max(depth)::int as depth from chain`,
        );
        if ((depth.rows[0]?.depth ?? 0) >= MAX_DEPTH)
          throw new HTTPException(409, {
            message: `Replies nest at most ${MAX_DEPTH} levels`,
          });
      }
      const receipt = body.idempotencyKey
        ? await claimReceipt(db, "comment", me, body.idempotencyKey, {
            postId: post.id,
            parentId: body.parentId ?? null,
            content: body.content,
            ...(body.attachmentIds?.length
              ? { attachmentIds: JSON.stringify(body.attachmentIds) }
              : {}),
          })
        : null;
      // A first comment that has left the caller's sight since is 404, not a stale copy.
      if (receipt?.replayOf)
        return {
          ...(await loadComment(db, viewer, receipt.replayOf as PostCommentId)),
          postId: post.id,
          replayed: true,
        };
      const pending = held(viewer, post.board.access, "comment", body.content);
      const [row] = await db
        .insert(postComments)
        .values({
          postId: post.id,
          parentId: body.parentId ?? null,
          principalId: me,
          content: body.content,
          isTeamMember: false,
          isPrivate: false,
          moderationState: pending ? "pending" : "published",
        })
        .returning({ id: postComments.id });
      await saveAttachments(db, me, { commentId: row!.id }, body.attachmentIds);
      if (!pending) await countComment(db, post.id, me, 1);
      await receipt?.finish(row!.id);
      return {
        ...(await loadComment(db, viewer, row!.id)),
        postId: post.id,
        replayed: false,
      };
    },
  });

const editComment = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "put",
  path: "/portal/comments/{commentId}",
  operationId: "editQuillsPortalOwnComment",
  summary: "Edit the caller's own comment",
  description:
    "Only the author, and only while no teammate has replied. The previous text goes to the edit history. The new text goes through moderation again: a held edit takes the comment back to review and out of the count.",
  action: "update",
  rateLimit: { limit: 30, windowSeconds: 600 },
  params: commentParams,
  body: z.object({ content, attachmentIds }),
  response: comment.extend({ postId: z.string() }),
  responseDescription: "The edited comment",
  errors,
  event: ({ params }, result) => ({
    type: "comment.updated",
    entityType: "comment",
    entityId: params.commentId,
    payload: { postId: result.postId },
  }),
  handler: async ({ db, caller, params, body }) => {
    const viewer = await viewerFor(db, "portal", caller);
    const me = principalOf(viewer);
    const boardList = await visibleBoards(db, viewer);
    const found = await ownComment(
      db,
      viewer,
      boardList,
      params.commentId,
      "edit",
    );
    await db.insert(postCommentEditHistory).values({
      commentId: found.id,
      editorPrincipalId: me,
      previousContent: found.content,
      previousContentJson: found.contentJson,
    });
    const rehold =
      found.moderationState === "published" &&
      held(viewer, found.board.access, "comment", body.content);
    await db
      .update(postComments)
      .set({
        content: body.content,
        contentJson: null,
        ...(rehold && { moderationState: "pending" as const }),
        updatedAt: new Date(),
      })
      .where(eq(postComments.id, found.id));
    await saveAttachments(db, me, { commentId: found.id }, body.attachmentIds);
    if (rehold) await countComment(db, found.postId, me, -1);
    return {
      ...(await loadComment(db, viewer, found.id)),
      postId: found.postId,
    };
  },
});

const deleteComment = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "delete",
  path: "/portal/comments/{commentId}",
  operationId: "deleteQuillsPortalOwnComment",
  summary: "Delete the caller's own comment",
  description:
    "Soft delete, only by the author and only while no teammate has replied. Replies keep their place.",
  action: "delete",
  rateLimit: { limit: 30, windowSeconds: 600 },
  params: commentParams,
  response: z.object({ id: z.string(), postId: z.string() }),
  responseDescription: "The deleted comment",
  errors,
  event: (_input, result) => ({
    type: "comment.deleted",
    entityType: "comment",
    entityId: result.id,
    payload: { postId: result.postId },
  }),
  handler: async ({ db, caller, params }) => {
    const viewer = await viewerFor(db, "portal", caller);
    const me = principalOf(viewer);
    const boardList = await visibleBoards(db, viewer);
    const found = await ownComment(
      db,
      viewer,
      boardList,
      params.commentId,
      "delete",
    );
    await db
      .update(postComments)
      .set({ deletedAt: new Date(), deletedByPrincipalId: me })
      .where(eq(postComments.id, found.id));
    await db
      .update(posts)
      .set({ pinnedCommentId: null })
      .where(
        and(eq(posts.id, found.postId), eq(posts.pinnedCommentId, found.id)),
      );
    if (found.moderationState === "published")
      await countComment(db, found.postId, me, -1);
    await activity(db, me, found.postId, "comment.deleted", {
      commentId: found.id,
      commentAuthorPrincipalId: me,
    });
    return { id: found.id, postId: found.postId };
  },
});

export const setReaction = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    ensureCustomer: audience === "portal",
    method: "put",
    path: `/${audience}/comments/{commentId}/reactions`,
    operationId: `setQuills${title(audience)}CommentReaction`,
    summary: "Add or remove the caller's emoji reaction on a comment",
    description:
      "Desired state. Needs the board's vote tier. The widget's comment vote is the 👍 reaction.",
    action: "update",
    rateLimit: { limit: 120, windowSeconds: 600 },
    params: commentParams,
    body: z.object({
      emoji: z.enum(FEEDBACK_REACTION_EMOJIS),
      reacted: z.boolean(),
    }),
    response: z.object({
      commentId: z.string(),
      changed: z.boolean(),
      reactions,
    }),
    responseDescription: "The comment's reactions",
    errors,
    event: ({ params, body }, result) =>
      result.changed && {
        type: body.reacted ? "comment.reacted" : "comment.unreacted",
        entityType: "comment",
        entityId: params.commentId,
        payload: { emoji: body.emoji },
      },
    handler: async ({ db, caller, params, body }) => {
      const viewer = await viewerFor(db, audience, caller);
      const me = principalOf(viewer);
      const boardList = await visibleBoards(db, viewer);
      const found = await findComment(db, viewer, boardList, params.commentId);
      if (!capabilities(viewer, found.board.access).canVote)
        throw forbidden("Reactions are not open to you on this board");
      const rows = body.reacted
        ? await db
            .insert(postCommentReactions)
            .values({ commentId: found.id, principalId: me, emoji: body.emoji })
            .onConflictDoNothing()
            .returning({ id: postCommentReactions.id })
        : await db
            .delete(postCommentReactions)
            .where(
              and(
                eq(postCommentReactions.commentId, found.id),
                eq(postCommentReactions.principalId, me),
                eq(postCommentReactions.emoji, body.emoji),
              ),
            )
            .returning({ id: postCommentReactions.id });
      return {
        commentId: found.id,
        changed: rows.length > 0,
        reactions: reactionList(
          await reactionsFor(db, viewer, [found.id]),
          found.id,
        ),
      };
    },
  });

/** The routes that both audiences declare. */
export const commentRoutes = (audience: Customer) =>
  apiRouter()
    .openapi(...listComments(audience))
    .openapi(...createComment(audience))
    .openapi(...setReaction(audience));

/** Edit and delete of the caller's own comment: portal only, as in the source. */
export const ownCommentRoutes = apiRouter()
  .openapi(...editComment)
  .openapi(...deleteComment);
