import {
  and,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import {
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterCategories,
  helpCenterSearchQueries,
} from "../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../framework/define-route";
import { statusOf } from "../../feedback/changelog";
import { articleParams } from "./articles";
import { conflict, notFound } from "./shared";

const limit = (fallback: number) =>
  z.coerce.number().int().min(1).max(100).default(fallback);

const recordFeedback = defineQuillsRoute({
  method: "post",
  path: "/help-center/articles/{articleId}/feedback",
  operationId: "recordQuillsHelpCenterArticleFeedback",
  summary: "Record the caller's helpful or not-helpful vote on an article",
  description:
    "One vote per person. A changed vote moves the counts and clears the reason of the earlier not-helpful vote.",
  action: "create",
  params: articleParams,
  body: z.object({ helpful: z.boolean() }),
  response: z.object({
    feedbackId: z.string(),
    helpful: z.boolean(),
    changed: z.boolean(),
  }),
  responseDescription: "The caller's vote",
  errors: { 404: "Article not found", 409: "A concurrent vote; retry" },
  event: ({ params }, result) => ({
    type: "help_center.article_feedback_recorded",
    entityType: "article",
    entityId: params.articleId,
    payload: {
      helpful: String(result.helpful),
      changed: String(result.changed),
    },
  }),
  handler: async ({ db, actor, params: { articleId }, body: { helpful } }) => {
    // The article row lock serializes this caller's votes and the count updates.
    const [target] = await db
      .select({ id: helpCenterArticles.id })
      .from(helpCenterArticles)
      .where(
        and(
          eq(helpCenterArticles.id, articleId),
          isNull(helpCenterArticles.deletedAt),
        ),
      )
      .for("no key update");
    if (!target) throw notFound("Article");
    const [existing] = await db
      .select({
        id: helpCenterArticleFeedback.id,
        helpful: helpCenterArticleFeedback.helpful,
      })
      .from(helpCenterArticleFeedback)
      .where(
        and(
          eq(helpCenterArticleFeedback.articleId, articleId),
          eq(helpCenterArticleFeedback.principalId, actor.principalId),
        ),
      );
    if (existing?.helpful === helpful)
      return { feedbackId: existing.id, helpful, changed: false };
    if (existing)
      await db
        .update(helpCenterArticleFeedback)
        .set({ helpful, reason: null })
        .where(eq(helpCenterArticleFeedback.id, existing.id));
    const [created] = existing
      ? []
      : await db
          .insert(helpCenterArticleFeedback)
          .values({ articleId, principalId: actor.principalId, helpful })
          .onConflictDoNothing()
          .returning({ id: helpCenterArticleFeedback.id });
    if (!existing && !created) throw conflict("A concurrent vote; retry");
    // A new vote adds one; a changed vote also takes one from the other count.
    const delta = (column: AnyColumn, gains: boolean) =>
      gains ? sql`${column} + 1` : existing ? sql`${column} - 1` : undefined;
    await db
      .update(helpCenterArticles)
      .set({
        helpfulCount: delta(helpCenterArticles.helpfulCount, helpful),
        notHelpfulCount: delta(helpCenterArticles.notHelpfulCount, !helpful),
      })
      .where(eq(helpCenterArticles.id, articleId));
    return { feedbackId: (existing ?? created)!.id, helpful, changed: true };
  },
});

const listReasons = defineQuillsRoute({
  method: "get",
  path: "/help-center/articles/{articleId}/feedback-reasons",
  operationId: "listQuillsHelpCenterArticleFeedbackReasons",
  summary: "List the reasons left on an article's not-helpful votes",
  action: "read",
  params: articleParams,
  query: z.object({ limit: limit(50) }),
  response: z.object({
    reasons: z.array(
      z.object({
        id: z.string(),
        reason: z.string(),
        createdAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "Reasons, newest first",
  errors: { 404: "Article not found" },
  handler: async ({ db, params: { articleId }, query }) => {
    const [found] = await db
      .select({ id: helpCenterArticles.id })
      .from(helpCenterArticles)
      .where(eq(helpCenterArticles.id, articleId));
    if (!found) throw notFound("Article");
    const rows = await db
      .select({
        id: helpCenterArticleFeedback.id,
        reason: helpCenterArticleFeedback.reason,
        createdAt: helpCenterArticleFeedback.createdAt,
      })
      .from(helpCenterArticleFeedback)
      .where(
        and(
          eq(helpCenterArticleFeedback.articleId, articleId),
          eq(helpCenterArticleFeedback.helpful, false),
          isNotNull(helpCenterArticleFeedback.reason),
        ),
      )
      .orderBy(desc(helpCenterArticleFeedback.createdAt))
      .limit(query.limit);
    return {
      reasons: rows.map((row) => ({ ...row, reason: row.reason ?? "" })),
    };
  },
});

const listPerformance = defineQuillsRoute({
  method: "get",
  path: "/help-center/analytics/articles",
  operationId: "listQuillsHelpCenterArticlePerformance",
  summary: "Rank live articles by views with their feedback counts",
  action: "read",
  query: z.object({ limit: limit(100) }),
  response: z.object({
    articles: z.array(
      z.object({
        id: z.string(),
        slug: z.string(),
        title: z.string(),
        status: z.enum(["draft", "scheduled", "published"]),
        categoryName: z.string(),
        viewCount: z.number(),
        helpfulCount: z.number(),
        notHelpfulCount: z.number(),
      }),
    ),
  }),
  responseDescription: "Articles by view count",
  handler: async ({ db, query }) => {
    const rows = await db
      .select({
        id: helpCenterArticles.id,
        slug: helpCenterArticles.slug,
        title: helpCenterArticles.title,
        publishedAt: helpCenterArticles.publishedAt,
        categoryName: helpCenterCategories.name,
        viewCount: helpCenterArticles.viewCount,
        helpfulCount: helpCenterArticles.helpfulCount,
        notHelpfulCount: helpCenterArticles.notHelpfulCount,
      })
      .from(helpCenterArticles)
      .innerJoin(
        helpCenterCategories,
        eq(helpCenterCategories.id, helpCenterArticles.categoryId),
      )
      .where(isNull(helpCenterArticles.deletedAt))
      .orderBy(
        desc(helpCenterArticles.viewCount),
        desc(helpCenterArticles.helpfulCount),
        desc(helpCenterArticles.id),
      )
      .limit(query.limit);
    return {
      articles: rows.map(({ publishedAt, ...row }) => ({
        ...row,
        status: statusOf(publishedAt),
      })),
    };
  },
});

/**
 * The days of search log that retention keeps: QUILLS_LOG_RETENTION_DAYS, as jobs/retention.ts
 * reads it (default 90). A longer window would read nothing more.
 */
function retainedDays() {
  const days = Number(process.env.QUILLS_LOG_RETENTION_DAYS ?? 90);
  return Number.isInteger(days) && days >= 1 && days <= 3650 ? days : 90;
}

const listSearchTerms = defineQuillsRoute({
  method: "get",
  path: "/help-center/analytics/search-terms",
  operationId: "listQuillsHelpCenterSearchTerms",
  summary: "Rank visitor search terms in a trailing window",
  description:
    "Terms are grouped after trimming, collapsing spaces and lower-casing. `zeroResultSearches` shows the content gaps. The window is `days`, at most the search log retention (QUILLS_LOG_RETENTION_DAYS, 90 by default); the response's `days` is the window used.",
  action: "read",
  query: z.object({
    days: z.coerce.number().int().min(1).max(365).default(30),
    limit: limit(50),
  }),
  response: z.object({
    days: z.number(),
    terms: z.array(
      z.object({
        term: z.string(),
        normalizedQuery: z.string(),
        searches: z.number(),
        zeroResultSearches: z.number(),
        lastSearchedAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "Terms by search count",
  handler: async ({ db, query }) => {
    const q = helpCenterSearchQueries;
    const days = Math.min(query.days, retainedDays());
    const rows = await db
      .select({
        term: sql<string>`(array_agg(${q.query} order by ${q.createdAt} desc))[1]`,
        normalizedQuery: q.normalizedQuery,
        searches: sql<number>`count(*)::int`,
        zeroResultSearches: sql<number>`(count(*) filter (where ${q.resultsCount} = 0))::int`,
        lastSearchedAt: sql<string>`max(${q.createdAt})`,
      })
      .from(q)
      .where(
        gte(q.createdAt, new Date(Date.now() - days * 24 * 60 * 60 * 1000)),
      )
      .groupBy(q.normalizedQuery)
      .orderBy(
        sql`count(*) desc, max(${q.createdAt}) desc, ${q.normalizedQuery}`,
      )
      .limit(query.limit);
    return {
      days,
      terms: rows.map((row) => ({
        ...row,
        lastSearchedAt: new Date(row.lastSearchedAt),
      })),
    };
  },
});

// Static analytics paths do not collide with /help-center/articles/{articleId}.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...recordFeedback)
  .openapi(...listReasons)
  .openapi(...listPerformance)
  .openapi(...listSearchTerms);
