import { apiRouter, nullableResponseTimestamp, z } from "../../../../openapi";
import { defineQuillsRoute } from "../../../framework/define-route";
import { DEFAULT_LOCALE } from "../../help-center/shared";
import {
  notFound,
  openHelpCenter,
  visibleArticles,
  visibleCategories,
} from "./visibility";

// The help-center sitemap as data. The framework answers JSON only, so the site or web app
// renders the XML and prefixes its own origin: paths here are relative, which keeps bundled and
// separately hosted deployments correct. Crawlers are anonymous: gated content never appears.

/** The sitemap protocol's limit for one file. */
const MAX_ENTRIES = 50000;

const sitemap = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc/sitemap",
  operationId: "getQuillsPublicHelpCenterSitemap",
  summary: "Get the public help-center sitemap entries",
  description:
    "Home pages, collections and articles in every enabled locale, with the other locales of each page as alternates. 404 when indexing or the sitemap is off. At most 50,000 entries.",
  action: "read",
  response: z.object({
    entries: z.array(
      z.object({
        path: z.string(),
        lastModified: nullableResponseTimestamp,
        alternates: z.array(z.object({ locale: z.string(), path: z.string() })),
      }),
    ),
  }),
  responseDescription: "Sitemap entries",
  errors: { 404: "Help center or sitemap not found" },
  handler: async ({ db, caller }) => {
    const base = await openHelpCenter(db, caller, "portal", undefined, {
      anonymous: true,
    });
    const { seo, locales } = base.config;
    if (!seo.indexable || !seo.sitemapEnabled) throw notFound("Sitemap");
    const pages = new Map<
      string,
      { locale: string; path: string; lastModified: Date | null }[]
    >();
    const add = (
      key: string,
      locale: string,
      path: string,
      lastModified: Date | null,
    ) =>
      pages.set(key, [
        ...(pages.get(key) ?? []),
        { locale, path, lastModified },
      ]);
    for (const code of [DEFAULT_LOCALE, ...locales.additional]) {
      const viewer = { ...base, locale: code };
      add("home", code, code === DEFAULT_LOCALE ? "/hc" : `/hc/${code}`, null);
      for (const category of await visibleCategories(db, viewer))
        add(category.id, code, category.path, category.updatedAt);
      for (const article of await visibleArticles(db, viewer, {
        limit: MAX_ENTRIES,
      }))
        add(article.id, code, article.path, article.updatedAt);
    }
    return {
      entries: [...pages.values()]
        .flatMap((versions) =>
          versions.map(({ path, lastModified }) => ({
            path,
            lastModified,
            alternates:
              versions.length > 1
                ? versions.map(({ locale, path }) => ({ locale, path }))
                : [],
          })),
        )
        .slice(0, MAX_ENTRIES),
    };
  },
});

export default apiRouter().openapi(...sitemap);
