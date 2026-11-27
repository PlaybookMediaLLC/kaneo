import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../../../openapi";
import {
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterSearchQueries,
  kbSearchSynonyms,
  regconfigForLocale,
} from "../../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../../framework/define-route";
import { DEFAULT_LOCALE } from "../../help-center/shared";
import {
  openHelpCenter,
  uiLocale,
  visibleArticles,
  type Db,
  type Viewer,
} from "./visibility";

// Hybrid KB search (#315) shared by the portal and the widget:
// - Workspace synonym expansion (quills.kb_search_synonyms)
// - Prefix full-text matching + websearch_to_tsquery
// - pg_trgm typo tolerance (word_similarity / similarity)
// - Click-through tracking on recorded kb_search_queries rows

export const searchBody = z.object({
  query: z.string().trim().min(1).max(200),
  locale: uiLocale,
  limit: z.number().int().min(1).max(20).default(10),
  record: z.boolean().default(true).openapi({
    description:
      "false: leave the search out of the help-center analytics, for suggestions while typing",
  }),
});
export const searchHit = z
  .object({
    id: z.string(),
    urlId: z.number(),
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    snippet: z.string().openapi({ description: "The first 200 characters" }),
    path: z.string(),
    category: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  })
  .openapi("QuillsPublicHelpCenterSearchHit");
/** One search attempt per second on average for a client, as in the source widget search. */
export const searchRateLimit = { limit: 60, windowSeconds: 60 };
export const searchEvent = {
  none: "Records one search-term analytics row (none with record false) and no domain change",
};

/** `%`, `_` and `\` match themselves in an ILIKE pattern. */
export const likePattern = (text: string) =>
  `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** Expands a user query using workspace synonym rows (bidirectional whole-word/phrase matching). */
export function expandWithSynonyms(
  text: string,
  rows: ReadonlyArray<{ term: string; synonyms: string[] }>,
): string[] {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return [];
  const tokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const padded = ` ${tokens.join(" ")} `;
  const expanded = new Set<string>([text.trim()]);
  for (const row of rows) {
    const group = [row.term, ...row.synonyms]
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const matches = group.some((phrase) => {
      const phraseTokens = phrase
        .split(/[^\p{L}\p{N}]+/u)
        .map((t) => t.trim())
        .filter(Boolean);
      if (!phraseTokens.length) return false;
      if (phraseTokens.length === 1) {
        return tokens.includes(phraseTokens[0]!);
      }
      return padded.includes(` ${phraseTokens.join(" ")} `);
    });
    if (matches) {
      for (const phrase of group) {
        if (phrase !== normalized) expanded.add(phrase);
      }
    }
  }
  return [...expanded].slice(0, 8);
}

/** Builds a safe Unicode prefix tsquery string (e.g. "bill inv" -> "bill:* & inv:*"). */
function prefixTsQueryText(text: string): string | null {
  const words = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `${w}:*`).join(" & ");
}

/**
 * Hybrid search over visible articles (synonyms + FTS + prefix FTS + pg_trgm typo tolerance),
 * returning both ranked hits and the recorded search query ID for click-through tracking.
 */
export async function searchArticlesWithMeta(
  db: Db,
  viewer: Viewer,
  text: string,
  limit: number,
  record = true,
) {
  const localized = viewer.locale !== DEFAULT_LOCALE;
  const source = localized ? helpCenterArticleTranslations : helpCenterArticles;
  const regconfig = regconfigForLocale(viewer.locale);

  const synonymRows = await db
    .select({
      term: kbSearchSynonyms.term,
      synonyms: kbSearchSynonyms.synonyms,
    })
    .from(kbSearchSynonyms)
    .limit(200);
  const terms = expandWithSynonyms(text, synonymRows);

  const primaryTsQuery = sql`websearch_to_tsquery(${regconfig}::regconfig, ${text})`;
  const prefixText = prefixTsQueryText(text);
  const prefixTsQuery = prefixText
    ? sql`to_tsquery(${regconfig}::regconfig, ${prefixText})`
    : null;

  const matchClauses = terms.flatMap((term) => {
    const termTs = sql`websearch_to_tsquery(${regconfig}::regconfig, ${term})`;
    const termPrefix = prefixTsQueryText(term);
    return [
      sql`${source.searchVector} @@ ${termTs}`,
      ...(termPrefix
        ? [
            sql`${source.searchVector} @@ to_tsquery(${regconfig}::regconfig, ${termPrefix})`,
          ]
        : []),
      ilike(source.title, likePattern(term)),
      ...(term.length >= 3
        ? [
            sql`word_similarity(${term}, ${source.title}) >= 0.35`,
            sql`similarity(${source.title}, ${term}) >= 0.25`,
          ]
        : []),
    ];
  });

  const rankExpr = prefixTsQuery
    ? sql`(
        coalesce(ts_rank(${source.searchVector}, ${primaryTsQuery}), 0) * 2.0
        + coalesce(ts_rank(${source.searchVector}, ${prefixTsQuery}), 0) * 1.5
        + coalesce(word_similarity(${text}, ${source.title}), 0) * 1.2
        + coalesce(similarity(${source.title}, ${text}), 0)
      )`
    : sql`(
        coalesce(ts_rank(${source.searchVector}, ${primaryTsQuery}), 0) * 2.0
        + coalesce(word_similarity(${text}, ${source.title}), 0) * 1.2
        + coalesce(similarity(${source.title}, ${text}), 0)
      )`;

  const rows = await visibleArticles(db, viewer, {
    where: or(...matchClauses),
    orderBy: [sql`${rankExpr} desc`, asc(helpCenterArticles.id)],
    limit,
    content: true,
  });

  const collapsed = text.replace(/\s+/g, " ");
  let queryId: string | null = null;
  if (record) {
    const [logged] = await db
      .insert(helpCenterSearchQueries)
      .values({
        query: collapsed.slice(0, 200),
        normalizedQuery: collapsed.toLowerCase().slice(0, 200),
        locale: viewer.locale,
        resultsCount: rows.length,
      })
      .returning({ id: helpCenterSearchQueries.id });
    queryId = logged?.id ?? null;
  }

  return {
    queryId,
    articles: rows.map((row) => ({
      id: row.id,
      urlId: row.urlId,
      slug: row.slug,
      title: row.title,
      description: row.description,
      snippet: row.content.slice(0, 200),
      path: row.path,
      category: {
        id: row.category.id,
        slug: row.category.slug,
        name: row.category.name,
      },
    })),
  };
}

/** Backwards-compatible helper returning only the matched articles array. */
export async function searchArticles(
  db: Db,
  viewer: Viewer,
  text: string,
  limit: number,
  record = true,
) {
  return (await searchArticlesWithMeta(db, viewer, text, limit, record))
    .articles;
}

/** Records a clicked article against a previously logged search query row (only for articles visible to the viewer). */
export async function recordSearchClick(
  db: Db,
  viewer: Viewer,
  queryId: string,
  articleId: string,
) {
  const [article] = await visibleArticles(db, viewer, {
    where: eq(helpCenterArticles.id, articleId as never),
    limit: 1,
  });
  if (!article) throw new HTTPException(404, { message: "Article not found" });

  const [updated] = await db
    .update(helpCenterSearchQueries)
    .set({
      clickedArticleId: article.id as never,
      clickedAt: new Date(),
    })
    .where(
      and(
        eq(helpCenterSearchQueries.id, queryId),
        isNull(helpCenterSearchQueries.clickedArticleId),
      ),
    )
    .returning({ id: helpCenterSearchQueries.id });
  if (!updated) {
    const [exists] = await db
      .select({ id: helpCenterSearchQueries.id })
      .from(helpCenterSearchQueries)
      .where(eq(helpCenterSearchQueries.id, queryId))
      .limit(1);
    if (!exists) {
      throw new HTTPException(404, { message: "Search query not found" });
    }
  }
  return { recorded: true as const };
}

const search = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  rateLimit: searchRateLimit,
  method: "post",
  path: "/hc/search",
  operationId: "searchQuillsPublicHelpCenter",
  summary: "Search the public help center",
  description:
    "Hybrid search (FTS, prefix, pg_trgm typo tolerance and workspace synonyms) over public articles in the locale. Returns queryId for click-through tracking.",
  action: "read",
  body: searchBody,
  response: z.object({
    locale: z.string(),
    queryId: z.string().nullable(),
    articles: z.array(searchHit),
  }),
  responseDescription: "Matching articles, best first",
  errors: { 404: "Help center not found" },
  event: searchEvent,
  handler: async ({ db, caller, body }) => {
    const viewer = await openHelpCenter(db, caller, "portal", body.locale, {
      fallback: true,
    });
    const result = await searchArticlesWithMeta(
      db,
      viewer,
      body.query,
      body.limit,
      body.record,
    );
    return {
      locale: viewer.locale,
      queryId: result.queryId,
      articles: result.articles,
    };
  },
});

const click = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  rateLimit: searchRateLimit,
  method: "post",
  path: "/hc/search/{queryId}/click",
  operationId: "recordQuillsPublicHelpCenterSearchClick",
  summary: "Record which article a visitor clicked from a help-center search",
  action: "update",
  params: z.object({ queryId: z.uuid() }),
  body: z.object({ articleId: flexibleToTypeIdSchema("article") }),
  response: z.object({ recorded: z.literal(true) }),
  responseDescription: "Click recorded",
  errors: { 404: "Help center, search query or article not found" },
  event: { none: "Click-through analytics update on kb_search_queries" },
  handler: async ({ db, caller, params, body }) => {
    const viewer = await openHelpCenter(db, caller, "portal", undefined, {
      fallback: true,
    });
    return recordSearchClick(db, viewer, params.queryId, body.articleId);
  },
});

export default apiRouter()
  .openapi(...search)
  .openapi(...click);
