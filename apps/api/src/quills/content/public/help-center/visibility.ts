// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import {
  and,
  asc,
  count,
  eq,
  isNotNull,
  isNull,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { KbCategoryId } from "@kaneo/ids";
import { responseTimestamp, z } from "../../../../openapi";
import { principal, settings } from "../../../../database/quills/schema/auth";
import {
  helpCenterArticles,
  helpCenterArticleTranslations,
  helpCenterCategories,
  helpCenterCategoryTranslations,
} from "../../../../database/quills/schema/kb";
import {
  segments,
  userSegments,
} from "../../../../database/quills/schema/segments";
import {
  evaluatePortalAccess,
  widgetEnabled,
  type QuillsCaller,
} from "../../../framework/audience";
import { parseBag } from "../../../feedback/settings-json";
import { parseJson } from "../../../settings/area";
import { resolveFlags } from "../../../settings/labs";
import { normalizeLocale } from "../../../widget/config";
import {
  DEFAULT_LOCALE,
  locale,
  readConfig,
  type Db,
  type HelpCenterConfig,
} from "../../help-center/shared";

// What a visitor may read in the help center. Every public read goes through these predicates:
// a live, published (not scheduled) article in a live, public category, past both segment gates.
// For another locale the article also needs a published translation. A teammate on these routes
// is a visitor: drafts and gated rows stay hidden.

export type { Db };
export const notFound = (what: string) =>
  new HTTPException(404, { message: `${what} not found` });

/** The live segments of the caller's principal. An anonymous caller has none. */
export async function viewerSegments(
  db: Db,
  principalId: QuillsCaller["principalId"],
) {
  if (!principalId) return [];
  const rows = await db
    .select({ id: userSegments.segmentId })
    .from(userSegments)
    .innerJoin(segments, eq(segments.id, userSegments.segmentId))
    .where(
      and(
        eq(userSegments.principalId, principalId),
        isNull(segments.deletedAt),
      ),
    );
  return rows.map((row) => String(row.id));
}

/** "[] = everyone": a gated row needs the viewer in one of its segments. */
export const segmentGate = (column: AnyColumn, segmentIds: string[]): SQL =>
  segmentIds.length
    ? sql`(jsonb_array_length(${column}) = 0 or ${column} ?| array[${sql.join(
        segmentIds.map((id) => sql`${id}`),
        sql`, `,
      )}]::text[])`
    : sql`jsonb_array_length(${column}) = 0`;

const c = helpCenterCategories;
const a = helpCenterArticles;
const t = helpCenterArticleTranslations;
const ct = helpCenterCategoryTranslations;

export const visibleCategory = (segmentIds: string[]) =>
  and(
    isNull(c.deletedAt),
    eq(c.isPublic, true),
    segmentGate(c.segmentIds, segmentIds),
  );

/** Needs `kb_categories` joined on the article's category. */
export const visibleArticle = (segmentIds: string[]) =>
  and(
    isNull(a.deletedAt),
    isNotNull(a.publishedAt),
    lte(a.publishedAt, sql`now()`),
    segmentGate(a.segmentIds, segmentIds),
    visibleCategory(segmentIds),
  );

export type Viewer = {
  segmentIds: string[];
  /** The locale the request reads: the default or an enabled one. */
  locale: string;
  config: HelpCenterConfig;
};

/** The locale query every public help-center read takes. */
export const localeQuery = {
  locale: locale.optional().openapi({
    description: "The default locale (en) when left out",
  }),
};

/**
 * For the widget and search, which pass the visitor's UI locale: any BCP-47 tag, such as pt-BR.
 * A tag without a supported locale reads as left out, so the default locale answers.
 */
export const uiLocale = z
  .string()
  .trim()
  .max(35)
  .transform((tag) => normalizeLocale(tag) ?? undefined)
  .optional()
  .openapi({
    type: "string",
    description:
      "A BCP-47 tag; an unsupported or disabled locale reads the default locale",
  });

/**
 * The default locale, an enabled one, or (with `fallback`) the default for any other value.
 * Without `fallback` a locale that is not enabled is 404, as an unknown `/hc/{locale}` page is.
 */
export function resolveLocale(
  config: HelpCenterConfig,
  requested: string | undefined,
  fallback = false,
) {
  if (!requested || requested === DEFAULT_LOCALE) return DEFAULT_LOCALE;
  if (config.locales.additional.includes(requested as never)) return requested;
  if (fallback) return DEFAULT_LOCALE;
  throw notFound("Locale");
}

/**
 * Opens the help center for a portal or widget caller, or answers 404. The portal needs the
 * portal and the help-center module on and the private-portal gate passed; the widget needs the
 * module and the widget on. `anonymous` reads as a visitor without segments (the sitemap).
 */
export async function openHelpCenter(
  db: Db,
  caller: QuillsCaller,
  surface: "portal" | "widget",
  requested: string | undefined,
  options: { fallback?: boolean; anonymous?: boolean } = {},
): Promise<Viewer> {
  const [row] = await db
    .select({
      portalConfig: settings.portalConfig,
      featureFlags: settings.featureFlags,
      widgetConfig: settings.widgetConfig,
    })
    .from(settings);
  const open =
    resolveFlags(parseJson(row?.featureFlags ?? null)).helpCenter &&
    (surface === "portal"
      ? parseBag(row?.portalConfig ?? null)?.enabled === true &&
        (
          await evaluatePortalAccess(
            db,
            options.anonymous
              ? { principalId: null, customerId: null, account: null }
              : caller,
          )
        ).granted
      : widgetEnabled(row?.widgetConfig ?? null));
  if (!open) throw notFound("Help center");
  const config = await readConfig(db);
  return {
    config,
    locale: resolveLocale(config, requested, options.fallback),
    segmentIds: options.anonymous
      ? []
      : await viewerSegments(db, caller.principalId),
  };
}

export const articlePath = (code: string, urlId: number, slug: string) =>
  `/hc/${code}/articles/${urlId}-${slug}`;
export const collectionPath = (code: string, urlId: number, slug: string) =>
  `/hc/${code}/collections/${urlId}-${slug}`;

export const publicCategory = z
  .object({
    id: z.string(),
    urlId: z.number(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    parentId: z.string().nullable().openapi({
      description: "Null at the top level and when the parent is not public",
    }),
    articleCount: z.number().openapi({
      description: "Public articles here and in public subcategories",
    }),
    path: z.string(),
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsPublicHelpCenterCategory");

/**
 * The public categories the viewer may see in the locale, with public article counts that
 * include public subcategories. A category with no public article is left out, and so is one
 * without a translated name in another locale.
 */
export async function visibleCategories(db: Db, viewer: Viewer) {
  const localized = viewer.locale !== DEFAULT_LOCALE;
  // ponytail: one read of up to 1,000 categories per request; page it if a help center grows past that.
  const rows = await db
    .select({
      id: c.id,
      urlId: c.urlId,
      slug: c.slug,
      name: c.name,
      description: c.description,
      translatedName: ct.name,
      translatedDescription: ct.description,
      icon: c.icon,
      parentId: c.parentId,
      updatedAt: c.updatedAt,
    })
    .from(c)
    .leftJoin(ct, and(eq(ct.categoryId, c.id), eq(ct.locale, viewer.locale)))
    .where(
      and(
        visibleCategory(viewer.segmentIds),
        localized ? sql`trim(coalesce(${ct.name}, '')) <> ''` : undefined,
      ),
    )
    .orderBy(asc(c.position), asc(c.name), asc(c.id))
    .limit(1000);
  const counts = await db
    .select({ categoryId: a.categoryId, n: count() })
    .from(a)
    .innerJoin(c, eq(c.id, a.categoryId))
    .leftJoin(t, publishedTranslation(viewer.locale))
    .where(
      and(
        visibleArticle(viewer.segmentIds),
        localized ? isNotNull(t.id) : undefined,
      ),
    )
    .groupBy(a.categoryId);
  const byId = new Map<string, (typeof rows)[number]>(
    rows.map((row) => [row.id, row]),
  );
  const totals = new Map<string, number>();
  for (const { categoryId, n } of counts)
    // Up the chain of public categories; nesting is at most three deep.
    for (
      let id: string | null = categoryId, depth = 0;
      id && byId.has(id) && depth < 10;
      id = byId.get(id)!.parentId, depth++
    )
      totals.set(id, (totals.get(id) ?? 0) + n);
  return rows
    .filter((row) => totals.get(row.id))
    .map((row) => ({
      id: row.id as string,
      urlId: row.urlId,
      slug: row.slug,
      name: localized ? row.translatedName! : row.name,
      description: localized ? row.translatedDescription : row.description,
      icon: row.icon,
      parentId: row.parentId && totals.get(row.parentId) ? row.parentId : null,
      articleCount: totals.get(row.id)!,
      path: collectionPath(viewer.locale, row.urlId, row.slug),
      updatedAt: row.updatedAt,
    }));
}
export type PublicCategory = Awaited<
  ReturnType<typeof visibleCategories>
>[number];

/** The published translation of the joined article in `code`. */
export const publishedTranslation = (code: string) =>
  and(eq(t.articleId, a.id), eq(t.locale, code), eq(t.status, "published"));

export const articleSummary = z
  .object({
    id: z.string(),
    urlId: z.number(),
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    path: z.string(),
    publishedAt: responseTimestamp,
    updatedAt: responseTimestamp,
    author: z.object({ name: z.string() }).nullable(),
    category: z.object({
      id: z.string(),
      urlId: z.number(),
      slug: z.string(),
      name: z.string(),
    }),
  })
  .openapi("QuillsPublicHelpCenterArticleSummary");
export const publicArticle = articleSummary
  .extend({
    content: z.string().openapi({ description: "Markdown" }),
  })
  .openapi("QuillsPublicHelpCenterArticle");

/**
 * Public articles in the viewer's locale, with the body when `content` is set. In another locale
 * an article without a published translation is left out. Authors are teammates, by name only.
 */
export async function visibleArticles(
  db: Db,
  viewer: Viewer,
  options: {
    where?: SQL;
    orderBy?: SQL[];
    limit: number;
    offset?: number;
    content?: boolean;
  },
) {
  const localized = viewer.locale !== DEFAULT_LOCALE;
  const rows = await db
    .select({
      id: a.id,
      urlId: a.urlId,
      slug: a.slug,
      title: a.title,
      description: a.description,
      content: options.content ? a.content : sql<string>`''`,
      publishedAt: a.publishedAt,
      updatedAt: a.updatedAt,
      translatedTitle: t.title,
      translatedDescription: t.description,
      translatedContent: options.content ? t.content : sql<string>`''`,
      translatedAt: t.updatedAt,
      authorName: principal.displayName,
      categoryId: c.id,
      categoryUrlId: c.urlId,
      categorySlug: c.slug,
      categoryName: c.name,
      translatedCategory: ct.name,
    })
    .from(a)
    .innerJoin(c, eq(c.id, a.categoryId))
    .leftJoin(t, publishedTranslation(viewer.locale))
    .leftJoin(ct, and(eq(ct.categoryId, c.id), eq(ct.locale, viewer.locale)))
    .leftJoin(
      principal,
      and(eq(principal.id, a.principalId), isNotNull(principal.kaneoUserId)),
    )
    .where(
      and(
        visibleArticle(viewer.segmentIds),
        localized ? isNotNull(t.id) : undefined,
        options.where,
      ),
    )
    .orderBy(
      ...(options.orderBy ?? [
        sql`${a.position} asc nulls last`,
        asc(a.publishedAt),
        asc(a.id),
      ]),
    )
    .limit(options.limit)
    .offset(options.offset ?? 0);
  return rows.map((row) => ({
    id: row.id as string,
    urlId: row.urlId,
    slug: row.slug,
    title: localized ? row.translatedTitle! : row.title,
    description: localized ? row.translatedDescription : row.description,
    content: localized ? row.translatedContent! : row.content,
    path: articlePath(viewer.locale, row.urlId, row.slug),
    publishedAt: row.publishedAt!,
    updatedAt: localized ? row.translatedAt! : row.updatedAt,
    author: row.authorName ? { name: row.authorName } : null,
    category: {
      id: row.categoryId as string,
      urlId: row.categoryUrlId,
      slug: row.categorySlug,
      name: (localized && row.translatedCategory?.trim()) || row.categoryName,
    },
  }));
}

/** Without the body, for lists. */
export const summaryOf = ({
  content: _content,
  ...summary
}: Awaited<ReturnType<typeof visibleArticles>>[number]) => summary;

/** Public articles of each category, at most `perCategory` each, in page order. */
export async function articlesByCategory(
  db: Db,
  viewer: Viewer,
  categoryIds: string[],
  perCategory = 100,
) {
  const grouped = new Map<string, ReturnType<typeof summaryOf>[]>();
  // ponytail: one read per category (a category and its direct subcategories); rank with
  // row_number() in one query if pages list many subcategories.
  for (const id of categoryIds) {
    const rows = await visibleArticles(db, viewer, {
      where: eq(a.categoryId, id as KbCategoryId),
      limit: perCategory,
    });
    grouped.set(id, rows.map(summaryOf));
  }
  return grouped;
}
