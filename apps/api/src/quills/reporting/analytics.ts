import {
  and,
  count,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  ne,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import { changelogEntries } from "../../database/quills/schema/changelog";
import {
  postComments,
  posts,
  postVotes,
} from "../../database/quills/schema/posts";
import { postStatuses } from "../../database/quills/schema/statuses";
import { defineQuillsRoute } from "../framework/define-route";
import { loadProjects, notTest, visiblePost } from "../feedback/visibility";
// Feedback analytics, computed from the live rows for the caller. The analytics_daily_stats and
// analytics_top_posts snapshots are workspace-wide (they count hidden boards), so they are not read.

/** Reporting periods in days, as the source and the visitor rollup define them. */
export const periods = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 } as const;
export const periodQuery = z.object({
  period: z.enum(["7d", "30d", "90d", "12m"]).default("30d"),
});
export const utcDay = (date: Date) => date.toISOString().slice(0, 10);
/** Period-over-period change in percent; 100 when the previous period was empty. */
const delta = (current: number, previous: number) =>
  previous === 0
    ? current > 0
      ? 100
      : 0
    : Math.round(((current - previous) / previous) * 100);

const total = z.object({ total: z.number(), delta: z.number() });

const analytics = defineQuillsRoute({
  method: "get",
  path: "/reporting/analytics",
  operationId: "getQuillsAnalyticsData",
  summary: "Get feedback analytics for a period",
  description:
    "Counts only what the caller can see: posts on boards the caller can open, no deleted posts or comments and no test customers. Deltas compare with the period before.",
  action: "read",
  query: periodQuery,
  response: z.object({
    summary: z.object({
      posts: total,
      votes: total,
      comments: total,
      users: total,
    }),
    dailyStats: z.array(
      z.object({
        date: z.string(),
        posts: z.number(),
        votes: z.number(),
        comments: z.number(),
        users: z.number(),
      }),
    ),
    statusDistribution: z.array(
      z.object({
        statusId: z.string(),
        status: z.string(),
        color: z.string(),
        category: z.string(),
        count: z.number(),
      }),
    ),
    boardBreakdown: z.array(
      z.object({ boardId: z.string(), board: z.string(), count: z.number() }),
    ),
    topPosts: z.array(
      z.object({
        rank: z.number(),
        postId: z.string(),
        title: z.string(),
        voteCount: z.number(),
        commentCount: z.number(),
        boardName: z.string(),
        statusName: z.string().nullable(),
      }),
    ),
    changelog: z.object({
      publishedCount: z.number(),
      publishedInPeriod: z.number(),
      totalViews: z.number(),
      topEntries: z.array(
        z.object({ id: z.string(), title: z.string(), viewCount: z.number() }),
      ),
    }),
    computedAt: nullableResponseTimestamp,
  }),
  responseDescription: "Feedback analytics",
  load: loadProjects,
  handler: async ({ db, query, loaded: projects }) => {
    const now = new Date();
    const days = periods[query.period];
    // Whole UTC days with today included, as visitor analytics counts them; the previous period has
    // the same length.
    const today = new Date(`${utcDay(now)}T00:00:00.000Z`).getTime();
    const start = new Date(today - (days - 1) * 86_400_000);
    const previousStart = new Date(start.getTime() - days * 86_400_000);
    const visible = visiblePost(projects);
    const day = (column: AnyColumn) =>
      sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD')`;
    const perDay = async (
      rows: Promise<{ day: string; n: number }[]>,
    ): Promise<Map<string, number>> =>
      new Map((await rows).map((r) => [r.day, r.n]));

    const postDays = await perDay(
      db
        .select({ day: day(posts.createdAt), n: count() })
        .from(posts)
        .where(and(visible, gte(posts.createdAt, previousStart)))
        .groupBy(sql`1`),
    );
    const voteDays = await perDay(
      db
        .select({ day: day(postVotes.createdAt), n: count() })
        .from(postVotes)
        .innerJoin(posts, eq(posts.id, postVotes.postId))
        .where(
          and(
            visible,
            notTest(postVotes.principalId),
            gte(postVotes.createdAt, previousStart),
          ),
        )
        .groupBy(sql`1`),
    );
    const commentDays = await perDay(
      db
        .select({ day: day(postComments.createdAt), n: count() })
        .from(postComments)
        .innerJoin(posts, eq(posts.id, postComments.postId))
        .where(
          and(
            visible,
            isNull(postComments.deletedAt),
            notTest(postComments.principalId),
            gte(postComments.createdAt, previousStart),
          ),
        )
        .groupBy(sql`1`),
    );
    // A signup is a customer with an account, as the source counts it.
    const userDays = await perDay(
      db
        .select({ day: day(principal.createdAt), n: count() })
        .from(principal)
        .where(
          and(
            isNotNull(principal.userId),
            isNull(principal.kaneoUserId),
            isNull(principal.testOwnerPrincipalId),
            eq(principal.role, "user"),
            ne(principal.type, "anonymous"),
            gte(principal.createdAt, previousStart),
          ),
        )
        .groupBy(sql`1`),
    );

    const startDay = utcDay(start);
    const window = (map: Map<string, number>, current: boolean) =>
      [...map].reduce(
        (sum, [d, n]) => (d >= startDay === current ? sum + n : sum),
        0,
      );
    const summary = (map: Map<string, number>) => {
      const current = window(map, true);
      return { total: current, delta: delta(current, window(map, false)) };
    };
    const dailyStats = [];
    for (let t = start.getTime(); t <= now.getTime(); t += 86_400_000) {
      const date = utcDay(new Date(t));
      dailyStats.push({
        date,
        posts: postDays.get(date) ?? 0,
        votes: voteDays.get(date) ?? 0,
        comments: commentDays.get(date) ?? 0,
        users: userDays.get(date) ?? 0,
      });
    }

    const statusDistribution = await db
      .select({
        statusId: postStatuses.id,
        status: postStatuses.name,
        color: postStatuses.color,
        category: postStatuses.category,
        count: count(),
      })
      .from(posts)
      .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(visible)
      .groupBy(postStatuses.workspaceId, postStatuses.id)
      .orderBy(postStatuses.position, postStatuses.id);
    const boardBreakdown = await db
      .select({ boardId: boards.id, board: boards.name, count: count() })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(and(visible, gte(posts.createdAt, start)))
      .groupBy(boards.workspaceId, boards.id)
      .orderBy(desc(count()), boards.id);

    const voteCount =
      sql<number>`(select count(*) from ${postVotes} where ${postVotes.postId} = ${posts.id} and ${postVotes.createdAt} >= ${start} and ${notTest(postVotes.principalId)})`.mapWith(
        Number,
      );
    const commentCount =
      sql<number>`(select count(*) from ${postComments} where ${postComments.postId} = ${posts.id} and ${postComments.createdAt} >= ${start} and ${postComments.deletedAt} is null and ${notTest(postComments.principalId)})`.mapWith(
        Number,
      );
    const top = await db
      .select({
        postId: posts.id,
        title: posts.title,
        voteCount,
        commentCount,
        boardName: boards.name,
        statusName: postStatuses.name,
      })
      .from(posts)
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
      .where(and(visible, gte(posts.createdAt, start)))
      .orderBy(desc(voteCount), desc(posts.createdAt), posts.id)
      .limit(10);

    const live = and(
      isNull(changelogEntries.deletedAt),
      isNotNull(changelogEntries.publishedAt),
      lte(changelogEntries.publishedAt, now),
    );
    const [changelog] = await db
      .select({
        publishedCount: count(),
        publishedInPeriod:
          sql<number>`count(*) filter (where ${changelogEntries.publishedAt} >= ${start})`.mapWith(
            Number,
          ),
        totalViews:
          sql<number>`coalesce(sum(${changelogEntries.viewCount}), 0)`.mapWith(
            Number,
          ),
      })
      .from(changelogEntries)
      .where(live);
    const topEntries = await db
      .select({
        id: changelogEntries.id,
        title: changelogEntries.title,
        viewCount: changelogEntries.viewCount,
      })
      .from(changelogEntries)
      .where(live)
      .orderBy(desc(changelogEntries.viewCount), changelogEntries.id)
      .limit(5);

    return {
      summary: {
        posts: summary(postDays),
        votes: summary(voteDays),
        comments: summary(commentDays),
        users: summary(userDays),
      },
      dailyStats,
      statusDistribution,
      boardBreakdown,
      topPosts: top.map((row, i) => ({ rank: i + 1, ...row })),
      changelog: { ...changelog!, topEntries },
      computedAt: now,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...analytics,
);
