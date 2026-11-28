import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import {
  helpCenterSearchQueries,
  kbSearchSynonyms,
} from "../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../framework/define-route";

const synonymSchema = z.object({
  id: z.string(),
  term: z.string(),
  synonyms: z.array(z.string()),
  createdAt: responseTimestamp,
});

const searchInsights = defineQuillsRoute({
  method: "get",
  path: "/help-center/search-insights",
  operationId: "getQuillsHelpCenterSearchInsights",
  summary: "Get help-center search insights: zero-result, zero-click and CTR",
  action: "read",
  query: z.object({
    days: pagingNumber(1, 366, 30),
    limit: pagingNumber(1, 100, 25),
  }),
  response: z.object({
    totalSearches: z.number(),
    zeroResultCount: z.number(),
    clickedCount: z.number(),
    clickThroughRate: z.number(),
    zeroResultQueries: z.array(
      z.object({
        query: z.string(),
        searches: z.number(),
        lastSearchedAt: responseTimestamp,
      }),
    ),
    zeroClickQueries: z.array(
      z.object({
        query: z.string(),
        searches: z.number(),
        avgResults: z.number(),
        lastSearchedAt: responseTimestamp,
      }),
    ),
    topQueries: z.array(
      z.object({
        query: z.string(),
        searches: z.number(),
        clicks: z.number(),
        clickThroughRate: z.number(),
      }),
    ),
  }),
  responseDescription: "Help-center search analytics",
  handler: async ({ db, query }) => {
    const since = new Date(Date.now() - query.days * 86_400_000);
    const [totals] = await db
      .select({
        total: sql<number>`count(*)::int`,
        zeroResults: sql<number>`count(*) filter (where ${helpCenterSearchQueries.resultsCount} = 0)::int`,
        clicked: sql<number>`count(*) filter (where ${helpCenterSearchQueries.clickedArticleId} is not null)::int`,
      })
      .from(helpCenterSearchQueries)
      .where(gte(helpCenterSearchQueries.createdAt, since));

    const totalSearches = totals?.total ?? 0;
    const zeroResultCount = totals?.zeroResults ?? 0;
    const clickedCount = totals?.clicked ?? 0;

    const zeroResultRows = await db
      .select({
        query: sql<string>`min(${helpCenterSearchQueries.query})`,
        searches: sql<number>`count(*)::int`,
        lastSearchedAt: sql<Date>`max(${helpCenterSearchQueries.createdAt})`,
      })
      .from(helpCenterSearchQueries)
      .where(
        and(
          gte(helpCenterSearchQueries.createdAt, since),
          eq(helpCenterSearchQueries.resultsCount, 0),
        ),
      )
      .groupBy(helpCenterSearchQueries.normalizedQuery)
      .orderBy(desc(sql`count(*)`))
      .limit(query.limit);

    const zeroClickRows = await db
      .select({
        query: sql<string>`min(${helpCenterSearchQueries.query})`,
        searches: sql<number>`count(*)::int`,
        avgResults: sql<number>`round(avg(${helpCenterSearchQueries.resultsCount}))::int`,
        lastSearchedAt: sql<Date>`max(${helpCenterSearchQueries.createdAt})`,
      })
      .from(helpCenterSearchQueries)
      .where(gte(helpCenterSearchQueries.createdAt, since))
      .groupBy(helpCenterSearchQueries.normalizedQuery)
      .having(
        sql`sum(case when ${helpCenterSearchQueries.resultsCount} > 0 then 1 else 0 end) > 0 and count(${helpCenterSearchQueries.clickedArticleId}) = 0`,
      )
      .orderBy(desc(sql`count(*)`))
      .limit(query.limit);

    const topRows = await db
      .select({
        query: sql<string>`min(${helpCenterSearchQueries.query})`,
        searches: sql<number>`count(*)::int`,
        clicks: sql<number>`count(${helpCenterSearchQueries.clickedArticleId})::int`,
      })
      .from(helpCenterSearchQueries)
      .where(gte(helpCenterSearchQueries.createdAt, since))
      .groupBy(helpCenterSearchQueries.normalizedQuery)
      .orderBy(desc(sql`count(*)`))
      .limit(query.limit);

    return {
      totalSearches,
      zeroResultCount,
      clickedCount,
      clickThroughRate: totalSearches
        ? Math.round((clickedCount / totalSearches) * 1000) / 1000
        : 0,
      zeroResultQueries: zeroResultRows.map((row) => ({
        query: row.query,
        searches: row.searches,
        lastSearchedAt: new Date(row.lastSearchedAt),
      })),
      zeroClickQueries: zeroClickRows.map((row) => ({
        query: row.query,
        searches: row.searches,
        avgResults: row.avgResults,
        lastSearchedAt: new Date(row.lastSearchedAt),
      })),
      topQueries: topRows.map((row) => ({
        query: row.query,
        searches: row.searches,
        clicks: row.clicks,
        clickThroughRate: row.searches
          ? Math.round((row.clicks / row.searches) * 1000) / 1000
          : 0,
      })),
    };
  },
});

const listSynonyms = defineQuillsRoute({
  method: "get",
  path: "/help-center/search-synonyms",
  operationId: "listQuillsHelpCenterSearchSynonyms",
  summary: "List help-center search synonyms",
  action: "read",
  response: z.object({ items: z.array(synonymSchema) }),
  responseDescription: "Configured synonym groups",
  handler: async ({ db }) => {
    const rows = await db
      .select({
        id: kbSearchSynonyms.id,
        term: kbSearchSynonyms.term,
        synonyms: kbSearchSynonyms.synonyms,
        createdAt: kbSearchSynonyms.createdAt,
      })
      .from(kbSearchSynonyms)
      .orderBy(asc(kbSearchSynonyms.term));
    return { items: rows };
  },
});

const createSynonym = defineQuillsRoute({
  method: "post",
  path: "/help-center/search-synonyms",
  operationId: "createQuillsHelpCenterSearchSynonym",
  summary: "Create or update a help-center search synonym group",
  action: "update",
  body: z.object({
    term: z.string().trim().min(1).max(100),
    synonyms: z.array(z.string().trim().min(1).max(100)).min(1).max(20),
  }),
  response: synonymSchema,
  responseDescription: "Saved synonym group",
  event: (_input, result) => ({
    type: "help_center.search_synonym_created",
    entityType: "kb_synonym",
    entityId: result.id,
    payload: { term: result.term },
  }),
  handler: async ({ db, body }) => {
    const normalizedTerm = body.term.toLowerCase();
    const cleaned = [
      ...new Set(
        body.synonyms
          .map((s) => s.trim().toLowerCase())
          .filter((s) => s.length > 0 && s !== normalizedTerm),
      ),
    ];
    if (!cleaned.length) {
      throw new HTTPException(400, {
        message: "Provide at least one synonym distinct from the term",
      });
    }
    const res = await db.execute<{
      id: string;
      term: string;
      synonyms: string[];
      created_at: Date;
    }>(
      sql`INSERT INTO quills.kb_search_synonyms (term, synonyms)
          VALUES (${normalizedTerm}, ${JSON.stringify(cleaned)}::jsonb)
          ON CONFLICT (workspace_id, lower(term))
          DO UPDATE SET synonyms = EXCLUDED.synonyms
          RETURNING id, term, synonyms, created_at`,
    );
    const saved = res.rows[0]!;
    return {
      id: saved.id,
      term: saved.term,
      synonyms: saved.synonyms,
      createdAt: new Date(saved.created_at),
    };
  },
});

const deleteSynonym = defineQuillsRoute({
  method: "delete",
  path: "/help-center/search-synonyms/{synonymId}",
  operationId: "deleteQuillsHelpCenterSearchSynonym",
  summary: "Delete a help-center search synonym group",
  action: "update",
  params: z.object({ synonymId: z.uuid() }),
  response: z.object({ id: z.string() }),
  responseDescription: "Deleted synonym group ID",
  errors: { 404: "Synonym group not found" },
  event: ({ params }) => ({
    type: "help_center.search_synonym_deleted",
    entityType: "kb_synonym",
    entityId: params.synonymId,
  }),
  handler: async ({ db, params }) => {
    const [deleted] = await db
      .delete(kbSearchSynonyms)
      .where(eq(kbSearchSynonyms.id, params.synonymId))
      .returning({ id: kbSearchSynonyms.id });
    if (!deleted)
      throw new HTTPException(404, { message: "Synonym group not found" });
    return deleted;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...searchInsights)
  .openapi(...listSynonyms)
  .openapi(...createSynonym)
  .openapi(...deleteSynonym);
