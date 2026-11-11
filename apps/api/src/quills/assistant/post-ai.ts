import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import { posts } from "../../database/quills/schema/posts";
import { postSentiment } from "../../database/quills/schema/sentiment";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  boardVisible,
  loadProjects,
  visiblePost,
} from "../feedback/visibility";
import { exactDistance } from "./engine/distance";
import { requireAi, requireEmbeddings } from "./provider";

// AI features of feedback posts. Similar posts read stored embeddings with pgvector and call no
// provider. Sentiment, tag backfill and embedding backfill are requests that a worker runs after commit.

const params = z.object({ postId: flexibleToTypeIdSchema("post") });
const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });
async function visible(db: Database, id: string, projects: string[]) {
  const [post] = await db
    .select({ id: posts.id, embedded: isNotNull(posts.embedding) })
    .from(posts)
    .where(and(eq(posts.id, id as never), visiblePost(projects)));
  if (!post) throw notFound("Post");
  return post;
}

const similar = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/similar",
  operationId: "listQuillsSimilarPosts",
  summary: "List the posts most similar to a post",
  description:
    "Cosine similarity of stored embeddings, among posts visible to you. `embedded` is false when the post has no embedding yet; request a backfill to add it.",
  action: "read",
  params,
  query: z.object({
    limit: z.coerce.number().int().min(1).max(20).default(5),
  }),
  load: loadProjects,
  response: z.object({
    embedded: z.boolean(),
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        boardName: z.string(),
        voteCount: z.number(),
        score: z.number(),
      }),
    ),
  }),
  responseDescription: "Similar posts, most similar first",
  errors: { 404: "Post not found" },
  handler: async ({ db, params, query, loaded }) => {
    const post = await visible(db, params.postId, loaded);
    if (!post.embedded) return { embedded: false, items: [] };
    const target = sql`(SELECT embedding FROM quills.posts WHERE id = ${sql.param(params.postId, posts.id)})`;
    const distance = exactDistance(posts.embedding, target);
    const items = await db
      .select({
        id: posts.id,
        title: posts.title,
        boardName: boards.name,
        voteCount: posts.voteCount,
        score: sql<number>`(1 - ${distance})::float8`,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(
        and(
          ne(posts.id, params.postId),
          isNotNull(posts.embedding),
          isNull(posts.canonicalPostId),
          visiblePost(loaded),
        ),
      )
      .orderBy(distance)
      .limit(query.limit);
    return { embedded: true, items };
  },
});

const getSentiment = defineQuillsRoute({
  method: "get",
  path: "/posts/{postId}/sentiment",
  operationId: "getQuillsPostSentiment",
  summary: "Get a post's sentiment",
  description: "Null fields until a worker has analysed the post.",
  action: "read",
  params,
  load: loadProjects,
  response: z.object({
    postId: z.string(),
    sentiment: z.enum(["positive", "neutral", "negative"]).nullable(),
    confidence: z.number().nullable(),
    processedAt: nullableResponseTimestamp,
  }),
  responseDescription: "The stored sentiment",
  errors: { 404: "Post not found" },
  handler: async ({ db, params, loaded }) => {
    await visible(db, params.postId, loaded);
    const [row] = await db
      .select({
        sentiment: postSentiment.sentiment,
        confidence: postSentiment.confidence,
        processedAt: postSentiment.processedAt,
      })
      .from(postSentiment)
      .where(eq(postSentiment.postId, params.postId));
    return {
      postId: params.postId,
      sentiment: row?.sentiment ?? null,
      confidence: row?.confidence ?? null,
      processedAt: row?.processedAt ?? null,
    };
  },
});

const requested = z.object({ requested: z.literal(true) });

const requestSentiment = defineQuillsRoute({
  method: "post",
  path: "/posts/{postId}/sentiment",
  operationId: "requestQuillsPostSentiment",
  summary: "Analyse a post's sentiment",
  description:
    "A worker classifies the post after commit and stores the result. 409 when AI is not configured.",
  action: "update",
  params,
  load: async (input) => {
    requireAi();
    return loadProjects(input);
  },
  response: requested,
  responseDescription: "The request was recorded",
  errors: { 404: "Post not found", 409: "AI is not configured" },
  event: ({ params }) => ({
    type: "post.sentiment_requested",
    entityType: "post",
    entityId: params.postId,
  }),
  handler: async ({ db, params, loaded }) => {
    await visible(db, params.postId, loaded);
    return { requested: true as const };
  },
});

const requestTags = defineQuillsRoute({
  method: "post",
  path: "/posts/ai-tags/backfill",
  operationId: "requestQuillsPostTagBackfill",
  summary: "Tag untagged posts with AI",
  description:
    "A worker asks the model to pick existing tags for up to `limit` untagged posts (on one board, or on any board without project links) and records post.tags_changed for each. 409 when AI is not configured.",
  action: "update",
  body: z.object({
    boardId: flexibleToTypeIdSchema("board").optional(),
    limit: z.number().int().min(1).max(30),
  }),
  load: async (input) => {
    requireAi();
    return loadProjects(input);
  },
  response: requested,
  responseDescription: "The request was recorded",
  errors: { 404: "Board not found", 409: "AI is not configured" },
  event: ({ body, workspaceId }) => ({
    type: "post.tags_backfill_requested",
    entityType: "workspace",
    entityId: workspaceId,
    payload: {
      limit: String(body.limit),
      ...(body.boardId && { boardId: body.boardId }),
    },
  }),
  handler: async ({ db, body, loaded }) => {
    if (body.boardId) {
      const [board] = await db
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.id, body.boardId), boardVisible(loaded)));
      if (!board) throw notFound("Board");
    }
    return { requested: true as const };
  },
});

const requestEmbeddings = defineQuillsRoute({
  method: "post",
  path: "/assistant/embeddings/backfill",
  operationId: "requestQuillsEmbeddingBackfill",
  summary: "Embed the posts and help-center articles that have no embedding",
  description:
    "A worker embeds up to 32 posts and 32 help-center articles per request. Similar posts, merge checks and semantic search use them. 409 when no embedding model is configured.",
  action: "manage_settings",
  load: async () => {
    requireEmbeddings();
  },
  response: requested,
  responseDescription: "The request was recorded",
  errors: { 409: "AI embeddings are not configured" },
  event: ({ workspaceId }) => ({
    type: "assistant.embeddings_requested",
    entityType: "workspace",
    entityId: workspaceId,
  }),
  handler: async () => ({ requested: true as const }),
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...similar)
  .openapi(...getSentiment)
  .openapi(...requestSentiment)
  .openapi(...requestTags)
  .openapi(...requestEmbeddings);
