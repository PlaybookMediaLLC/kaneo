import { and, isNotNull, isNull, sql } from "drizzle-orm";
import { apiRouter, pagingNumber, z, type BaseVariables } from "../../openapi";
import { posts } from "../../database/quills/schema/posts";
import { exactDistance } from "../assistant/engine/distance";
import { aiConfig, embed } from "../assistant/provider";
import { defineQuillsRoute } from "../framework/define-route";
import { sorts } from "../feedback/post-filters";
import { loadProjects, visiblePost } from "../feedback/visibility";
import { appPost, searchPosts, selectAppPosts } from "./app-posts";

/** A suggestion's least cosine similarity, as in the source. */
const MIN_SIMILARITY = 0.5;

const search = defineQuillsRoute({
  audience: "app",
  capability: "read:feedback",
  method: "get",
  path: "/search",
  operationId: "searchQuillsAppPosts",
  summary: "Search the posts that a sidebar app can link",
  description:
    "Full-text search over visible posts, most voted first. Leaves out merged, deleted and test-customer posts.",
  action: "read",
  query: z.object({
    q: z.string().trim().min(1).max(200),
    limit: pagingNumber(1, 20, 10),
  }),
  response: z.object({ items: z.array(appPost) }),
  responseDescription: "Matching posts",
  load: loadProjects,
  handler: async ({ db, query, loaded: projects }) => ({
    items: await searchPosts(db, query.q, query.limit, projects),
  }),
});

const suggest = defineQuillsRoute({
  audience: "app",
  capability: "read:feedback",
  method: "get",
  path: "/suggest",
  operationId: "suggestQuillsAppPosts",
  summary: "Suggest posts that match a ticket's text",
  description:
    "Ranks visible, unmerged posts by the cosine similarity of their embeddings (at least 0.5). Without an embedding model, or when the provider fails, it searches the text instead and `similarity` is null. The text goes to the configured AI provider.",
  action: "read",
  query: z.object({
    text: z.string().trim().min(1).max(1000),
    limit: pagingNumber(1, 20, 5),
  }),
  response: z.object({
    items: z.array(appPost.extend({ similarity: z.number().nullable() })),
  }),
  responseDescription: "Suggested posts, best first",
  load: loadProjects,
  // The gate runs in this read's transaction, so an unbound key never reaches the provider.
  prepare: async ({ query }) => query.text,
  call: async (text) =>
    aiConfig()?.embeddingModel
      ? embed([text]).then(
          ({ vectors }) => vectors[0] ?? null,
          () => null,
        )
      : null,
  handler: async ({ db, query, loaded: projects, called: vector }) => {
    if (!vector)
      return {
        items: (
          await searchPosts(db, query.text.slice(0, 200), query.limit, projects)
        ).map((post) => ({ ...post, similarity: null })),
      };
    const distance = exactDistance(
      posts.embedding,
      sql`${JSON.stringify(vector)}::vector`,
    );
    return {
      items: await selectAppPosts(db, {
        similarity: sql<number>`round((1 - ${distance})::numeric, 2)::float8`,
      })
        .where(
          and(
            visiblePost(projects),
            isNull(posts.canonicalPostId),
            isNotNull(posts.embedding),
            sql`1 - ${distance} >= ${MIN_SIMILARITY}`,
          ),
        )
        // Equally similar posts: most voted first, as in search.
        .orderBy(distance, ...sorts.votes.order)
        .limit(query.limit),
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...search)
  .openapi(...suggest);
