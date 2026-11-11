import { and, desc, eq, isNotNull } from "drizzle-orm";
import { isValidTypeId, type KbArticleId, type KbCategoryId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z } from "../../../../openapi";
import { principal } from "../../../../database/quills/schema/auth";
import {
  helpCenterArticles,
  helpCenterCategories,
  helpCenterRedirectRules,
} from "../../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../../framework/define-route";
import { DEFAULT_LOCALE, slug } from "../../help-center/shared";
import { normalize } from "../../help-center/redirect-rules";
import {
  articlePath,
  articlesByCategory,
  articleSummary,
  collectionPath,
  localeQuery,
  notFound,
  openHelpCenter,
  publicArticle,
  publicCategory,
  summaryOf,
  visibleArticle,
  visibleArticles,
  visibleCategories,
  visibleCategory,
  type Db,
  type PublicCategory,
  type Viewer,
} from "./visibility";

// Public help-center pages (portal audience, sign-in optional). A signed-in customer also sees
// the categories and articles gated to their segments. Every route answers 404 while the portal
// or the help-center module is off, or the private-portal gate denies the caller.

const query = z.object(localeQuery);
/** `{urlId}-{slug}`, the public URL form. The numeric ID decides; the slug is cosmetic. */
const idSlug = z
  .string()
  .max(220)
  .regex(/^\d{1,9}(-[a-z0-9-]*)?$/, "Use {urlId}-{slug}")
  .openapi({ description: "{urlId}-{slug}, for example 12-getting-started" });
const urlIdOf = (value: string) => Number.parseInt(value, 10);
const missing = { 404: "Help center, locale or page not found" };

const categoryPage = z.object({
  canonicalPath: z.string(),
  category: publicCategory,
  articles: z.array(articleSummary),
  subcategories: z.array(
    publicCategory.extend({ articles: z.array(articleSummary) }),
  ),
  categories: z.array(publicCategory).openapi({
    description: "Every public category, for navigation and breadcrumbs",
  }),
});

async function pageOf(
  db: Db,
  viewer: Viewer,
  find: (category: PublicCategory) => boolean,
) {
  const categories = await visibleCategories(db, viewer);
  const category = categories.find(find);
  if (!category) throw notFound("Category");
  const subcategories = categories.filter((c) => c.parentId === category.id);
  const articles = await articlesByCategory(db, viewer, [
    category.id,
    ...subcategories.map((c) => c.id),
  ]);
  return {
    canonicalPath: category.path,
    category,
    articles: articles.get(category.id) ?? [],
    subcategories: subcategories.map((sub) => ({
      ...sub,
      articles: articles.get(sub.id) ?? [],
    })),
    categories,
  };
}

const home = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc",
  operationId: "getQuillsPublicHelpCenter",
  summary: "Get the public help-center home page",
  description:
    "Homepage text in the locale, header links, SEO switches, public categories and the six most-read articles.",
  action: "read",
  query,
  response: z.object({
    locale: z.string(),
    locales: z.array(z.string()),
    homepageTitle: z.string(),
    homepageDescription: z.string(),
    searchPlaceholder: z.string().nullable(),
    headerLinks: z.array(z.object({ label: z.string(), url: z.string() })),
    seo: z.object({
      metaDescription: z.string(),
      indexable: z.boolean(),
      structuredDataEnabled: z.boolean(),
    }),
    categories: z.array(publicCategory),
    popular: z.array(articleSummary),
  }),
  responseDescription: "The home page",
  errors: missing,
  handler: async ({ db, caller, query }) => {
    const viewer = await openHelpCenter(db, caller, "portal", query.locale);
    const { config } = viewer;
    const chrome =
      viewer.locale === DEFAULT_LOCALE
        ? undefined
        : config.locales.chrome[viewer.locale];
    const popular = await visibleArticles(db, viewer, {
      orderBy: [
        desc(helpCenterArticles.viewCount),
        desc(helpCenterArticles.publishedAt),
      ],
      limit: 6,
    });
    return {
      locale: viewer.locale,
      locales: [DEFAULT_LOCALE, ...config.locales.additional],
      homepageTitle: chrome?.homepageTitle || config.homepageTitle,
      homepageDescription:
        chrome?.homepageDescription || config.homepageDescription,
      searchPlaceholder: chrome?.searchPlaceholder || null,
      headerLinks: config.headerLinks.map(({ label, url }) => ({ label, url })),
      seo: {
        metaDescription: config.seo.metaDescription,
        indexable: config.seo.indexable,
        structuredDataEnabled: config.seo.structuredDataEnabled,
      },
      categories: await visibleCategories(db, viewer),
      popular: popular.map(summaryOf),
    };
  },
});

const bySlug = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc/categories/{categorySlug}",
  operationId: "getQuillsPublicHelpCenterCategory",
  summary: "Get a public help-center category page by slug",
  description:
    "The category, its articles, its public subcategories with their articles, and every public category. `canonicalPath` is the collection URL.",
  action: "read",
  params: z.object({ categorySlug: slug }),
  query,
  response: categoryPage,
  responseDescription: "The category page",
  errors: missing,
  handler: async ({ db, caller, params, query }) =>
    pageOf(
      db,
      await openHelpCenter(db, caller, "portal", query.locale),
      (category) => category.slug === params.categorySlug,
    ),
});

const collection = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc/collections/{idSlug}",
  operationId: "getQuillsPublicHelpCenterCollection",
  summary: "Get a public help-center collection page",
  description:
    "The same page as the slug route, looked up by the stable numeric URL ID.",
  action: "read",
  params: z.object({ idSlug }),
  query,
  response: categoryPage,
  responseDescription: "The collection page",
  errors: missing,
  handler: async ({ db, caller, params, query }) =>
    pageOf(
      db,
      await openHelpCenter(db, caller, "portal", query.locale),
      (category) => category.urlId === urlIdOf(params.idSlug),
    ),
});

const articlePage = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc/articles/{idSlug}",
  operationId: "getQuillsPublicHelpCenterArticle",
  summary: "Get a public help-center article page",
  description:
    "The article in the locale, the other public articles of its category and every public category. Helpfulness counts are not public.",
  action: "read",
  params: z.object({ idSlug }),
  query,
  response: z.object({
    canonicalPath: z.string(),
    article: publicArticle,
    articles: z.array(articleSummary).openapi({
      description: "Public articles of the same category, this one included",
    }),
    categories: z.array(publicCategory),
  }),
  responseDescription: "The article page",
  errors: missing,
  handler: async ({ db, caller, params, query }) => {
    const viewer = await openHelpCenter(db, caller, "portal", query.locale);
    const [article] = await visibleArticles(db, viewer, {
      where: eq(helpCenterArticles.urlId, urlIdOf(params.idSlug)),
      limit: 1,
      content: true,
    });
    if (!article) throw notFound("Article");
    const siblings = await articlesByCategory(db, viewer, [
      article.category.id,
    ]);
    return {
      canonicalPath: article.path,
      article,
      articles: siblings.get(article.category.id) ?? [],
      categories: await visibleCategories(db, viewer),
    };
  },
});

const categoryArticles = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc/categories/{categoryId}/articles",
  operationId: "listQuillsPublicHelpCenterCategoryArticles",
  summary: "List the public articles of a category",
  description: "Direct articles only, at most 100, in page order.",
  action: "read",
  params: z.object({ categoryId: flexibleToTypeIdSchema("kb_category") }),
  query,
  response: z.object({ articles: z.array(articleSummary) }),
  responseDescription: "The category's public articles",
  errors: missing,
  handler: async ({ db, caller, params, query }) => {
    const viewer = await openHelpCenter(db, caller, "portal", query.locale);
    const [found] = await db
      .select({ id: helpCenterCategories.id })
      .from(helpCenterCategories)
      .where(
        and(
          eq(helpCenterCategories.id, params.categoryId),
          visibleCategory(viewer.segmentIds),
        ),
      );
    if (!found) throw notFound("Category");
    const articles = await articlesByCategory(db, viewer, [found.id]);
    return { articles: articles.get(found.id) ?? [] };
  },
});

const editors = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc/editors",
  operationId: "listQuillsPublicHelpCenterEditors",
  summary: "List the teammates who wrote each category's public articles",
  description:
    "Names only, at most three per category, most recent author first. Only public articles count.",
  action: "read",
  response: z.object({
    categories: z.array(
      z.object({ categoryId: z.string(), names: z.array(z.string()) }),
    ),
  }),
  responseDescription: "Authors by category",
  errors: missing,
  handler: async ({ db, caller }) => {
    const viewer = await openHelpCenter(db, caller, "portal", undefined);
    // ponytail: newest 2,000 public articles; aggregate in SQL if one help center outgrows that.
    const rows = await db
      .select({
        categoryId: helpCenterArticles.categoryId,
        name: principal.displayName,
      })
      .from(helpCenterArticles)
      .innerJoin(
        helpCenterCategories,
        eq(helpCenterCategories.id, helpCenterArticles.categoryId),
      )
      .innerJoin(
        principal,
        and(
          eq(principal.id, helpCenterArticles.principalId),
          isNotNull(principal.kaneoUserId),
        ),
      )
      .where(visibleArticle(viewer.segmentIds))
      .orderBy(desc(helpCenterArticles.publishedAt))
      .limit(2000);
    const names = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = names.get(row.categoryId) ?? new Set<string>();
      if (row.name && set.size < 3) set.add(row.name);
      names.set(row.categoryId, set);
    }
    return {
      categories: [...names]
        .filter(([, set]) => set.size)
        .map(([categoryId, set]) => ({ categoryId, names: [...set] })),
    };
  },
});

const redirect = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc/redirect",
  operationId: "resolveQuillsPublicHelpCenterRedirect",
  summary: "Look up the redirect rule for an unmatched help-center path",
  description:
    "The canonical path of the rule's target, or null when no rule matches or the target is not public.",
  action: "read",
  query: z.object({
    path: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine((value) => value.startsWith("/"), "Path must start with /"),
  }),
  response: z.object({ target: z.string().nullable() }),
  responseDescription: "The redirect target",
  errors: missing,
  handler: async ({ db, caller, query }) => {
    const viewer = await openHelpCenter(db, caller, "portal", undefined);
    const [rule] = await db
      .select({
        targetType: helpCenterRedirectRules.targetType,
        targetId: helpCenterRedirectRules.targetId,
      })
      .from(helpCenterRedirectRules)
      .where(eq(helpCenterRedirectRules.path, normalize(query.path)));
    if (
      rule?.targetType === "article" &&
      isValidTypeId(rule.targetId, "article")
    ) {
      const [article] = await db
        .select({
          urlId: helpCenterArticles.urlId,
          slug: helpCenterArticles.slug,
        })
        .from(helpCenterArticles)
        .innerJoin(
          helpCenterCategories,
          eq(helpCenterCategories.id, helpCenterArticles.categoryId),
        )
        .where(
          and(
            eq(helpCenterArticles.id, rule.targetId as KbArticleId),
            visibleArticle(viewer.segmentIds),
          ),
        );
      if (article)
        return {
          target: articlePath(DEFAULT_LOCALE, article.urlId, article.slug),
        };
    }
    if (
      rule?.targetType === "category" &&
      isValidTypeId(rule.targetId, "kb_category")
    ) {
      const [category] = await db
        .select({
          urlId: helpCenterCategories.urlId,
          slug: helpCenterCategories.slug,
        })
        .from(helpCenterCategories)
        .where(
          and(
            eq(helpCenterCategories.id, rule.targetId as KbCategoryId),
            visibleCategory(viewer.segmentIds),
          ),
        );
      if (category)
        return {
          target: collectionPath(DEFAULT_LOCALE, category.urlId, category.slug),
        };
    }
    return { target: null };
  },
});

export default apiRouter()
  .openapi(...home)
  .openapi(...bySlug)
  .openapi(...collection)
  .openapi(...articlePage)
  .openapi(...categoryArticles)
  .openapi(...editors)
  .openapi(...redirect);
