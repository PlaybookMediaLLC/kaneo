import { and, eq } from "drizzle-orm";
import { isValidTypeId, type KbArticleId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../../openapi";
import {
  helpCenterArticleFeedback,
  helpCenterArticles,
  helpCenterCategories,
} from "../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../framework/define-route";
import { DEFAULT_LOCALE } from "../../content/help-center/shared";
import {
  articleSummary,
  uiLocale,
  notFound,
  openHelpCenter,
  publicArticle,
  publicCategory,
  summaryOf,
  visibleArticles,
  visibleCategories,
  visibleCategory,
} from "../../content/public/help-center/visibility";

// Widget help reads (widget audience; a widget session is optional). The help-center module and
// the widget must be on; the portal switch does not apply. An identified visitor also sees the
// content gated to their segments. A locale that is not enabled reads the default locale, as the
// widget sends its own UI locale.

const missing = { 404: "Help center, category or article not found" };

const categories = defineQuillsRoute({
  audience: "widget",
  signIn: false,
  method: "get",
  path: "/widget/help/categories",
  operationId: "listQuillsWidgetHelpCategories",
  summary: "List the help categories for the widget",
  action: "read",
  query: z.object({ locale: uiLocale }),
  response: z.object({
    locale: z.string(),
    categories: z.array(publicCategory),
  }),
  responseDescription: "Public categories with article counts",
  errors: missing,
  handler: async ({ db, caller, query }) => {
    const viewer = await openHelpCenter(db, caller, "widget", query.locale, {
      fallback: true,
    });
    return {
      locale: viewer.locale,
      categories: await visibleCategories(db, viewer),
    };
  },
});

const articles = defineQuillsRoute({
  audience: "widget",
  signIn: false,
  method: "get",
  path: "/widget/help/articles",
  operationId: "listQuillsWidgetHelpArticles",
  summary: "List help articles for the widget",
  description:
    "All public articles, or the direct articles of one category, in page order. Items leave out the body.",
  action: "read",
  query: z.object({
    locale: uiLocale,
    categoryId: flexibleToTypeIdSchema("kb_category").optional(),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
  response: z.object({
    locale: z.string(),
    articles: z.array(articleSummary),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "A page of articles",
  errors: missing,
  handler: async ({ db, caller, query }) => {
    const viewer = await openHelpCenter(db, caller, "widget", query.locale, {
      fallback: true,
    });
    if (query.categoryId) {
      const [found] = await db
        .select({ id: helpCenterCategories.id })
        .from(helpCenterCategories)
        .where(
          and(
            eq(helpCenterCategories.id, query.categoryId),
            visibleCategory(viewer.segmentIds),
          ),
        );
      if (!found) throw notFound("Category");
    }
    const rows = await visibleArticles(db, viewer, {
      where: query.categoryId
        ? eq(helpCenterArticles.categoryId, query.categoryId)
        : undefined,
      limit: query.limit + 1,
      offset: query.offset,
    });
    return {
      locale: viewer.locale,
      articles: rows.slice(0, query.limit).map(summaryOf),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  },
});

const article = defineQuillsRoute({
  audience: "widget",
  signIn: false,
  method: "get",
  path: "/widget/help/articles/{ref}",
  operationId: "getQuillsWidgetHelpArticle",
  summary: "Get a help article for the widget by ID or slug",
  description:
    "`ref` is an article TypeID or slug. Without a published translation in the locale the article comes in the default locale; `locale` names the one used. `helpful` is the visitor's own vote.",
  action: "read",
  params: z.object({
    ref: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9_-]*$/, "Use an article ID or slug"),
  }),
  query: z.object({ locale: uiLocale }),
  response: publicArticle.extend({
    locale: z.string(),
    helpful: z.boolean().nullable(),
  }),
  responseDescription: "The article",
  errors: missing,
  handler: async ({ db, caller, params, query }) => {
    const viewer = await openHelpCenter(db, caller, "widget", query.locale, {
      fallback: true,
    });
    const where = isValidTypeId(params.ref, "article")
      ? eq(helpCenterArticles.id, params.ref as KbArticleId)
      : eq(helpCenterArticles.slug, params.ref);
    const load = (locale: string) =>
      visibleArticles(
        db,
        { ...viewer, locale },
        { where, limit: 1, content: true },
      );
    let locale = viewer.locale;
    let [found] = await load(locale);
    if (!found && locale !== DEFAULT_LOCALE)
      [found] = await load((locale = DEFAULT_LOCALE));
    if (!found) throw notFound("Article");
    const [vote] = caller.principalId
      ? await db
          .select({ helpful: helpCenterArticleFeedback.helpful })
          .from(helpCenterArticleFeedback)
          .where(
            and(
              eq(helpCenterArticleFeedback.articleId, found.id as KbArticleId),
              eq(helpCenterArticleFeedback.principalId, caller.principalId),
            ),
          )
      : [];
    return { ...found, locale, helpful: vote?.helpful ?? null };
  },
});

export default apiRouter()
  .openapi(...categories)
  .openapi(...articles)
  .openapi(...article);
