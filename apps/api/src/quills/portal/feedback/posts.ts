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
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { PostId, PrincipalId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
} from "../../../openapi";
import { principal } from "../../../database/quills/schema/auth";
import { postTags } from "../../../database/quills/schema/boards";
import { postSubscriptions } from "../../../database/quills/schema/notifications";
import {
  postComments,
  postEditHistory,
  postTagAssignments,
  posts,
  postVotes,
} from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { afterCursor, randomSort, sorts } from "../../feedback/post-filters";
import { notFound, notTest, relatedPosts } from "../../feedback/visibility";
import { claimReceipt } from "./receipts";
import {
  activity,
  capabilities,
  defaultStatus,
  findPost,
  forbidden,
  held,
  httpUrl,
  postVisible,
  principalOf,
  shownVotes,
  STAGES,
  stageOf,
  title,
  viewerFor,
  visibleBoards,
  type Board,
  type Customer,
  type Viewer,
} from "./viewer";

// Customer post routes. Each shared factory is declared twice, with audience: "portal" here and
// with audience: "widget" in ../../widget/feedback. Writes keep the teammate invariants: the
// vote count moves with the vote row, held posts wait for review, and activity rows are written.

const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const errors = {
  403: "Blocked account, no portal access, or the action is not allowed",
  404: "Post or board not found",
};
const writeErrors = { ...errors, 409: "Idempotency key reused" };
const importance = z.enum(postVotes.importance.enumValues);
const voteCount = z.number().optional().openapi({
  description: "Portal: left out when the post's board hides vote counts",
});

export const postItem = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  board: z.object({ id: z.string(), name: z.string(), slug: z.string() }),
  status: z
    .object({ id: z.string(), name: z.string(), color: z.string() })
    .nullable(),
  stage: z.enum(STAGES).nullable(),
  author: z.object({
    name: z.string().nullable(),
    avatarUrl: z.string().nullable(),
    isTeamMember: z.boolean(),
  }),
  voteCount,
  commentCount: z.number(),
  pending: z
    .boolean()
    .openapi({ description: "The caller's own post that waits for review" }),
  isAuthor: z.boolean(),
  voted: z.boolean(),
  following: z.boolean(),
  tags: z.array(
    z.object({ id: z.string(), name: z.string(), color: z.string() }),
  ),
  createdAt: responseTimestamp,
});
const postDetail = postItem.extend({
  attachments: z.array(attachment),
  canVote: z.boolean(),
  canComment: z.boolean(),
  canEdit: z.boolean(),
  canDelete: z.boolean(),
  isCommentsLocked: z.boolean(),
  authorOnlyReplies: z.boolean(),
  mergedInto: z.object({ id: z.string(), title: z.string() }).nullable(),
  importance: importance.nullable().openapi({
    description:
      "How much the caller needs the post, when the caller voted and said so",
  }),
});

const fields = {
  id: posts.id,
  boardId: posts.boardId,
  title: posts.title,
  content: posts.content,
  principalId: posts.principalId,
  voteCount: posts.voteCount,
  commentCount: posts.commentCount,
  moderationState: posts.moderationState,
  createdAt: posts.createdAt,
  authorName: principal.displayName,
  authorType: principal.type,
  authorAvatar: principal.avatarUrl,
  authorTeammate: principal.kaneoUserId,
  statusId: postStatuses.id,
  statusName: postStatuses.name,
  statusColor: postStatuses.color,
  statusSlug: postStatuses.slug,
  statusCategory: postStatuses.category,
};

const selectPosts = (db: Database, where: SQL | undefined) =>
  db
    .select(fields)
    .from(posts)
    .leftJoin(principal, eq(principal.id, posts.principalId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .where(where)
    .$dynamic();
type Row = Awaited<
  ReturnType<ReturnType<typeof selectPosts>["execute"]>
>[number];

/** The caller's votes on these posts, counted on the post a merged post points to. */
async function votedOf(db: Database, viewer: Viewer, ids: PostId[]) {
  if (!viewer.principalId || !ids.length) return new Set<string>();
  const rows = await db
    .select({ id: posts.id, canonical: posts.canonicalPostId })
    .from(postVotes)
    .innerJoin(posts, eq(posts.id, postVotes.postId))
    .where(
      and(
        eq(postVotes.principalId, viewer.principalId),
        isNull(posts.deletedAt),
        or(inArray(posts.id, ids), inArray(posts.canonicalPostId, ids)),
      ),
    );
  return new Set(rows.map((row) => String(row.canonical ?? row.id)));
}

/** Rows in the public shape: public tags, the caller's vote and follow flags, no principal IDs. */
async function present(
  db: Database,
  viewer: Viewer,
  boardList: Board[],
  rows: Row[],
) {
  const ids = rows.map((row) => row.id);
  const tags = ids.length
    ? await db
        .select({
          postId: postTagAssignments.postId,
          id: postTags.id,
          name: postTags.name,
          color: postTags.color,
        })
        .from(postTagAssignments)
        .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
        .where(
          and(
            inArray(postTagAssignments.postId, ids),
            isNull(postTags.deletedAt),
            eq(postTags.isPublic, true),
          ),
        )
        .orderBy(asc(postTags.name))
    : [];
  const voted = await votedOf(db, viewer, ids);
  const following = new Set(
    viewer.principalId && ids.length
      ? (
          await db
            .select({ id: postSubscriptions.postId })
            .from(postSubscriptions)
            .where(
              and(
                eq(postSubscriptions.principalId, viewer.principalId),
                inArray(postSubscriptions.postId, ids),
              ),
            )
        ).map((row) => String(row.id))
      : [],
  );
  return rows.map((row) => {
    const board = boardList.find((b) => b.id === row.boardId)!;
    const anonymous = row.authorType === "anonymous";
    const status = row.statusId
      ? { slug: row.statusSlug!, category: row.statusCategory! }
      : null;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      board: { id: board.id, name: board.name, slug: board.slug },
      status: row.statusId
        ? { id: row.statusId, name: row.statusName!, color: row.statusColor! }
        : null,
      stage: stageOf(status),
      author: {
        name: anonymous ? null : (row.authorName ?? null),
        avatarUrl: anonymous ? null : httpUrl(row.authorAvatar),
        isTeamMember: !!row.authorTeammate,
      },
      ...shownVotes(viewer, board, row.voteCount),
      commentCount: row.commentCount,
      pending: row.moderationState === "pending",
      isAuthor: !!viewer.principalId && row.principalId === viewer.principalId,
      voted: voted.has(row.id),
      following: following.has(row.id),
      tags: tags
        .filter((tag) => tag.postId === row.id)
        .map(({ id, name, color }) => ({ id, name, color })),
      createdAt: row.createdAt,
    };
  });
}

async function presentOne(
  db: Database,
  viewer: Viewer,
  boardList: Board[],
  id: PostId,
) {
  const rows = await selectPosts(db, eq(posts.id, id)).limit(1);
  return (await present(db, viewer, boardList, rows))[0]!;
}

/** The public stage as a status condition; the caller left-joins post_statuses. */
function stageWhere(stage: (typeof STAGES)[number]): SQL {
  const live = notInArray(postStatuses.category, ["complete", "closed"]);
  if (stage === "shipped") return eq(postStatuses.category, "complete");
  if (stage !== "open") return and(live, eq(postStatuses.slug, stage))!;
  return or(
    isNull(posts.statusId),
    and(live, notInArray(postStatuses.slug, ["planned", "in_progress"])),
  )!;
}

/**
 * The source's edit and delete rules for the author: without the engagement settings, a post
 * that the team reviewed (a status other than the default), that has posts merged into it, or
 * that has votes or comments from others cannot change. Delete also refuses any comment. Votes
 * by the author do not count. Only engagement the author can see counts, so a private note,
 * a held comment or a test customer's vote never shows through a refusal.
 */
async function ownership(
  db: Database,
  viewer: Viewer,
  post: { id: PostId; principalId: string; statusId: string | null },
) {
  const me = viewer.principalId;
  if (!me || post.principalId !== me)
    return { canEdit: false, canDelete: false, reason: "own" as const };
  const reviewed =
    post.statusId !== null && post.statusId !== (await defaultStatus(db));
  const publicComment = and(
    eq(postComments.postId, post.id),
    isNull(postComments.deletedAt),
    eq(postComments.isPrivate, false),
    eq(postComments.moderationState, "published"),
  );
  const [row] = await db
    .select({
      votes: sql<boolean>`exists (select 1 from ${postVotes} where ${and(eq(postVotes.postId, post.id), ne(postVotes.principalId, me), notTest(postVotes.principalId))})`,
      merged: sql<boolean>`exists (select 1 from ${posts} merged where merged.canonical_post_id = ${sql.param(post.id, posts.id)} and merged.deleted_at is null)`,
      others: sql<boolean>`exists (select 1 from ${postComments} where ${and(publicComment, ne(postComments.principalId, me), notTest(postComments.principalId))})`,
      comments: sql<boolean>`exists (select 1 from ${postComments} where ${publicComment})`,
    })
    .from(posts)
    .where(eq(posts.id, post.id));
  const engaged = reviewed || row!.votes || row!.merged;
  return {
    canEdit: viewer.allowEdit || (!engaged && !row!.others),
    canDelete: viewer.allowDelete || (!engaged && !row!.comments),
    reason: "engagement" as const,
  };
}

export const listPosts = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/posts`,
    operationId: `listQuills${title(audience)}Posts`,
    summary: "List the feedback posts that the caller may see",
    description:
      "Merged, deleted, test-customer and other people's held posts are left out; the caller's own held posts are marked pending. stage maps statuses to open, planned, in_progress and shipped; a closed status has no stage.",
    action: "read",
    query: z.object({
      boardId: flexibleToTypeIdSchema("board").optional(),
      stage: z.enum(STAGES).optional(),
      search: z.string().trim().min(1).max(200).optional(),
      sort: z.enum(["newest", "oldest", "votes", "random"]).optional().openapi({
        description:
          "Without sort: the default sort of the board that boardId names, else newest. random is the same order for one caller for one UTC day.",
      }),
      cursor: flexibleToTypeIdSchema("post").optional(),
      limit: pagingNumber(1, 50, 20),
    }),
    response: z.object({
      items: z.array(postItem),
      nextCursor: z.string().nullable(),
      hasMore: z.boolean(),
    }),
    responseDescription: "One page of posts",
    errors,
    handler: async ({ db, caller, query }) => {
      const viewer = await viewerFor(db, audience, caller);
      const boardList = await visibleBoards(db, viewer);
      const board = query.boardId
        ? boardList.find((b) => b.id === query.boardId)
        : undefined;
      if (query.boardId && !board) throw notFound("Board");
      // A cursor is a post the caller can see; a hidden one is 404, not a probe.
      if (query.cursor) await findPost(db, viewer, boardList, query.cursor);
      const name = query.sort ?? board?.voting.defaultSort ?? "newest";
      const sort =
        name === "random"
          ? randomSort(
              `${viewer.principalId ?? "anonymous"}:${new Date().toISOString().slice(0, 10)}`,
            )
          : sorts[name];
      const rows = await selectPosts(
        db,
        and(
          postVisible(
            viewer,
            boardList.map((b) => b.id),
          ),
          isNull(posts.canonicalPostId),
          query.boardId && eq(posts.boardId, query.boardId),
          query.stage && stageWhere(query.stage),
          query.search
            ? sql`${posts.searchVector} @@ websearch_to_tsquery('english', ${query.search})`
            : undefined,
          query.cursor && afterCursor(query.cursor, sort),
        ),
      )
        .orderBy(...sort.order)
        .limit(query.limit + 1);
      const items = await present(
        db,
        viewer,
        boardList,
        rows.slice(0, query.limit),
      );
      const hasMore = rows.length > query.limit;
      return { items, nextCursor: hasMore ? items.at(-1)!.id : null, hasMore };
    },
  });

export const similarPosts = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/posts/similar`,
    operationId: `findQuills${title(audience)}SimilarPosts`,
    summary: "Find visible posts with a title like the given text",
    // Each call ranks every match; bound how often one client can ask.
    rateLimit: { limit: 60, windowSeconds: 60 },
    description:
      "Full-text match on any word, best match first. The source's embedding search is not ported.",
    action: "read",
    query: z.object({
      title: z.string().trim().min(3).max(200),
      limit: pagingNumber(1, 10, 5),
    }),
    response: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          voteCount,
          stage: z.enum(STAGES).nullable(),
          board: z.object({ id: z.string(), slug: z.string() }),
        }),
      ),
    }),
    responseDescription: "Similar posts",
    handler: async ({ db, caller, query }) => {
      const viewer = await viewerFor(db, audience, caller);
      const boardList = await visibleBoards(db, viewer);
      // plainto_tsquery sanitizes the text; joining its terms with | matches any word.
      const tsquery = sql`replace(plainto_tsquery('english', ${query.title})::text, '&', '|')::tsquery`;
      const rows = await db
        .select({
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          boardId: posts.boardId,
          slug: postStatuses.slug,
          category: postStatuses.category,
        })
        .from(posts)
        .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
        .where(
          and(
            postVisible(
              viewer,
              boardList.map((b) => b.id),
            ),
            isNull(posts.canonicalPostId),
            sql`${posts.searchVector} @@ ${tsquery}`,
          ),
        )
        .orderBy(
          desc(sql`ts_rank(${posts.searchVector}, ${tsquery})`),
          desc(posts.voteCount),
          asc(posts.id),
        )
        .limit(query.limit);
      return {
        items: rows.map((row) => {
          const board = boardList.find((b) => b.id === row.boardId)!;
          return {
            id: row.id,
            title: row.title,
            ...shownVotes(viewer, board, row.voteCount),
            stage: stageOf(
              row.slug ? { slug: row.slug, category: row.category! } : null,
            ),
            board: { id: board.id, slug: board.slug },
          };
        }),
      };
    },
  });

export const getPost = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/posts/{postId}`,
    operationId: `getQuills${title(audience)}Post`,
    summary: "Get a feedback post with the caller's permissions on it",
    description:
      "Includes what the source served as vote sidebar, comments section and post permission data. mergedInto names the post that a merged post points to when the caller can see it.",
    action: "read",
    params: postParams,
    response: postDetail,
    responseDescription: "The post",
    errors,
    handler: async ({ db, caller, params }) => {
      const viewer = await viewerFor(db, audience, caller);
      const boardList = await visibleBoards(db, viewer);
      const post = await findPost(db, viewer, boardList, params.postId);
      const [merged] = post.canonicalPostId
        ? await db
            .select({ id: posts.id, title: posts.title })
            .from(posts)
            .where(
              and(
                eq(posts.id, post.canonicalPostId),
                postVisible(
                  viewer,
                  boardList.map((b) => b.id),
                ),
              ),
            )
        : [];
      const can = capabilities(viewer, post.board.access);
      const owner = await ownership(db, viewer, post);
      const isAuthor = owner.reason === "engagement";
      const [mine] = viewer.principalId
        ? await db
            .select({ importance: postVotes.importance })
            .from(postVotes)
            .where(
              and(
                eq(postVotes.principalId, viewer.principalId),
                inArray(
                  postVotes.postId,
                  relatedPosts(db, post.canonicalPostId ?? post.id),
                ),
              ),
            )
            .limit(1)
        : [];
      return {
        ...(await presentOne(db, viewer, boardList, post.id)),
        attachments: (await readAttachments(db, { postIds: [post.id] })).map(
          attachmentFields,
        ),
        canVote: can.canVote,
        canComment:
          can.canComment &&
          !post.isCommentsLocked &&
          !post.canonicalPostId &&
          (!post.board.access.authorOnly || isAuthor),
        canEdit: owner.canEdit,
        canDelete: owner.canDelete,
        isCommentsLocked: post.isCommentsLocked,
        authorOnlyReplies: post.board.access.authorOnly,
        mergedInto: merged ?? null,
        importance: mine?.importance ?? null,
      };
    },
  });

export const createPost = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    ensureCustomer: audience === "portal",
    method: "post",
    path: `/${audience}/posts`,
    operationId: `createQuills${title(audience)}Post`,
    summary: "Submit a feedback post",
    description:
      "Without boardId, the first board (by name) that accepts the caller's submissions. Without title, the first line of content. The author's vote and subscription are added. A held post waits for review and is visible only to its author. idempotencyKey returns the first post for a repeated request; another payload under the same key is 409.",
    action: "create",
    rateLimit: { limit: 20, windowSeconds: 600 },
    body: z
      .object({
        boardId: flexibleToTypeIdSchema("board").optional(),
        title: z.string().trim().min(1).max(200).optional(),
        content: z.string().trim().max(10000),
        attachmentIds,
        idempotencyKey: z.string().min(1).max(128).optional(),
      })
      .refine((body) => body.title || body.content, {
        message: "Provide a title or content",
      }),
    response: postItem.extend({ replayed: z.boolean() }),
    responseDescription: "The created post",
    errors: writeErrors,
    event: (_input, result) =>
      !result.replayed && {
        type: "post.created",
        entityType: "post",
        entityId: result.id,
        payload: { boardId: result.board.id },
      },
    handler: async ({ db, caller, body }) => {
      const viewer = await viewerFor(db, audience, caller);
      const me = principalOf(viewer);
      const boardList = await visibleBoards(db, viewer);
      const board = body.boardId
        ? boardList.find((b) => b.id === body.boardId)
        : boardList.find((b) => capabilities(viewer, b.access).canSubmit);
      if (!board) throw notFound("Board");
      if (!capabilities(viewer, board.access).canSubmit)
        throw forbidden("Submissions are not open to you on this board");
      const postTitle =
        body.title ?? body.content.split("\n")[0]!.trim().slice(0, 200);
      const receipt = body.idempotencyKey
        ? await claimReceipt(db, "post", me, body.idempotencyKey, {
            boardId: board.id,
            title: postTitle,
            content: body.content,
            ...(body.attachmentIds?.length
              ? { attachmentIds: JSON.stringify(body.attachmentIds) }
              : {}),
          })
        : null;
      if (receipt?.replayOf) {
        // The first post may have left the caller's sight since: 404, not a stale copy.
        const first = await findPost(
          db,
          viewer,
          boardList,
          receipt.replayOf as PostId,
        );
        return {
          ...(await presentOne(db, viewer, boardList, first.id)),
          replayed: true,
        };
      }
      const pending = held(
        viewer,
        board.access,
        "post",
        `${postTitle}\n${body.content}`,
      );
      const [post] = await db
        .insert(posts)
        .values({
          boardId: board.id,
          title: postTitle,
          content: body.content,
          statusId: await defaultStatus(db),
          principalId: me,
          // A test customer's vote is kept but not counted, as on the teammate path.
          voteCount: viewer.isTest ? 0 : 1,
          moderationState: pending ? "pending" : "published",
        })
        .returning({ id: posts.id });
      const postId = post!.id;
      await saveAttachments(db, me, { postId }, body.attachmentIds);
      await db.insert(postVotes).values({ postId, principalId: me });
      await db
        .insert(postSubscriptions)
        .values({ postId, principalId: me, reason: "author" });
      await activity(db, me, postId, "post.created", { boardName: board.name });
      await receipt?.finish(postId);
      return {
        ...(await presentOne(db, viewer, boardList, postId)),
        replayed: false,
      };
    },
  });

const editPost = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "put",
  path: "/portal/posts/{postId}",
  operationId: "editQuillsPortalOwnPost",
  summary: "Edit the caller's own post",
  description:
    "Only the author. Without allowEditAfterEngagement, a reviewed or merged-into post or one with votes or comments from others is 403. The previous text goes to the edit history. The new text goes through moderation again: a held edit takes the post back to review.",
  action: "update",
  rateLimit: { limit: 30, windowSeconds: 600 },
  params: postParams,
  body: z.object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().max(10000),
    attachmentIds,
  }),
  response: postItem,
  responseDescription: "The edited post",
  errors,
  event: ({ params }) => ({
    type: "post.updated",
    entityType: "post",
    entityId: params.postId,
    payload: { fields: "title,content" },
  }),
  handler: async ({ db, caller, params, body }) => {
    const viewer = await viewerFor(db, "portal", caller);
    const me = principalOf(viewer);
    const boardList = await visibleBoards(db, viewer);
    // The row lock keeps a parallel edit or vote from slipping past the engagement rule.
    await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, params.postId))
      .for("update");
    const post = await findPost(db, viewer, boardList, params.postId);
    const owner = await ownership(db, viewer, post);
    if (owner.reason === "own")
      throw forbidden("You can only edit your own posts");
    if (!owner.canEdit)
      throw forbidden(
        "Posts with votes, comments or a team review cannot be edited",
      );
    await db.insert(postEditHistory).values({
      postId: post.id,
      editorPrincipalId: me,
      previousTitle: post.title,
      previousContent: post.content,
    });
    await db
      .update(posts)
      .set({
        title: body.title,
        content: body.content,
        contentJson: null,
        ...(held(
          viewer,
          post.board.access,
          "post",
          `${body.title}\n${body.content}`,
        ) && { moderationState: "pending" as const }),
        updatedAt: new Date(),
      })
      .where(eq(posts.id, post.id));
    await saveAttachments(db, me, { postId: post.id }, body.attachmentIds);
    return presentOne(db, viewer, boardList, post.id);
  },
});

const deletePost = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "delete",
  path: "/portal/posts/{postId}",
  operationId: "deleteQuillsPortalOwnPost",
  summary: "Delete the caller's own post",
  description:
    "Soft delete, only by the author. Without allowDeleteAfterEngagement, a reviewed or merged-into post or one with votes from others or any comment is 403.",
  action: "delete",
  rateLimit: { limit: 30, windowSeconds: 600 },
  params: postParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted post",
  errors,
  event: ({ params }) => ({
    type: "post.deleted",
    entityType: "post",
    entityId: params.postId,
  }),
  handler: async ({ db, caller, params }) => {
    const viewer = await viewerFor(db, "portal", caller);
    const me = principalOf(viewer);
    const boardList = await visibleBoards(db, viewer);
    await db
      .select({ id: posts.id })
      .from(posts)
      .where(eq(posts.id, params.postId))
      .for("update");
    const post = await findPost(db, viewer, boardList, params.postId);
    const owner = await ownership(db, viewer, post);
    if (owner.reason === "own")
      throw forbidden("You can only delete your own posts");
    if (!owner.canDelete)
      throw forbidden(
        "Posts with votes, comments or a team review cannot be deleted",
      );
    await db
      .update(posts)
      .set({ deletedAt: new Date(), deletedByPrincipalId: me })
      .where(eq(posts.id, post.id));
    await activity(db, me, post.id, "post.deleted");
    return { id: post.id };
  },
});

export const setVote = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    ensureCustomer: audience === "portal",
    method: "put",
    path: `/${audience}/posts/{postId}/vote`,
    operationId: `setQuills${title(audience)}Vote`,
    summary: "Set the caller's vote on a post",
    description:
      "Desired state, not a toggle: a retry changes nothing. A vote on a merged post counts on the post it was merged into. changed is false when the vote was already in that state. importance (only with voted: true) says how much the caller needs the post; without it, a stored importance stays. Removing the vote removes its importance.",
    action: "update",
    rateLimit: { limit: 120, windowSeconds: 600 },
    params: postParams,
    body: z
      .object({ voted: z.boolean(), importance: importance.optional() })
      .refine((body) => body.voted || body.importance === undefined, {
        message: "importance needs voted: true",
        path: ["importance"],
      }),
    response: z.object({
      postId: z.string(),
      voted: z.boolean(),
      voteCount,
      changed: z.boolean(),
      importance: importance.nullable(),
    }),
    responseDescription: "The vote state",
    errors,
    event: (_input, result, raw) => [
      ...(result.changed
        ? [
            {
              type: result.voted
                ? ("post.voted" as const)
                : ("post.unvoted" as const),
              entityType: "post" as const,
              entityId: result.postId,
            },
          ]
        : []),
      ...((raw as { importanceSet?: PrincipalId }).importanceSet
        ? [
            {
              type: "post.vote_importance_set" as const,
              entityType: "post" as const,
              entityId: result.postId,
              payload: {
                importance: result.importance!,
                principalId: (raw as { importanceSet: PrincipalId })
                  .importanceSet,
              },
            },
          ]
        : []),
    ],
    handler: async ({ db, caller, params, body }) => {
      const viewer = await viewerFor(db, audience, caller);
      const me = principalOf(viewer);
      const boardList = await visibleBoards(db, viewer);
      let post = await findPost(db, viewer, boardList, params.postId);
      if (post.canonicalPostId)
        post = await findPost(db, viewer, boardList, post.canonicalPostId);
      if (!capabilities(viewer, post.board.access).canVote)
        throw forbidden("Voting is not open to you on this board");
      const mine = and(
        eq(postVotes.principalId, me),
        inArray(postVotes.postId, relatedPosts(db, post.id)),
      );
      let changed: boolean;
      let importanceSet = false;
      if (body.voted) {
        const [existing] = await db
          .select({ id: postVotes.id })
          .from(postVotes)
          .where(mine)
          .limit(1);
        // The unique (post, principal) index decides between two parallel votes.
        changed =
          !existing &&
          (
            await db
              .insert(postVotes)
              .values({
                postId: post.id,
                principalId: me,
                importance: body.importance,
              })
              .onConflictDoNothing()
              .returning({ id: postVotes.id })
          ).length > 0;
        if (changed) importanceSet = body.importance !== undefined;
        else if (body.importance)
          importanceSet =
            (
              await db
                .update(postVotes)
                .set({ importance: body.importance, updatedAt: new Date() })
                .where(
                  and(
                    mine,
                    or(
                      isNull(postVotes.importance),
                      ne(postVotes.importance, body.importance),
                    ),
                  ),
                )
                .returning({ id: postVotes.id })
            ).length > 0;
      } else
        changed =
          (
            await db
              .delete(postVotes)
              .where(mine)
              .returning({ id: postVotes.id })
          ).length > 0;
      const [moved] = changed
        ? await db
            .update(posts)
            .set({
              voteCount: sql`greatest(0, ${posts.voteCount} + ${body.voted ? 1 : -1})`,
            })
            .where(and(eq(posts.id, post.id), notTest(me)))
            .returning({ voteCount: posts.voteCount })
        : [];
      const [current] = moved
        ? [moved]
        : await db
            .select({ voteCount: posts.voteCount })
            .from(posts)
            .where(eq(posts.id, post.id));
      // Read after the writes: a parallel request may have set the importance.
      const [stored] = body.voted
        ? await db
            .select({ importance: postVotes.importance })
            .from(postVotes)
            .where(mine)
            .limit(1)
        : [];
      return {
        postId: post.id,
        voted: body.voted,
        ...shownVotes(viewer, post.board, current!.voteCount),
        changed,
        importance: stored?.importance ?? null,
        // For the event only; the response schema leaves it out.
        ...(importanceSet && { importanceSet: me }),
      };
    },
  });

export const setFollow = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    ensureCustomer: audience === "portal",
    method: "put",
    path: `/${audience}/posts/{postId}/follow`,
    operationId: `setQuills${title(audience)}Follow`,
    summary: "Follow or unfollow a post",
    description:
      "Desired state. Following records interest in comments and status changes; it is not consent to other mail.",
    action: "update",
    rateLimit: { limit: 120, windowSeconds: 600 },
    params: postParams,
    body: z.object({ following: z.boolean() }),
    response: z.object({ postId: z.string(), following: z.boolean() }),
    responseDescription: "The follow state",
    errors,
    event: { none: "The caller's own subscription; no shared record changes" },
    handler: async ({ db, caller, params, body }) => {
      const viewer = await viewerFor(db, audience, caller);
      const me = principalOf(viewer);
      const boardList = await visibleBoards(db, viewer);
      const post = await findPost(db, viewer, boardList, params.postId);
      if (body.following)
        await db
          .insert(postSubscriptions)
          .values({ postId: post.id, principalId: me, reason: "manual" })
          .onConflictDoNothing();
      else
        await db
          .delete(postSubscriptions)
          .where(
            and(
              eq(postSubscriptions.postId, post.id),
              eq(postSubscriptions.principalId, me),
            ),
          );
      return { postId: post.id, following: body.following };
    },
  });

export const votedPosts = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/voted-posts`,
    operationId: `listQuills${title(audience)}VotedPosts`,
    summary: "List the visible posts that the caller voted on",
    description:
      "At most 1,000, newest vote first. Empty without a customer profile. Merged posts report the post they were merged into.",
    action: "read",
    response: z.object({ postIds: z.array(z.string()) }),
    responseDescription: "Post IDs",
    handler: async ({ db, caller }) => {
      const viewer = await viewerFor(db, audience, caller);
      if (!viewer.principalId) return { postIds: [] };
      const boardList = await visibleBoards(db, viewer);
      const rows = await db
        .select({ id: posts.id, canonical: posts.canonicalPostId })
        .from(postVotes)
        .innerJoin(posts, eq(posts.id, postVotes.postId))
        .where(
          and(
            eq(postVotes.principalId, viewer.principalId),
            postVisible(
              viewer,
              boardList.map((b) => b.id),
            ),
          ),
        )
        .orderBy(desc(postVotes.createdAt), desc(postVotes.id))
        .limit(1000);
      // A merged post reports the post it was merged into, only when the caller sees that one.
      const canonical = rows.flatMap((row) =>
        row.canonical ? [row.canonical] : [],
      );
      const seen = new Set(
        canonical.length
          ? (
              await db
                .select({ id: posts.id })
                .from(posts)
                .where(
                  and(
                    inArray(posts.id, canonical),
                    postVisible(
                      viewer,
                      boardList.map((b) => b.id),
                    ),
                  ),
                )
            ).map((row) => String(row.id))
          : [],
      );
      return {
        postIds: [
          ...new Set(
            rows.flatMap((row) =>
              !row.canonical
                ? [String(row.id)]
                : seen.has(row.canonical)
                  ? [String(row.canonical)]
                  : [],
            ),
          ),
        ],
      };
    },
  });

export const userStats = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    method: "get",
    path: `/${audience}/user/stats`,
    operationId: `getQuills${title(audience)}UserStats`,
    summary: "Count the caller's own posts, comments and votes",
    description:
      "Live rows only. Zero for an account without a customer profile.",
    action: "read",
    response: z.object({
      posts: z.number(),
      comments: z.number(),
      votes: z.number(),
    }),
    responseDescription: "The caller's activity counts",
    handler: async ({ db, caller }) => {
      const viewer = await viewerFor(db, audience, caller);
      const me = viewer.principalId;
      if (!me) return { posts: 0, comments: 0, votes: 0 };
      const [row] = await db
        .select({
          posts: sql<number>`(select count(*) from ${posts} where ${and(eq(posts.principalId, me), isNull(posts.deletedAt))})::int`,
          comments: sql<number>`(select count(*) from ${postComments} where ${and(eq(postComments.principalId, me), isNull(postComments.deletedAt))})::int`,
          votes: sql<number>`(select count(*) from ${postVotes} where ${eq(postVotes.principalId, me)})::int`,
        })
        .from(principal)
        .where(eq(principal.id, me));
      return row ?? { posts: 0, comments: 0, votes: 0 };
    },
  });

/** The routes that both audiences declare. */
export const postRoutes = (audience: Customer) =>
  apiRouter()
    .openapi(...listPosts(audience))
    .openapi(...similarPosts(audience))
    .openapi(...getPost(audience))
    .openapi(...createPost(audience))
    .openapi(...setVote(audience))
    .openapi(...setFollow(audience))
    .openapi(...votedPosts(audience))
    .openapi(...userStats(audience));

/** Edit and delete of the caller's own post: portal only, as in the source. */
export const ownPostRoutes = apiRouter()
  .openapi(...editPost)
  .openapi(...deletePost);
