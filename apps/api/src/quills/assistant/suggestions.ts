import { and, count, desc, eq, inArray, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PostId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { mergeSuggestions } from "../../database/quills/schema/merge-suggestions";
import { posts } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { mergePosts } from "../feedback/merge";
import { page, pageQuery } from "../feedback/schemas";
import { loadProjects, visiblePost } from "../feedback/visibility";
import { uniqueConflict } from "../support/conversation-model";
import { requireEmbeddings } from "./provider";

// Merge suggestions: pairs of posts that a worker found similar (embeddings, then a model check).
// Every read and decision needs both posts on boards the teammate can see.

const STATUSES = ["pending", "accepted", "dismissed", "expired"] as const;
const params = z.object({
  suggestionId: flexibleToTypeIdSchema("post_merge_sug"),
});
const postParams = z.object({ postId: flexibleToTypeIdSchema("post") });
const visibleIds = (db: Database, projects: string[]) =>
  db.select({ id: posts.id }).from(posts).where(visiblePost(projects));
const bothVisible = (db: Database, projects: string[]) =>
  and(
    inArray(mergeSuggestions.sourcePostId, visibleIds(db, projects)),
    inArray(mergeSuggestions.targetPostId, visibleIds(db, projects)),
  );
const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });

const postSummary = z.object({
  id: z.string(),
  title: z.string(),
  voteCount: z.number(),
  boardName: z.string(),
  statusName: z.string().nullable(),
});
const suggestionSchema = z.object({
  id: z.string(),
  status: z.enum(STATUSES),
  source: postSummary,
  target: postSummary,
  hybridScore: z.number(),
  llmConfidence: z.number(),
  llmReasoning: z.string().nullable(),
  createdAt: responseTimestamp,
  resolvedAt: nullableResponseTimestamp,
});

async function summaries(db: Database, ids: PostId[]) {
  const rows = ids.length
    ? await db
        .select({
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          boardName: boards.name,
          statusName: postStatuses.name,
        })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
        .where(inArray(posts.id, ids))
    : [];
  return new Map(rows.map((row) => [row.id, row]));
}

/** Pairs each suggestion with its two post summaries. A pair without both is left out. */
async function withPosts(
  db: Database,
  rows: (typeof mergeSuggestions.$inferSelect)[],
) {
  const byId = await summaries(
    db,
    rows.flatMap((row) => [row.sourcePostId, row.targetPostId]),
  );
  return rows.flatMap((row) => {
    const source = byId.get(row.sourcePostId);
    const target = byId.get(row.targetPostId);
    return source && target ? [{ ...row, source, target }] : [];
  });
}

const forPost = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/merge-suggestions",
  operationId: "getQuillsMergeSuggestionsForPost",
  summary: "List the pending merge suggestions of a post",
  description:
    "The post as source or target. Both posts must be visible to you.",
  action: "read",
  params: postParams,
  load: loadProjects,
  response: z.object({ items: z.array(suggestionSchema) }),
  responseDescription: "Pending suggestions, strongest first",
  errors: { 404: "Post not found" },
  handler: async ({ db, params, loaded }) => {
    const [post] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.id, params.postId), visiblePost(loaded)));
    if (!post) throw notFound("Post");
    const rows = await db
      .select()
      .from(mergeSuggestions)
      .where(
        and(
          eq(mergeSuggestions.status, "pending"),
          or(
            eq(mergeSuggestions.sourcePostId, post.id),
            eq(mergeSuggestions.targetPostId, post.id),
          ),
          bothVisible(db, loaded),
        ),
      )
      .orderBy(desc(mergeSuggestions.hybridScore))
      .limit(20);
    return { items: await withPosts(db, rows) };
  },
});

const list = defineQuillsRoute({
  method: "get",
  path: "/merge-suggestions",
  operationId: "listQuillsMergeSuggestions",
  summary: "List the pending or dismissed merge suggestions",
  description:
    "Only suggestions whose two posts are visible to you. Pending ones come strongest first, dismissed ones most recent first.",
  action: "read",
  query: z.object({
    status: z.enum(["pending", "dismissed"]).default("pending"),
    ...pageQuery,
  }),
  load: loadProjects,
  response: z.object({
    items: z.array(suggestionSchema),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of suggestions",
  handler: async ({ db, query, loaded }) => {
    const rows = await db
      .select()
      .from(mergeSuggestions)
      .where(
        and(eq(mergeSuggestions.status, query.status), bothVisible(db, loaded)),
      )
      .orderBy(
        ...(query.status === "pending"
          ? [desc(mergeSuggestions.hybridScore)]
          : [desc(mergeSuggestions.resolvedAt)]),
        desc(mergeSuggestions.createdAt),
        desc(mergeSuggestions.id),
      )
      .offset(query.offset)
      .limit(query.limit + 1);
    const result = page(rows, query);
    return { ...result, items: await withPosts(db, result.items) };
  },
});

const summary = defineQuillsRoute({
  method: "get",
  path: "/merge-suggestions/summary",
  operationId: "fetchQuillsMergeSuggestionSummary",
  summary: "Count the pending merge suggestions",
  description: "Only suggestions whose two posts are visible to you.",
  action: "read",
  load: loadProjects,
  response: z.object({ count: z.number() }),
  responseDescription: "The pending count",
  handler: async ({ db, loaded }) => ({
    count: await db.$count(
      mergeSuggestions,
      and(eq(mergeSuggestions.status, "pending"), bothVisible(db, loaded)),
    ),
  }),
});

const counts = defineQuillsRoute({
  method: "get",
  path: "/merge-suggestions/counts",
  operationId: "fetchQuillsMergeSuggestionCountsForPosts",
  summary: "Count the pending merge suggestions of several posts",
  description:
    "`postIds` is a comma-separated list of up to 100 post IDs. Posts you cannot see count 0.",
  action: "read",
  query: z.object({
    postIds: z
      .string()
      .max(10000)
      .transform((value) => value.split(",").filter(Boolean))
      .pipe(z.array(flexibleToTypeIdSchema("post")).min(1).max(100)),
  }),
  load: loadProjects,
  response: z.object({
    items: z.array(z.object({ postId: z.string(), count: z.number() })),
  }),
  responseDescription: "One count per requested post",
  handler: async ({ db, query, loaded }) => {
    const ids = [...new Set(query.postIds)] as PostId[];
    const pending = and(
      eq(mergeSuggestions.status, "pending"),
      bothVisible(db, loaded),
    );
    const n = new Map<string, number>();
    for (const side of [
      mergeSuggestions.sourcePostId,
      mergeSuggestions.targetPostId,
    ])
      for (const row of await db
        .select({ id: side, n: count() })
        .from(mergeSuggestions)
        .where(and(pending, inArray(side, ids)))
        .groupBy(side))
        n.set(row.id, (n.get(row.id) ?? 0) + row.n);
    return {
      items: ids.map((postId) => ({ postId, count: n.get(postId) ?? 0 })),
    };
  },
});

/** A suggestion whose two posts the caller sees, locked for a decision. */
async function decidable(
  db: Database,
  id: z.output<typeof params>["suggestionId"],
  projects: string[],
) {
  const [row] = await db
    .select()
    .from(mergeSuggestions)
    .where(and(eq(mergeSuggestions.id, id), bothVisible(db, projects)))
    .for("update");
  if (!row) throw notFound("Suggestion");
  return row;
}
const conflict = (message: string) => new HTTPException(409, { message });

const accept = defineQuillsRoute({
  method: "post",
  path: "/suggestions/{suggestionId}/accept",
  operationId: "acceptQuillsSuggestion",
  summary: "Accept a merge suggestion",
  description:
    "Merges the source post into the target post (or the reverse with `swapDirection`), as mergeQuillsPost does, and records post.merged.",
  action: "update",
  params,
  body: z.object({ swapDirection: z.boolean() }),
  load: loadProjects,
  response: z.object({
    id: z.string(),
    duplicatePostId: z.string(),
    canonicalPostId: z.string(),
    canonicalVoteCount: z.number(),
  }),
  responseDescription: "The merge that the suggestion made",
  errors: {
    404: "Suggestion or post not found",
    409: "The suggestion is not pending, or a post is already merged",
  },
  event: (_input, result) => ({
    type: "post.merged",
    entityType: "post",
    entityId: result.duplicatePostId,
    payload: {
      canonicalPostId: result.canonicalPostId,
      suggestionId: result.id,
    },
  }),
  handler: async ({ db, actor, params, body, loaded }) => {
    const row = await decidable(db, params.suggestionId, loaded);
    if (row.status !== "pending")
      throw conflict("This suggestion is not pending");
    const [duplicate, canonical] = body.swapDirection
      ? [row.targetPostId, row.sourcePostId]
      : [row.sourcePostId, row.targetPostId];
    const merged = await mergePosts(db, actor, duplicate, canonical, loaded);
    await db
      .update(mergeSuggestions)
      .set({
        status: "accepted",
        resolvedAt: new Date(),
        resolvedByPrincipalId: actor.principalId,
        updatedAt: new Date(),
      })
      .where(eq(mergeSuggestions.id, row.id));
    return {
      id: row.id,
      duplicatePostId: duplicate,
      canonicalPostId: canonical,
      canonicalVoteCount: merged.canonicalPost.voteCount,
    };
  },
});

const decision = (to: "dismissed" | "pending") =>
  defineQuillsRoute({
    method: "post",
    path:
      to === "dismissed"
        ? "/suggestions/{suggestionId}/dismiss"
        : "/suggestions/{suggestionId}/restore",
    operationId:
      to === "dismissed"
        ? "dismissQuillsSuggestion"
        : "restoreQuillsSuggestion",
    summary:
      to === "dismissed"
        ? "Dismiss a merge suggestion"
        : "Restore a dismissed merge suggestion",
    description:
      to === "dismissed"
        ? "Only a pending suggestion."
        : "Only a dismissed suggestion, and only while no other pending suggestion pairs the same posts.",
    action: "update",
    params,
    load: loadProjects,
    response: z.object({ id: z.string(), status: z.enum(STATUSES) }),
    responseDescription: "The suggestion's new status",
    errors: {
      404: "Suggestion not found",
      409: "The suggestion is not in the right status",
    },
    event: ({ params }) => ({
      type:
        to === "dismissed"
          ? "merge_suggestion.dismissed"
          : "merge_suggestion.restored",
      entityType: "merge_suggestion",
      entityId: params.suggestionId,
    }),
    handler: async ({ db, actor, params, loaded }) => {
      const row = await decidable(db, params.suggestionId, loaded);
      if (row.status !== (to === "dismissed" ? "pending" : "dismissed"))
        throw conflict(
          to === "dismissed"
            ? "This suggestion is not pending"
            : "This suggestion is not dismissed",
        );
      const [updated] = await db
        .update(mergeSuggestions)
        .set({
          status: to,
          resolvedAt: to === "dismissed" ? new Date() : null,
          resolvedByPrincipalId: to === "dismissed" ? actor.principalId : null,
          updatedAt: new Date(),
        })
        .where(eq(mergeSuggestions.id, row.id))
        .returning({ id: mergeSuggestions.id, status: mergeSuggestions.status })
        .catch(uniqueConflict("Another pending suggestion pairs these posts"));
      return updated!;
    },
  });

const mergeCheck = defineQuillsRoute({
  method: "post",
  path: "/posts/{postId}/merge-check",
  operationId: "retryQuillsPostMergeCheck",
  summary: "Look for duplicates of a post again",
  description:
    "A worker embeds the post and stores pending suggestions for similar visible posts after commit. 409 when AI embeddings are not configured.",
  action: "update",
  params: postParams,
  load: async (input) => {
    requireEmbeddings();
    return loadProjects(input);
  },
  response: z.object({ postId: z.string(), requested: z.boolean() }),
  responseDescription: "The request was recorded",
  errors: { 404: "Post not found", 409: "AI embeddings are not configured" },
  event: ({ params }) => ({
    type: "post.merge_check_requested",
    entityType: "post",
    entityId: params.postId,
  }),
  handler: async ({ db, params, loaded }) => {
    const [post] = await db
      .update(posts)
      .set({ mergeCheckedAt: null })
      .where(and(eq(posts.id, params.postId), visiblePost(loaded)))
      .returning({ id: posts.id });
    if (!post) throw notFound("Post");
    return { postId: post.id, requested: true };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...forPost)
  .openapi(...list)
  .openapi(...summary)
  .openapi(...counts)
  .openapi(...accept)
  .openapi(...decision("dismissed"))
  .openapi(...decision("pending"))
  .openapi(...mergeCheck);
