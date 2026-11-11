import { asc, ilike, or, sql } from "drizzle-orm";
import { apiRouter, z } from "../../../../openapi";
import {
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterSearchQueries,
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

// Keyword search over public articles, shared by the portal and the widget. The source adds a
// semantic ranking from article embeddings; that needs the AI provider (P8). Each search is a
// POST because it records one search-term row for the help-center analytics.

export const searchBody = z.object({
  query: z.string().trim().min(1).max(200),
  locale: uiLocale,
  limit: z.number().int().min(1).max(20).default(10),
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
  none: "Records one search-term analytics row and no domain change",
};

/** `%`, `_` and `\` match themselves in an ILIKE pattern. */
export const likePattern = (text: string) =>
  `%${text.replace(/[\\%_]/g, "\\$&")}%`;

/** Full-text matches and title substring matches, best first; records the search. */
export async function searchArticles(
  db: Db,
  viewer: Viewer,
  text: string,
  limit: number,
) {
  const localized = viewer.locale !== DEFAULT_LOCALE;
  const source = localized ? helpCenterArticleTranslations : helpCenterArticles;
  const tsQuery = sql`websearch_to_tsquery(${regconfigForLocale(viewer.locale)}::regconfig, ${text})`;
  const rows = await visibleArticles(db, viewer, {
    where: or(
      sql`${source.searchVector} @@ ${tsQuery}`,
      ilike(source.title, likePattern(text)),
    ),
    orderBy: [
      sql`ts_rank(${source.searchVector}, ${tsQuery}) desc`,
      asc(helpCenterArticles.id),
    ],
    limit,
    content: true,
  });
  const collapsed = text.replace(/\s+/g, " ");
  await db.insert(helpCenterSearchQueries).values({
    query: collapsed.slice(0, 200),
    normalizedQuery: collapsed.toLowerCase().slice(0, 200),
    locale: viewer.locale,
    resultsCount: rows.length,
  });
  return rows.map((row) => ({
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
  }));
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
    "Keyword search over public articles in the locale. A signed-in customer also finds articles gated to their segments.",
  action: "read",
  body: searchBody,
  response: z.object({ locale: z.string(), articles: z.array(searchHit) }),
  responseDescription: "Matching articles, best first",
  errors: { 404: "Help center not found" },
  event: searchEvent,
  handler: async ({ db, caller, body }) => {
    const viewer = await openHelpCenter(db, caller, "portal", body.locale, {
      fallback: true,
    });
    return {
      locale: viewer.locale,
      articles: await searchArticles(db, viewer, body.query, body.limit),
    };
  },
});

export default apiRouter().openapi(...search);
