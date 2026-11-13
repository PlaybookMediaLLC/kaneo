import { apiRouter, z } from "../../../../openapi";
import { defineQuillsRoute } from "../../../framework/define-route";
import { sitemapDocument } from "../../../portal/feedback/feeds";
import { portalPaths } from "../../../portal/paths";
import { DEFAULT_LOCALE } from "../../help-center/shared";
import {
  notFound,
  openHelpCenter,
  visibleArticles,
  visibleCategories,
} from "./visibility";

// The help-center sitemap XML. Page URLs are under the portal's absolute URL
// (KANEO_CLIENT_URL/portal/{workspaceId}). Crawlers are anonymous: gated content never appears.

/** The sitemap protocol's limit for one file. */
const MAX_ENTRIES = 50000;

const sitemap = defineQuillsRoute({
  audience: "portal",
  signIn: false,
  method: "get",
  path: "/hc/sitemap.xml",
  operationId: "getQuillsPublicHelpCenterSitemap",
  summary: "Get the public help-center sitemap",
  description:
    "Sitemap XML of the home pages, collections and articles in every enabled locale, with the other locales of each page as hreflang alternates. 404 when indexing or the sitemap is off. At most 50,000 URLs.",
  action: "read",
  raw: "application/xml",
  response: z.string(),
  responseDescription: "The sitemap document",
  errors: { 404: "Help center or sitemap not found" },
  handler: async ({ db, caller, workspaceId }) => {
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
    const url = (path: string) => {
      const parts = path.split("/").filter(Boolean);
      if (parts.length === 1) return portalPaths.helpCenter(workspaceId);
      if (parts.length === 2)
        return portalPaths.helpCenter(workspaceId, parts[1]);
      const idSlug = parts.at(-1)!;
      return parts.at(-2) === "collections"
        ? portalPaths.helpCenterCollection(workspaceId, parts[1]!, idSlug)
        : portalPaths.helpCenterArticle(workspaceId, parts[1]!, idSlug);
    };
    return sitemapDocument(
      [...pages.values()]
        .flatMap((versions) =>
          versions.map(({ path, lastModified }) => ({
            loc: url(path),
            lastModified,
            alternates:
              versions.length > 1
                ? versions.map(({ locale, path }) => ({
                    hreflang: locale,
                    href: url(path),
                  }))
                : [],
          })),
        )
        .slice(0, MAX_ENTRIES),
    );
  },
});

export default apiRouter().openapi(...sitemap);
