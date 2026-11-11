import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { apiRouter, z } from "../../../openapi";
import { postTags } from "../../../database/quills/schema/boards";
import { posts } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { defineQuillsRoute } from "../../framework/define-route";
import {
  capabilities,
  postVisible,
  STAGES,
  stageOf,
  title,
  viewerFor,
  visibleBoards,
  type Customer,
} from "./viewer";

// Boards with the caller's capabilities (audience: "portal" and audience: "widget"), and the
// portal's status and public tag lists. The board access matrix (tiers, segment IDs and
// moderation rules) never leaves the server; only the caller's booleans do.

export const listBoards = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/boards`,
    operationId: `listQuills${title(audience)}Boards`,
    summary: "List the boards that the caller may see, with its capabilities",
    description:
      "With counts=true, postCount counts the posts that the caller may see; otherwise it is null. canSubmit, canVote and canComment apply the board's tiers and, for a visitor without sign-in, the workspace's anonymous switch.",
    action: "read",
    query: z.object({
      counts: z.enum(["true", "false"]).default("false"),
    }),
    response: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          description: z.string().nullable(),
          postCount: z.number().nullable(),
          canSubmit: z.boolean(),
          canVote: z.boolean(),
          canComment: z.boolean(),
        }),
      ),
    }),
    responseDescription: "Boards",
    handler: async ({ db, caller, query }) => {
      const viewer = await viewerFor(db, audience, caller);
      const boardList = await visibleBoards(db, viewer);
      // Counting scans every visible post, so it runs only on request, as on the teammate route.
      const counts =
        query.counts === "true"
          ? await db
              .select({ boardId: posts.boardId, count: count() })
              .from(posts)
              .where(
                and(
                  postVisible(
                    viewer,
                    boardList.map((b) => b.id),
                  ),
                  isNull(posts.canonicalPostId),
                ),
              )
              .groupBy(posts.boardId)
          : null;
      return {
        items: boardList.map(({ access, ...board }) => ({
          ...board,
          postCount: counts
            ? (counts.find((c) => c.boardId === board.id)?.count ?? 0)
            : null,
          ...capabilities(viewer, access),
        })),
      };
    },
  });

const statuses = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/portal/statuses",
  operationId: "listQuillsPortalStatuses",
  summary: "List the post statuses",
  description: "stage is the public vocabulary that the widget uses.",
  action: "read",
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        color: z.string(),
        category: z.string(),
        showOnRoadmap: z.boolean(),
        stage: z.enum(STAGES).nullable(),
      }),
    ),
  }),
  responseDescription: "Statuses by category, then position",
  handler: async ({ db, caller }) => {
    await viewerFor(db, "portal", caller);
    const rows = await db
      .select({
        id: postStatuses.id,
        name: postStatuses.name,
        slug: postStatuses.slug,
        color: postStatuses.color,
        category: postStatuses.category,
        showOnRoadmap: postStatuses.showOnRoadmap,
      })
      .from(postStatuses)
      .where(isNull(postStatuses.deletedAt))
      .orderBy(
        sql`array_position(array['active','complete','closed'], ${postStatuses.category})`,
        asc(postStatuses.position),
        asc(postStatuses.id),
      );
    return { items: rows.map((row) => ({ ...row, stage: stageOf(row) })) };
  },
});

const tags = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/portal/tags",
  operationId: "listQuillsPortalTags",
  summary: "List the public post tags",
  description: "Internal tags (not public) are left out.",
  action: "read",
  response: z.object({
    items: z.array(
      z.object({ id: z.string(), name: z.string(), color: z.string() }),
    ),
  }),
  responseDescription: "Public tags by name",
  handler: async ({ db, caller }) => {
    await viewerFor(db, "portal", caller);
    return {
      items: await db
        .select({ id: postTags.id, name: postTags.name, color: postTags.color })
        .from(postTags)
        .where(and(isNull(postTags.deletedAt), eq(postTags.isPublic, true)))
        .orderBy(asc(postTags.name), asc(postTags.id)),
    };
  },
});

export const boardRoutes = (audience: Customer) =>
  apiRouter().openapi(...listBoards(audience));

/** The portal's status and tag lists. */
export const taxonomyRoutes = apiRouter()
  .openapi(...statuses)
  .openapi(...tags);
