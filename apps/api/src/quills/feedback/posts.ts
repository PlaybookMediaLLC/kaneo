import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import type { TypeId } from "@kaneo/ids";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { postActivity } from "../../database/quills/schema/activity";
import { principal } from "../../database/quills/schema/auth";
import { boards, postTags } from "../../database/quills/schema/boards";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import {
  postEditHistory,
  posts,
  postTagAssignments,
  postVotes,
} from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import { activityMetadata, recordActivity } from "./activity";
import {
  afterCursor,
  filterConditions,
  filters,
  restorable,
  RESTORE_MS,
  sorts,
  type Facet,
} from "./post-filters";
import { loadPost, postSchema, selectPosts, withTags } from "./post-view";
import {
  findBoard,
  findPost,
  loadProjects,
  notFound,
  relatedPosts,
} from "./visibility";

const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const errors = {
  404: "Post, board, status, tag or teammate not found",
  409: "The post is not in the required state",
};
const page = {
  offset: pagingNumber(0, 1000000, 0),
  limit: pagingNumber(1, 100, 50),
};
const nonEmpty = (fields: object) =>
  Object.values(fields).some((value) => value !== undefined);
async function findStatus(db: Database, id?: TypeId<"post_status">) {
  const [status] = await db
    .select({
      id: postStatuses.id,
      name: postStatuses.name,
      slug: postStatuses.slug,
      color: postStatuses.color,
    })
    .from(postStatuses)
    .where(
      and(
        id ? eq(postStatuses.id, id) : eq(postStatuses.isDefault, true),
        isNull(postStatuses.deletedAt),
      ),
    )
    .orderBy(asc(postStatuses.position))
    .limit(1);
  if (id && !status) throw notFound("Status");
  return status;
}

/** All tags exist, or nothing changes. Returns the IDs without duplicates. */
async function checkTags(db: Database, ids: TypeId<"post_tag">[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return unique;
  const found = await db
    .select({ id: postTags.id })
    .from(postTags)
    .where(and(inArray(postTags.id, unique), isNull(postTags.deletedAt)));
  if (found.length !== unique.length) throw notFound("Tag");
  return unique;
}

const teammateOf = (members: string[]) =>
  members.length ? inArray(principal.kaneoUserId, members) : sql`false`;

const loadWithMembers = async (input: {
  workspaceId: string;
  userId: string;
}) => ({
  projects: await loadProjects(input),
  members: await memberUserIds(input.workspaceId),
});

const filterQuery = filters.extend({
  sort: z.enum(["newest", "oldest", "votes"]).default("newest"),
  cursor: flexibleToTypeIdSchema("post").optional(),
  limit: pagingNumber(1, 100, 20),
});

const listPosts = defineQuillsRoute({
  method: "get",
  path: "/posts",
  operationId: "listQuillsPosts",
  summary: "List the visible feedback posts",
  description:
    "Leaves out merged posts, test-customer posts and posts on boards hidden by their project links. showDeleted=true lists posts deleted in the last 30 days.",
  action: "read",
  query: filterQuery,
  response: z.object({
    items: z.array(postSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of posts",
  errors,
  load: loadProjects,
  handler: async ({ db, query, loaded: projects }) => {
    // A cursor is a post the caller can see; a hidden or missing one is 404, not a probe.
    if (query.cursor) await findPost(db, query.cursor, projects, true);
    const rows = await selectPosts(
      db,
      and(
        filterConditions(db, query, projects),
        query.cursor && afterCursor(query.cursor, query.sort),
      ),
    )
      .orderBy(...sorts[query.sort].order)
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const items = await withTags(db, rows.slice(0, query.limit));
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null, hasMore };
  },
});

const facet = z.array(z.object({ id: z.string(), count: z.number() }));
const getCounts = defineQuillsRoute({
  method: "get",
  path: "/posts/counts",
  operationId: "getQuillsPostFilterCounts",
  summary: "Count the visible posts per filter value",
  description:
    "Uses the list filters. Each facet leaves out its own filter. `deleted` counts the posts deleted in the last 30 days.",
  action: "read",
  query: filters,
  response: z.object({
    statuses: facet,
    boards: facet,
    tags: facet,
    deleted: z.number(),
  }),
  responseDescription: "Post counts",
  errors,
  load: loadProjects,
  handler: async ({ db, query, loaded: projects }) => {
    const from = <K extends typeof posts.statusId | typeof posts.boardId>(
      key: K,
      omit: Facet,
    ) =>
      db
        .select({ id: key, count: count() })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .where(and(filterConditions(db, query, projects, omit), isNotNull(key)))
        .groupBy(key);
    // One transaction client: the queries run one after another.
    const statuses = await from(posts.statusId, "status");
    const boardCounts = await from(posts.boardId, "board");
    const tags = await db
      .select({ id: postTagAssignments.tagId, count: count() })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .innerJoin(postTagAssignments, eq(postTagAssignments.postId, posts.id))
      .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
      .where(
        and(
          filterConditions(db, query, projects, "tags"),
          isNull(postTags.deletedAt),
        ),
      )
      .groupBy(postTagAssignments.tagId);
    const [deleted] = await db
      .select({ count: count() })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(
        and(filterConditions(db, query, projects, "deleted"), restorable()),
      );
    return {
      statuses: statuses.map((row) => ({ id: row.id!, count: row.count })),
      boards: boardCounts,
      tags,
      deleted: deleted?.count ?? 0,
    };
  },
});

const ownerCandidates = defineQuillsRoute({
  method: "get",
  path: "/posts/owner-candidates",
  operationId: "listQuillsPostOwnerCandidates",
  summary: "List the teammates who can own a post",
  description: "Current workspace members only.",
  action: "read",
  query: z.object(page),
  response: z.object({
    items: z.array(
      z.object({
        principalId: z.string(),
        name: z.string().nullable(),
        avatarUrl: z.string().nullable(),
      }),
    ),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Teammates",
  errors,
  load: ({ workspaceId }) => memberUserIds(workspaceId),
  handler: async ({ db, query, loaded: members }) => {
    const rows = await db
      .select({
        principalId: principal.id,
        name: principal.displayName,
        avatarUrl: principal.avatarUrl,
      })
      .from(principal)
      .where(teammateOf(members))
      .orderBy(asc(principal.displayName), asc(principal.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    return {
      items: rows.slice(0, query.limit),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

const getPost = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}",
  operationId: "getQuillsPost",
  summary: "Get a feedback post",
  action: "read",
  params: postParams,
  response: postSchema.extend({ hasVoted: z.boolean() }),
  responseDescription: "Post",
  errors,
  load: loadProjects,
  handler: async ({ db, actor, params, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    // Votes count on the post a merged post points to, as the vote routes store them.
    const voted = await db
      .select({ id: postVotes.id })
      .from(postVotes)
      .where(
        and(
          inArray(
            postVotes.postId,
            relatedPosts(db, post.canonicalPostId ?? post.id),
          ),
          eq(postVotes.principalId, actor.principalId),
        ),
      )
      .limit(1);
    return {
      ...(await loadPost(db, params.postId)),
      hasVoted: voted.length > 0,
    };
  },
});

const createPost = defineQuillsRoute({
  method: "post",
  path: "/posts",
  operationId: "createQuillsPost",
  summary: "Create a feedback post",
  description:
    "The caller is the author and its first voter. Without a status, the post gets the default status.",
  action: "create",
  body: z.object({
    boardId: flexibleToTypeIdSchema("board"),
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().max(10000).default(""),
    statusId: flexibleToTypeIdSchema("post_status").optional(),
    tagIds: z.array(flexibleToTypeIdSchema("post_tag")).max(50).default([]),
  }),
  response: postSchema,
  responseDescription: "Created post",
  errors,
  event: (_input, result) => ({
    type: "post.created",
    entityType: "post",
    entityId: result.id,
    payload: { boardId: result.boardId },
  }),
  load: loadProjects,
  handler: async ({ db, actor, body, loaded: projects }) => {
    const board = await findBoard(db, body.boardId, projects);
    const status = await findStatus(db, body.statusId);
    const tagIds = await checkTags(db, body.tagIds);
    const [post] = await db
      .insert(posts)
      .values({
        boardId: board.id,
        title: body.title,
        content: body.content,
        statusId: status?.id ?? null,
        principalId: actor.principalId,
        voteCount: 1,
      })
      .returning({ id: posts.id });
    const postId = post!.id;
    await db
      .insert(postVotes)
      .values({ postId, principalId: actor.principalId });
    if (tagIds.length)
      await db
        .insert(postTagAssignments)
        .values(tagIds.map((tagId) => ({ postId, tagId })));
    await db
      .insert(postSubscriptions)
      .values({ postId, principalId: actor.principalId, reason: "author" });
    await recordActivity(db, actor, postId, {
      type: "post.created",
      metadata: { boardName: board.name },
    });
    return loadPost(db, postId);
  },
});

const updatePost = defineQuillsRoute({
  method: "patch",
  path: "/posts/{postId}",
  operationId: "updateQuillsPost",
  summary: "Edit a post's title, content, ETA or comment lock",
  description:
    "A title or content change keeps the previous version in the edit history. An ETA is stored as the first day of its UTC month.",
  action: "update",
  params: postParams,
  body: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      content: z.string().trim().max(10000).optional(),
      eta: z.iso
        .datetime({ offset: true })
        .refine((value) => !value.startsWith("0000"), "Year 0 is not a date")
        .nullable()
        .optional(),
      isCommentsLocked: z.boolean().optional(),
    })
    .refine(nonEmpty, { message: "Provide at least one field" }),
  response: postSchema,
  responseDescription: "Updated post",
  errors,
  event: ({ params, body }) => ({
    type: "post.updated",
    entityType: "post",
    entityId: params.postId,
    payload: {
      fields: Object.entries(body)
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
        .join(","),
    },
  }),
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    if (
      (body.title !== undefined && body.title !== post.title) ||
      (body.content !== undefined && body.content !== post.content)
    )
      await db.insert(postEditHistory).values({
        postId: post.id,
        editorPrincipalId: actor.principalId,
        previousTitle: post.title,
        previousContent: post.content,
        previousContentJson: post.contentJson,
      });
    // The first day of the ETA's UTC month; setUTC* keeps years below 100.
    const eta = typeof body.eta === "string" ? new Date(body.eta) : body.eta;
    eta?.setUTCDate(1);
    eta?.setUTCHours(0, 0, 0, 0);
    await db
      .update(posts)
      .set({
        title: body.title,
        // Rich content from the source no longer matches edited text.
        ...(body.content !== undefined && {
          content: body.content,
          contentJson: null,
        }),
        eta,
        isCommentsLocked: body.isCommentsLocked,
        updatedAt: new Date(),
      })
      .where(eq(posts.id, post.id));
    if (
      body.isCommentsLocked !== undefined &&
      body.isCommentsLocked !== post.isCommentsLocked
    )
      await recordActivity(db, actor, post.id, {
        type: body.isCommentsLocked ? "comments.locked" : "comments.unlocked",
      });
    return loadPost(db, post.id);
  },
});

const setStatus = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/status",
  operationId: "setQuillsPostStatus",
  summary: "Set a post's status",
  action: "update",
  params: postParams,
  body: z.object({ statusId: flexibleToTypeIdSchema("post_status") }),
  response: postSchema,
  responseDescription: "Updated post",
  errors,
  event: ({ params, body }) => ({
    type: "post.status_changed",
    entityType: "post",
    entityId: params.postId,
    payload: { statusId: body.statusId },
  }),
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    const next = (await findStatus(db, body.statusId))!;
    if (post.statusId !== next.id) {
      const [previous] = post.statusId
        ? await db
            .select({ name: postStatuses.name, color: postStatuses.color })
            .from(postStatuses)
            .where(eq(postStatuses.id, post.statusId))
        : [];
      await db
        .update(posts)
        .set({ statusId: next.id, updatedAt: new Date() })
        .where(eq(posts.id, post.id));
      await recordActivity(db, actor, post.id, {
        type: "status.changed",
        metadata: {
          fromName: previous?.name ?? null,
          fromColor: previous?.color ?? null,
          toName: next.name,
          toSlug: next.slug,
          toColor: next.color,
        },
      });
    }
    return loadPost(db, post.id);
  },
});

const setBoard = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/board",
  operationId: "setQuillsPostBoard",
  summary: "Move a post to another board",
  description: "The caller must see both boards.",
  action: "update",
  params: postParams,
  body: z.object({ boardId: flexibleToTypeIdSchema("board") }),
  response: postSchema,
  responseDescription: "Moved post",
  errors,
  event: ({ params, body }) => ({
    type: "post.moved",
    entityType: "post",
    entityId: params.postId,
    payload: { boardId: body.boardId },
  }),
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    const target = await findBoard(db, body.boardId, projects);
    if (post.boardId !== target.id) {
      await db
        .update(posts)
        .set({ boardId: target.id, updatedAt: new Date() })
        .where(eq(posts.id, post.id));
      await recordActivity(db, actor, post.id, {
        type: "post.board_changed",
        metadata: {
          fromBoardId: post.boardId,
          fromBoardName: post.boardName,
          toBoardId: target.id,
          toBoardName: target.name,
        },
      });
    }
    return loadPost(db, post.id);
  },
});

const setOwner = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/owner",
  operationId: "setQuillsPostOwner",
  summary: "Assign or clear a post's owner",
  description: "The owner is a current workspace member. Null clears it.",
  action: "update",
  params: postParams,
  body: z.object({
    ownerPrincipalId: flexibleToTypeIdSchema("principal").nullable(),
  }),
  response: postSchema,
  responseDescription: "Updated post",
  errors,
  event: ({ params, body }) => ({
    type: "post.owner_changed",
    entityType: "post",
    entityId: params.postId,
    payload: body.ownerPrincipalId
      ? { ownerPrincipalId: body.ownerPrincipalId }
      : undefined,
  }),
  load: loadWithMembers,
  handler: async ({ db, actor, params, body, loaded }) => {
    const post = await findPost(db, params.postId, loaded.projects);
    const [owner] = body.ownerPrincipalId
      ? await db
          .select({ name: principal.displayName })
          .from(principal)
          .where(
            and(
              eq(principal.id, body.ownerPrincipalId),
              teammateOf(loaded.members),
            ),
          )
      : [];
    if (body.ownerPrincipalId && !owner) throw notFound("Teammate");
    if (post.ownerPrincipalId !== body.ownerPrincipalId) {
      const [previous] = post.ownerPrincipalId
        ? await db
            .select({ name: principal.displayName })
            .from(principal)
            .where(eq(principal.id, post.ownerPrincipalId))
        : [];
      await db
        .update(posts)
        .set({ ownerPrincipalId: body.ownerPrincipalId, updatedAt: new Date() })
        .where(eq(posts.id, post.id));
      await recordActivity(
        db,
        actor,
        post.id,
        owner
          ? {
              type: "owner.assigned",
              metadata: {
                ownerName: owner.name,
                ...(previous && { previousOwnerName: previous.name }),
              },
            }
          : {
              type: "owner.unassigned",
              metadata: { previousOwnerName: previous?.name ?? null },
            },
      );
    }
    return loadPost(db, post.id);
  },
});

const setTags = defineQuillsRoute({
  method: "put",
  path: "/posts/{postId}/tags",
  operationId: "setQuillsPostTags",
  summary: "Replace a post's tags",
  description:
    "All or nothing: one missing or foreign tag returns 404 and leaves the tags unchanged.",
  action: "update",
  params: postParams,
  body: z.object({
    tagIds: z.array(flexibleToTypeIdSchema("post_tag")).max(50),
  }),
  response: postSchema,
  responseDescription: "Updated post",
  errors,
  event: ({ params }) => ({
    type: "post.tags_changed",
    entityType: "post",
    entityId: params.postId,
  }),
  load: loadProjects,
  handler: async ({ db, actor, params, body, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    const next = await checkTags(db, body.tagIds);
    const current = (
      await db
        .select({ tagId: postTagAssignments.tagId })
        .from(postTagAssignments)
        .where(eq(postTagAssignments.postId, post.id))
    ).map((row) => row.tagId);
    const toAdd = next.filter((id) => !current.includes(id));
    const toRemove = current.filter((id) => !next.includes(id));
    // The activity names only rows this request changed, so a parallel PUT neither fails nor repeats it.
    const removed = toRemove.length
      ? (
          await db
            .delete(postTagAssignments)
            .where(
              and(
                eq(postTagAssignments.postId, post.id),
                inArray(postTagAssignments.tagId, toRemove),
              ),
            )
            .returning({ tagId: postTagAssignments.tagId })
        ).map((row) => row.tagId)
      : [];
    const added = toAdd.length
      ? (
          await db
            .insert(postTagAssignments)
            .values(toAdd.map((tagId) => ({ postId: post.id, tagId })))
            .onConflictDoNothing()
            .returning({ tagId: postTagAssignments.tagId })
        ).map((row) => row.tagId)
      : [];
    const names =
      added.length + removed.length
        ? await db
            .select({ id: postTags.id, name: postTags.name })
            .from(postTags)
            .where(inArray(postTags.id, [...added, ...removed]))
        : [];
    const tagNames = (ids: string[]) =>
      ids.map((id) => names.find((tag) => tag.id === id)?.name ?? "Unknown");
    if (added.length)
      await recordActivity(db, actor, post.id, {
        type: "tags.added",
        metadata: { tagNames: tagNames(added) },
      });
    if (removed.length)
      await recordActivity(db, actor, post.id, {
        type: "tags.removed",
        metadata: { tagNames: tagNames(removed) },
      });
    return loadPost(db, post.id);
  },
});

const deletePost = defineQuillsRoute({
  method: "delete",
  path: "/posts/{postId}",
  operationId: "deleteQuillsPost",
  summary: "Delete a feedback post",
  description:
    "Soft delete. A teammate with the delete action can restore it for 30 days.",
  action: "delete",
  params: postParams,
  response: postSchema,
  responseDescription: "Deleted post",
  errors,
  event: ({ params }) => ({
    type: "post.deleted",
    entityType: "post",
    entityId: params.postId,
  }),
  load: loadProjects,
  handler: async ({ db, actor, params, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects);
    // The state in WHERE makes the second of two parallel deletes a 404, not a repeat.
    const [row] = await db
      .update(posts)
      .set({ deletedAt: new Date(), deletedByPrincipalId: actor.principalId })
      .where(and(eq(posts.id, post.id), isNull(posts.deletedAt)))
      .returning({ id: posts.id });
    if (!row) throw notFound("Post");
    await recordActivity(db, actor, post.id, { type: "post.deleted" });
    return loadPost(db, post.id);
  },
});

const restorePost = defineQuillsRoute({
  method: "post",
  path: "/posts/{postId}/restore",
  operationId: "restoreQuillsPost",
  summary: "Restore a deleted feedback post",
  description:
    "Only within 30 days of the deletion. Returns 409 when the post is not deleted.",
  action: "delete",
  params: postParams,
  response: postSchema,
  responseDescription: "Restored post",
  errors,
  event: ({ params }) => ({
    type: "post.restored",
    entityType: "post",
    entityId: params.postId,
  }),
  load: loadProjects,
  handler: async ({ db, actor, params, loaded: projects }) => {
    const post = await findPost(db, params.postId, projects, true);
    if (post.deletedAt && post.deletedAt.getTime() < Date.now() - RESTORE_MS)
      throw new HTTPException(409, {
        message: "Posts can be restored within 30 days of deletion",
      });
    const [row] = await db
      .update(posts)
      .set({ deletedAt: null, deletedByPrincipalId: null })
      .where(and(eq(posts.id, post.id), isNotNull(posts.deletedAt)))
      .returning({ id: posts.id });
    if (!row) throw new HTTPException(409, { message: "Post is not deleted" });
    await recordActivity(db, actor, post.id, { type: "post.restored" });
    return loadPost(db, post.id);
  },
});

const listActivity = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/activity",
  operationId: "listQuillsPostActivity",
  summary: "List a post's activity, newest first",
  action: "read",
  params: postParams,
  query: z.object(page),
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        principalId: z.string().nullable(),
        actorName: z.string().nullable(),
        metadata: activityMetadata,
        createdAt: responseTimestamp,
      }),
    ),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Activity",
  errors,
  load: loadProjects,
  handler: async ({ db, params, query, loaded: projects }) => {
    await findPost(db, params.postId, projects);
    const rows = await db
      .select({
        id: postActivity.id,
        type: postActivity.type,
        principalId: postActivity.principalId,
        actorName: principal.displayName,
        metadata: postActivity.metadata,
        createdAt: postActivity.createdAt,
      })
      .from(postActivity)
      .leftJoin(principal, eq(principal.id, postActivity.principalId))
      .where(eq(postActivity.postId, params.postId))
      .orderBy(desc(postActivity.createdAt), desc(postActivity.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    return {
      items: rows
        .slice(0, query.limit)
        // An imported row whose metadata does not fit reads as {}; it does not fail the page.
        .map((row) => ({
          ...row,
          metadata: activityMetadata.safeParse(row.metadata).data ?? {},
        })),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

// Static paths come before /posts/{postId}, so "counts" is never read as a post ID.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listPosts)
  .openapi(...getCounts)
  .openapi(...ownerCandidates)
  .openapi(...getPost)
  .openapi(...createPost)
  .openapi(...updatePost)
  .openapi(...setStatus)
  .openapi(...setBoard)
  .openapi(...setOwner)
  .openapi(...setTags)
  .openapi(...deletePost)
  .openapi(...restorePost)
  .openapi(...listActivity);
