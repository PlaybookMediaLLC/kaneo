import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import type { PrincipalId } from "@kaneo/ids";
import { apiRouter, pagingNumber, responseTimestamp, z } from "../../openapi";
import { boards } from "../../database/quills/schema/boards";
import {
  notificationPreferences,
  postSubscriptions,
} from "../../database/quills/schema/notifications";
import { posts, postVotes } from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  postVisible,
  principalOf,
  shownVotes,
  STAGES,
  stageOf,
  viewerFor,
  visibleBoards,
} from "./feedback/viewer";
import { MAIL_TYPES, setMailPreference } from "./unsubscribe-token";

// The signed-in customer's own feedback (RFC 0003, feature 16): posts they created, voted for
// or follow, and the weekly digest preference (D15). The preference is the `weekly_digest`
// email cell of the notification matrix; jobs/handlers/digest.ts reads it with `wants`.

const WEEKLY_DIGEST = MAIL_TYPES.unsubscribe_digest;

const FILTERS = ["all", "mine", "voted", "following"] as const;

const voted = (me: PrincipalId) =>
  sql`exists (select 1 from ${postVotes} where ${postVotes.postId} = ${posts.id} and ${postVotes.principalId} = ${sql.param(me, postVotes.principalId)})`;
const following = (me: PrincipalId) =>
  sql`exists (select 1 from ${postSubscriptions} where ${postSubscriptions.postId} = ${posts.id} and ${postSubscriptions.principalId} = ${sql.param(me, postSubscriptions.principalId)})`;

/** Posts that `me` created, voted for or follows, by filter. */
export function myPosts(
  me: PrincipalId,
  filter: (typeof FILTERS)[number] = "all",
): SQL {
  const mine = eq(posts.principalId, me);
  if (filter === "mine") return mine;
  if (filter === "voted") return voted(me);
  if (filter === "following") return following(me);
  return or(mine, voted(me), following(me))!;
}

const list = defineQuillsRoute({
  audience: "portal",
  method: "get",
  path: "/portal/my-feedback",
  operationId: "listQuillsPortalMyFeedback",
  summary: "List the posts that the caller created, voted for or follows",
  description:
    "Visible posts only, most recently changed first. lastChangedAt is the post's last update. Empty without a customer profile.",
  action: "read",
  query: z.object({
    filter: z.enum(FILTERS).default("all"),
    offset: pagingNumber(0, 10000, 0),
    limit: pagingNumber(1, 50, 20),
  }),
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        board: z.object({ id: z.string(), name: z.string() }),
        status: z.object({ name: z.string(), color: z.string() }).nullable(),
        stage: z.enum(STAGES).nullable(),
        voteCount: z.number().optional().openapi({
          description: "Left out when the post's board hides vote counts",
        }),
        isAuthor: z.boolean(),
        voted: z.boolean(),
        following: z.boolean(),
        lastChangedAt: responseTimestamp,
      }),
    ),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "One page of the caller's posts",
  handler: async ({ db, caller, query }) => {
    const viewer = await viewerFor(db, "portal", caller);
    if (!viewer.principalId) return { items: [], nextOffset: null };
    const me = viewer.principalId;
    const boardList = await visibleBoards(db, viewer);
    const boardIds = boardList.map((b) => b.id);
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        boardId: boards.id,
        boardName: boards.name,
        statusName: postStatuses.name,
        statusColor: postStatuses.color,
        statusSlug: postStatuses.slug,
        statusCategory: postStatuses.category,
        voteCount: posts.voteCount,
        isAuthor: sql<boolean>`${posts.principalId} is not distinct from ${sql.param(me, posts.principalId)}`,
        voted: sql<boolean>`${voted(me)}`,
        following: sql<boolean>`${following(me)}`,
        lastChangedAt: posts.updatedAt,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(and(postVisible(viewer, boardIds), myPosts(me, query.filter)))
      .orderBy(desc(posts.updatedAt), desc(posts.id))
      .offset(query.offset)
      .limit(query.limit + 1);
    return {
      items: rows.slice(0, query.limit).map((row) => ({
        id: row.id,
        title: row.title,
        board: { id: row.boardId, name: row.boardName },
        status:
          row.statusName && row.statusColor
            ? { name: row.statusName, color: row.statusColor }
            : null,
        stage: stageOf(
          row.statusSlug
            ? { slug: row.statusSlug, category: row.statusCategory! }
            : null,
        ),
        ...shownVotes(
          boardList.find((b) => b.id === row.boardId),
          row.voteCount,
        ),
        isAuthor: row.isAuthor,
        voted: row.voted,
        following: row.following,
        lastChangedAt: row.lastChangedAt,
      })),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

const preference = z.object({
  weeklyDigest: z.boolean().openapi({
    description:
      "A weekly mail when the status of the caller's feedback changed. On by default.",
  }),
});

async function weeklyDigestOf(db: Database, me: PrincipalId | null) {
  const [row] = me
    ? await db
        .select({ matrix: notificationPreferences.matrix })
        .from(notificationPreferences)
        .where(eq(notificationPreferences.principalId, me))
    : [];
  return row?.matrix?.[WEEKLY_DIGEST]?.email !== false;
}

const getPreference = defineQuillsRoute({
  audience: "portal",
  method: "get",
  path: "/user/weekly-digest",
  operationId: "getQuillsMyWeeklyDigestPreference",
  summary: "Get the caller's weekly digest preference",
  description: "True until the caller turns the digest off.",
  action: "read",
  response: preference,
  responseDescription: "The caller's weekly digest preference",
  handler: async ({ db, caller }) => {
    const viewer = await viewerFor(db, "portal", caller);
    return { weeklyDigest: await weeklyDigestOf(db, viewer.principalId) };
  },
});

const setPreference = defineQuillsRoute({
  audience: "portal",
  ensureCustomer: true,
  method: "put",
  path: "/user/weekly-digest",
  operationId: "setQuillsMyWeeklyDigestPreference",
  summary: "Turn the caller's weekly digest on or off",
  action: "update",
  rateLimit: { limit: 30, windowSeconds: 600 },
  body: preference,
  response: preference,
  responseDescription: "The caller's weekly digest preference",
  event: { none: "The caller's own preference; no shared record changes." },
  handler: async ({ db, caller, body }) => {
    const me = principalOf(await viewerFor(db, "portal", caller));
    await setMailPreference(db, me, WEEKLY_DIGEST, body.weeklyDigest);
    return { weeklyDigest: body.weeklyDigest };
  },
});

export default apiRouter()
  .openapi(...list)
  .openapi(...getPreference)
  .openapi(...setPreference);
