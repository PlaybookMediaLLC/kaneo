import {
  and,
  count,
  desc,
  eq,
  gte,
  isNull,
  lt,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { boards, postTags } from "../../database/quills/schema/boards";
import {
  posts,
  postTagAssignments,
  postVotes,
} from "../../database/quills/schema/posts";
import { postSentiment } from "../../database/quills/schema/sentiment";
import { defineQuillsRoute } from "../framework/define-route";
import { findBoard, loadProjects, notTest, visiblePost } from "./visibility";

// Topic and sentiment insights (RFC 0003 feature 11). Every count reads only the posts that the
// caller can see: live posts on live boards that the caller can open, without test customers.

const DAY = 86_400_000;
const MAX_DAYS = 180;
const utcDay = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Whole UTC days, `from` and `to` included. The default is the last 30 days up to today. */
function insightsRange({ from, to }: { from?: string; to?: string }) {
  const end = Date.parse(to ?? utcDay(Date.now())) + DAY;
  const start = from ? Date.parse(from) : end - 30 * DAY;
  return { start, end, days: (end - start) / DAY };
}

const date = z.iso.date().optional();
const query = z
  .object({
    from: date,
    to: date,
    boardId: flexibleToTypeIdSchema("board").optional(),
  })
  .superRefine((value, ctx) => {
    const { days } = insightsRange(value);
    if (days < 1 || days > MAX_DAYS)
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: `Use 1 to ${MAX_DAYS} days, with from on or before to`,
      });
  });

/** The UTC Monday that starts the week of a column. */
const week = (column: AnyColumn) =>
  sql<string>`to_char(date_trunc('week', ${column} at time zone 'UTC'), 'YYYY-MM-DD')`;
const between = (column: AnyColumn, start: number, end: number) =>
  and(gte(column, new Date(start)), lt(column, new Date(end)));
const perWeek = (rows: { week: string; n: number }[]) =>
  new Map(rows.map((row) => [row.week, row.n]));

const insights = defineQuillsRoute({
  method: "get",
  path: "/feedback/insights",
  operationId: "getQuillsFeedbackInsights",
  summary: "Get topic and sentiment insights for a date range",
  description: `Counts only the posts on boards you can see, without deleted posts and test customers. \`from\` and \`to\` are UTC days, both included, at most ${MAX_DAYS} days apart; the default is the last 30 days. Weeks start on Monday (UTC). Tags are the 20 most used on new posts; top posts are the 10 with the most new votes.`,
  action: "read",
  query,
  load: loadProjects,
  response: z.object({
    from: z.string(),
    to: z.string(),
    tags: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        color: z.string(),
        count: z.number(),
      }),
    ),
    sentiment: z.object({
      positive: z.number(),
      neutral: z.number(),
      negative: z.number(),
    }),
    weeks: z.array(
      z.object({ week: z.string(), posts: z.number(), votes: z.number() }),
    ),
    topPosts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        boardName: z.string(),
        newVotes: z.number(),
      }),
    ),
  }),
  responseDescription: "Insights for the range",
  errors: { 400: "The range is not valid", 404: "Board not found" },
  handler: async ({ db, query, loaded: projects }) => {
    const { start, end } = insightsRange(query);
    // A hidden, deleted or foreign board is 404, so a filter cannot probe for it.
    if (query.boardId) await findBoard(db, query.boardId, projects);
    const visible: SQL = and(
      visiblePost(projects),
      query.boardId && eq(posts.boardId, query.boardId),
    )!;
    const newPosts = and(visible, between(posts.createdAt, start, end));

    const postWeeks = perWeek(
      await db
        .select({ week: week(posts.createdAt), n: count() })
        .from(posts)
        .where(newPosts)
        .groupBy(sql`1`),
    );
    // Votes on a merged duplicate count here, but not on the canonical post's top-posts row.
    const newVotes = and(
      visible,
      notTest(postVotes.principalId),
      between(postVotes.createdAt, start, end),
    );
    const voteWeeks = perWeek(
      await db
        .select({ week: week(postVotes.createdAt), n: count() })
        .from(postVotes)
        .innerJoin(posts, eq(posts.id, postVotes.postId))
        .where(newVotes)
        .groupBy(sql`1`),
    );
    const weeks = [];
    const firstDay = new Date(start).getUTCDay();
    for (let t = start - ((firstDay + 6) % 7) * DAY; t < end; t += 7 * DAY) {
      const key = utcDay(t);
      weeks.push({
        week: key,
        posts: postWeeks.get(key) ?? 0,
        votes: voteWeeks.get(key) ?? 0,
      });
    }

    const tags = await db
      .select({
        id: postTags.id,
        name: postTags.name,
        color: postTags.color,
        count: count(),
      })
      .from(postTagAssignments)
      .innerJoin(postTags, eq(postTags.id, postTagAssignments.tagId))
      .innerJoin(posts, eq(posts.id, postTagAssignments.postId))
      .where(and(newPosts, isNull(postTags.deletedAt)))
      .groupBy(postTags.workspaceId, postTags.id)
      .orderBy(desc(count()), postTags.name, postTags.id)
      .limit(20);
    const sentiment = { positive: 0, neutral: 0, negative: 0 };
    for (const row of await db
      .select({ sentiment: postSentiment.sentiment, n: count() })
      .from(postSentiment)
      .innerJoin(posts, eq(posts.id, postSentiment.postId))
      .where(newPosts)
      .groupBy(postSentiment.sentiment))
      sentiment[row.sentiment] = row.n;
    const topPosts = await db
      .select({
        id: posts.id,
        title: posts.title,
        boardName: boards.name,
        newVotes: count(),
      })
      .from(postVotes)
      .innerJoin(posts, eq(posts.id, postVotes.postId))
      .innerJoin(boards, eq(boards.id, posts.boardId))
      .where(and(newVotes, isNull(posts.canonicalPostId)))
      .groupBy(posts.id, posts.title, boards.name)
      .orderBy(desc(count()), posts.id)
      .limit(10);

    return {
      from: utcDay(start),
      to: utcDay(end - DAY),
      tags,
      sentiment,
      weeks,
      topPosts,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...insights,
);
