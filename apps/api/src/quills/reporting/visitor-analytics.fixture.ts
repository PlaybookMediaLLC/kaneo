import {
  visitorStatsDaily,
  visitorTopStats,
} from "../../database/quills/schema/visitor-analytics";
import { fixture } from "../framework/contract";

// Today's rollup row and one top page in A.
export const getQuillsVisitorAnalyticsData = fixture({
  seed: (env) =>
    env.scoped(env.a, async (db) => {
      await db
        .insert(visitorStatsDaily)
        .values({
          date: new Date().toISOString().slice(0, 10),
          surface: "all",
          uniqueVisitors: 2,
          pageviews: 3,
          visits: 2,
        })
        .onConflictDoNothing();
      await db
        .insert(visitorTopStats)
        .values({
          period: "7d",
          surface: "all",
          dimension: "page",
          rank: 1,
          label: "/",
          count: 2,
        })
        .onConflictDoNothing();
      return {};
    }),
  valid: () => ({ query: { period: "7d", surface: "all" } }),
});
