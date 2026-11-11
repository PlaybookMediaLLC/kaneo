import { and, asc, eq, gte } from "drizzle-orm";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  VISITOR_SURFACES,
  VISITOR_TOP_DIMENSIONS as dimensions,
  visitorStatsDaily,
  visitorTopStats,
} from "../../database/quills/schema/visitor-analytics";
import { defineQuillsRoute } from "../framework/define-route";
import { periodQuery, periods, utcDay } from "./analytics";

// Visitor analytics from the hourly rollup (database/quills/visitor-rollup.ts), never the raw
// page_views partitions, so the cost stays flat. The rollup leaves out test customers' page views.
// Range uniques are the sum of daily uniques: the visitor hash is salted per day.

const metric = z.object({
  current: z.number(),
  /** Period-over-period change in percent; null when the previous period is empty. */
  delta: z.number().nullable(),
});
const ranked = z.array(z.object({ label: z.string(), count: z.number() }));
type Daily = {
  uniqueVisitors: number;
  pageviews: number;
  visits: number;
};

const visitorAnalytics = defineQuillsRoute({
  method: "get",
  path: "/reporting/visitor-analytics",
  operationId: "getQuillsVisitorAnalyticsData",
  summary: "Get portal and widget visitor analytics for a period",
  description:
    "Reads the hourly rollup: unique visitors, page views and visits per day, with the top pages, sources, countries, devices, browsers and operating systems.",
  action: "read",
  query: periodQuery.extend({
    surface: z.enum(VISITOR_SURFACES).default("all"),
  }),
  response: z.object({
    uniqueVisitors: metric,
    pageviews: metric,
    visits: metric,
    dailyStats: z.array(
      z.object({
        date: z.string(),
        uniqueVisitors: z.number(),
        pageviews: z.number(),
        visits: z.number(),
      }),
    ),
    top: z.object(
      Object.fromEntries(dimensions.map((d) => [d, ranked])) as Record<
        (typeof dimensions)[number],
        typeof ranked
      >,
    ),
    computedAt: nullableResponseTimestamp,
  }),
  responseDescription: "Visitor analytics",
  handler: async ({ db, query }) => {
    const days = periods[query.period];
    const now = Date.now();
    // The current window is the last `days` calendar days including today.
    const start = utcDay(new Date(now - (days - 1) * 86_400_000));
    const previousStart = utcDay(new Date(now - (2 * days - 1) * 86_400_000));
    const daily = await db
      .select({
        date: visitorStatsDaily.date,
        uniqueVisitors: visitorStatsDaily.uniqueVisitors,
        pageviews: visitorStatsDaily.pageviews,
        visits: visitorStatsDaily.visits,
        computedAt: visitorStatsDaily.computedAt,
      })
      .from(visitorStatsDaily)
      .where(
        and(
          eq(visitorStatsDaily.surface, query.surface),
          gte(visitorStatsDaily.date, previousStart),
        ),
      )
      .orderBy(asc(visitorStatsDaily.date));
    const topRows = await db
      .select({
        dimension: visitorTopStats.dimension,
        label: visitorTopStats.label,
        count: visitorTopStats.count,
      })
      .from(visitorTopStats)
      .where(
        and(
          eq(visitorTopStats.period, query.period),
          eq(visitorTopStats.surface, query.surface),
        ),
      )
      .orderBy(asc(visitorTopStats.dimension), asc(visitorTopStats.rank));

    const current = daily.filter((r) => r.date >= start);
    const previous = daily.filter((r) => r.date < start);
    const sum = (rows: Daily[], key: keyof Daily) =>
      rows.reduce((total, row) => total + row[key], 0);
    const withDelta = (key: keyof Daily) => {
      const value = sum(current, key);
      const before = sum(previous, key);
      return {
        current: value,
        delta:
          before > 0 ? Math.round(((value - before) / before) * 100) : null,
      };
    };
    const top = Object.fromEntries(
      dimensions.map((dimension) => [
        dimension,
        topRows
          .filter((row) => row.dimension === dimension)
          .map(({ label, count }) => ({ label, count })),
      ]),
    ) as Record<(typeof dimensions)[number], z.input<typeof ranked>>;
    return {
      uniqueVisitors: withDelta("uniqueVisitors"),
      pageviews: withDelta("pageviews"),
      visits: withDelta("visits"),
      dailyStats: current.map(({ computedAt: _, ...row }) => row),
      top,
      computedAt: daily.at(-1)?.computedAt ?? null,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...visitorAnalytics,
);
