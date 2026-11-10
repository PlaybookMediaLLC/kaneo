import { and, count, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PostCommentId, PostId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { postComments, posts } from "../../database/quills/schema/posts";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { page, pageQuery } from "./schemas";
import { readSettingsKey, writeSettingsKey } from "./settings-json";
import {
  boardVisible,
  loadProjects,
  notTest,
  onVisibleBoard,
  visiblePost,
} from "./visibility";

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const commentParams = z.object({
  commentId: flexibleToTypeIdSchema("post_comment"),
});
const reject = z.object({
  reason: z
    .string()
    .trim()
    .max(500)
    .openapi({ description: "Kept in the audit log; may be empty" }),
});
const done = z.object({ id: z.string() });
const requireApproval = z.enum(["none", "anonymous", "authenticated", "all"]);
const moderationDefault = z.object({
  requireApproval,
  holdImages: z.boolean(),
  holdLinks: z.boolean(),
});
const DEFAULT: z.output<typeof moderationDefault> = {
  requireApproval: "none",
  holdImages: false,
  holdLinks: false,
};
const resolveDefault = (value: unknown) => ({
  ...DEFAULT,
  ...moderationDefault.partial().safeParse(value).data,
});
const notPending = (what: string) =>
  new HTTPException(409, { message: `${what} is not awaiting review` });
const reasonPayload = ({
  body,
}: {
  body: { reason: string };
}): Record<string, string> => (body.reason ? { reason: body.reason } : {});

/** Locks a pending post on a visible live board. Test-customer posts can be moderated by ID, as in the source. */
async function lockPendingPost(db: Db, id: PostId, projects: string[]) {
  const [post] = await db
    .select({ state: posts.moderationState })
    .from(posts)
    .where(
      and(eq(posts.id, id), isNull(posts.deletedAt), onVisibleBoard(projects)),
    )
    .for("update");
  if (!post) throw new HTTPException(404, { message: "Post not found" });
  if (post.state !== "pending") throw notPending("Post");
}

/** Locks a pending comment whose post is live and on a visible live board. */
async function lockPendingComment(
  db: Db,
  id: PostCommentId,
  projects: string[],
) {
  // No join: Postgres rejects the schema-qualified FOR UPDATE OF that a joined lock needs.
  const ofPost = (condition: SQL) =>
    sql`exists (select 1 from ${posts} where ${eq(posts.id, postComments.postId)} and ${condition})`;
  const [comment] = await db
    .select({
      state: postComments.moderationState,
      postId: postComments.postId,
      // Test-customer content stays out of public counts.
      counted: sql<boolean>`(not ${postComments.isPrivate} and ${notTest(postComments.principalId)} and ${ofPost(notTest(posts.principalId))})`,
    })
    .from(postComments)
    .where(
      and(
        eq(postComments.id, id),
        isNull(postComments.deletedAt),
        ofPost(and(isNull(posts.deletedAt), onVisibleBoard(projects))!),
      ),
    )
    .for("update");
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });
  if (comment.state !== "pending") throw notPending("Comment");
  return comment;
}

const listPending = defineQuillsRoute({
  method: "get",
  path: "/moderation/pending",
  operationId: "listQuillsPendingModeration",
  summary: "List posts or comments that wait for review",
  description:
    "Newest first. Only content that the caller may see: deleted, test-customer and hidden-board content is left out.",
  action: "read",
  query: z.object({
    type: z.enum(["post", "comment"]).default("post"),
    ...pageQuery,
  }),
  load: loadProjects,
  response: z.object({
    posts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        content: z.string(),
        createdAt: responseTimestamp,
        boardId: z.string(),
        boardName: z.string(),
        authorName: z.string().nullable(),
      }),
    ),
    comments: z.array(
      z.object({
        id: z.string(),
        content: z.string(),
        createdAt: responseTimestamp,
        postId: z.string(),
        postTitle: z.string(),
        boardName: z.string(),
        boardSlug: z.string(),
        authorName: z.string().nullable(),
      }),
    ),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of the requested queue",
  handler: async ({ db, query, loaded }) => {
    if (query.type === "post") {
      const { items, nextOffset } = page(
        await db
          .select({
            id: posts.id,
            title: posts.title,
            content: posts.content,
            createdAt: posts.createdAt,
            boardId: boards.id,
            boardName: boards.name,
            authorName: principal.displayName,
          })
          .from(posts)
          .innerJoin(boards, eq(boards.id, posts.boardId))
          .leftJoin(principal, eq(principal.id, posts.principalId))
          .where(and(eq(posts.moderationState, "pending"), visiblePost(loaded)))
          .orderBy(desc(posts.createdAt), desc(posts.id))
          .offset(query.offset)
          .limit(query.limit + 1),
        query,
      );
      return { posts: items, comments: [], nextOffset };
    }
    const { items, nextOffset } = page(
      await db
        .select({
          id: postComments.id,
          content: postComments.content,
          createdAt: postComments.createdAt,
          postId: posts.id,
          postTitle: posts.title,
          boardName: boards.name,
          boardSlug: boards.slug,
          authorName: principal.displayName,
        })
        .from(postComments)
        .innerJoin(posts, eq(posts.id, postComments.postId))
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .leftJoin(principal, eq(principal.id, postComments.principalId))
        .where(
          and(
            eq(postComments.moderationState, "pending"),
            isNull(postComments.deletedAt),
            notTest(postComments.principalId),
            visiblePost(loaded),
          ),
        )
        .orderBy(desc(postComments.createdAt), desc(postComments.id))
        .offset(query.offset)
        .limit(query.limit + 1),
      query,
    );
    return { posts: [], comments: items, nextOffset };
  },
});

const getStatus = defineQuillsRoute({
  method: "get",
  path: "/moderation/status",
  operationId: "getQuillsModerationStatus",
  summary: "Get whether moderation is in use and how much waits for review",
  action: "read",
  load: loadProjects,
  response: z.object({ enabled: z.boolean(), pendingCount: z.number() }),
  responseDescription:
    "Moderation status over the content that the caller may see",
  handler: async ({ db, loaded }) => {
    const [pendingPosts] = await db
      .select({ n: count() })
      .from(posts)
      .where(and(eq(posts.moderationState, "pending"), visiblePost(loaded)));
    const [pendingComments] = await db
      .select({ n: count() })
      .from(postComments)
      .innerJoin(posts, eq(posts.id, postComments.postId))
      .where(
        and(
          eq(postComments.moderationState, "pending"),
          isNull(postComments.deletedAt),
          notTest(postComments.principalId),
          visiblePost(loaded),
        ),
      );
    const [gated] = await db
      .select({ n: count() })
      .from(boards)
      .where(
        and(
          boardVisible(loaded),
          sql`'on' in (${boards.access}->'moderation'->>'anonPosts', ${boards.access}->'moderation'->>'signedPosts', ${boards.access}->'moderation'->>'comments')`,
        ),
      );
    const defaults = resolveDefault(
      await readSettingsKey(db, "portalConfig", "moderationDefault"),
    );
    const pendingCount = pendingPosts!.n + pendingComments!.n;
    return {
      enabled:
        defaults.requireApproval !== "none" ||
        defaults.holdImages ||
        defaults.holdLinks ||
        pendingCount > 0 ||
        gated!.n > 0,
      pendingCount,
    };
  },
});

const approvePost = defineQuillsRoute({
  method: "post",
  path: "/moderation/posts/{postId}/approve",
  operationId: "approveQuillsPost",
  summary: "Publish a post that waits for review",
  description:
    "Records post.approved for later announcement handlers. This request sends no mail, webhook or notification.",
  action: "update",
  params: postParams,
  load: loadProjects,
  response: done,
  responseDescription: "The published post",
  errors: { 404: "Post not found", 409: "The post is not awaiting review" },
  event: ({ params }) => ({
    type: "post.approved",
    entityType: "post",
    entityId: params.postId,
  }),
  handler: async ({ db, params: { postId }, loaded }) => {
    await lockPendingPost(db, postId, loaded);
    await db
      .update(posts)
      .set({ moderationState: "published" })
      .where(eq(posts.id, postId));
    return { id: postId };
  },
});

// Rejection soft-deletes the post and keeps it pending, so a restore returns it to the queue.
const rejectPost = defineQuillsRoute({
  method: "post",
  path: "/moderation/posts/{postId}/reject",
  operationId: "rejectQuillsPost",
  summary: "Reject a post that waits for review",
  action: "update",
  params: postParams,
  body: reject,
  load: loadProjects,
  response: done,
  responseDescription: "The rejected post",
  errors: { 404: "Post not found", 409: "The post is not awaiting review" },
  event: (input) => ({
    type: "post.rejected",
    entityType: "post",
    entityId: input.params.postId,
    payload: reasonPayload(input),
  }),
  handler: async ({ db, params: { postId }, loaded }) => {
    await lockPendingPost(db, postId, loaded);
    await db
      .update(posts)
      .set({ deletedAt: new Date() })
      .where(eq(posts.id, postId));
    return { id: postId };
  },
});

const approveComment = defineQuillsRoute({
  method: "post",
  path: "/moderation/comments/{commentId}/approve",
  operationId: "approveQuillsComment",
  summary: "Publish a comment that waits for review",
  description:
    "Also counts a public comment on its post, and on the canonical post of a merged post.",
  action: "update",
  params: commentParams,
  load: loadProjects,
  response: done,
  responseDescription: "The published comment",
  errors: {
    404: "Comment not found",
    409: "The comment is not awaiting review",
  },
  event: ({ params }) => ({
    type: "comment.approved",
    entityType: "comment",
    entityId: params.commentId,
  }),
  handler: async ({ db, params: { commentId }, loaded }) => {
    const comment = await lockPendingComment(db, commentId, loaded);
    await db
      .update(postComments)
      .set({ moderationState: "published" })
      .where(eq(postComments.id, commentId));
    if (comment.counted) {
      const [post] = await db
        .update(posts)
        .set({ commentCount: sql`${posts.commentCount} + 1` })
        .where(eq(posts.id, comment.postId))
        .returning({ canonicalPostId: posts.canonicalPostId });
      // A merged post's comments also count on its canonical post.
      if (post?.canonicalPostId)
        await db
          .update(posts)
          .set({ commentCount: sql`${posts.commentCount} + 1` })
          .where(eq(posts.id, post.canonicalPostId));
    }
    return { id: commentId };
  },
});

const rejectComment = defineQuillsRoute({
  method: "post",
  path: "/moderation/comments/{commentId}/reject",
  operationId: "rejectQuillsComment",
  summary: "Reject a comment that waits for review",
  action: "update",
  params: commentParams,
  body: reject,
  load: loadProjects,
  response: done,
  responseDescription: "The rejected comment",
  errors: {
    404: "Comment not found",
    409: "The comment is not awaiting review",
  },
  event: (input) => ({
    type: "comment.rejected",
    entityType: "comment",
    entityId: input.params.commentId,
    payload: reasonPayload(input),
  }),
  handler: async ({ db, params: { commentId }, loaded }) => {
    await lockPendingComment(db, commentId, loaded);
    await db
      .update(postComments)
      .set({ deletedAt: new Date() })
      .where(eq(postComments.id, commentId));
    return { id: commentId };
  },
});

const setDefault = defineQuillsRoute({
  method: "put",
  path: "/moderation/default",
  operationId: "setQuillsModerationDefault",
  summary: "Set the workspace moderation default",
  description:
    "Changes only portalConfig.moderationDefault; other portal settings stay as stored.",
  action: "manage_settings",
  body: z.object({
    requireApproval,
    holdImages: z.boolean().optional(),
    holdLinks: z.boolean().optional(),
  }),
  response: z.object({ moderationDefault }),
  responseDescription: "The stored moderation default",
  errors: { 409: "Stored settings are not a JSON object" },
  event: (_input, result) => ({
    type: "settings.moderation_updated",
    entityType: "settings",
    entityId: "moderation",
    payload: { requireApproval: result.moderationDefault.requireApproval },
  }),
  handler: async ({ db, body }) => ({
    moderationDefault: await writeSettingsKey(
      db,
      "portalConfig",
      "moderationDefault",
      (current) => {
        const stored = resolveDefault(current);
        return {
          requireApproval: body.requireApproval,
          holdImages: body.holdImages ?? stored.holdImages,
          holdLinks: body.holdLinks ?? stored.holdLinks,
        };
      },
    ),
  }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listPending)
  .openapi(...getStatus)
  .openapi(...approvePost)
  .openapi(...rejectPost)
  .openapi(...approveComment)
  .openapi(...rejectComment)
  .openapi(...setDefault);
