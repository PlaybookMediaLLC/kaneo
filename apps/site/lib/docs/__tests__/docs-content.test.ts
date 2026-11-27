import { brand } from "@kaneo/branding";
import { isOmittedDoc, omittedDocs } from "@kaneo/branding/docs";
import { readdirSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { generateMetadata } from "@/app/docs/[[...slug]]/page";
import { GET as getSearchIndex } from "@/app/docs/search-index.json/route";
import { GET as getDocsSitemap } from "@/app/docs/sitemap.xml/route";
import { docsMdxComponents } from "@/components/docs/docs-mdx-components";
import { API_REFERENCE_PATH } from "../links";
import { compileDocsMdx } from "../mdx";
import { DocsSearchEntrySchema } from "../search-filter";
import {
  docsSource,
  getDocsImagePaths,
  getDocsMarkdown,
  getDocsRedirects,
  getDocsSidebarSections,
  resolveDocsDir,
} from "../source";

function listAllContentSlugs(): string[] {
  const docsDir = resolveDocsDir();
  const slugs: string[] = [];

  function walk(dir: string, prefix = "") {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (rel === "api-reference/endpoints") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, rel);
      } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
        slugs.push(rel.replace(/\.mdx$/, ""));
      }
    }
  }

  walk(docsDir);
  return slugs.sort();
}

describe("docs content integrity", () => {
  it("publishes every non-omitted MDX file and excludes every omitted doc", () => {
    const allSlugs = listAllContentSlugs();
    const expectedPublished = allSlugs.filter((slug) => !isOmittedDoc(slug));
    const expectedOmitted = allSlugs.filter((slug) => isOmittedDoc(slug));

    const publishedPages = docsSource.getPages();
    const publishedSlugs = publishedPages.map((page) => page.slug).sort();

    expect(publishedSlugs).toEqual(expectedPublished);
    expect(docsSource.generateParams()).toHaveLength(expectedPublished.length);

    // Every omitted doc is excluded from routes, sidebar, search index, and markdown helper
    const sidebarHrefs = new Set(
      getDocsSidebarSections().flatMap((section) =>
        section.groups.flatMap((group) => group.items.map((item) => item.href)),
      ),
    );

    for (const omitted of new Set([...expectedOmitted, ...omittedDocs])) {
      if (!isOmittedDoc(omitted)) continue;
      expect(docsSource.getPage(omitted.split("/"))).toBeUndefined();
      expect(sidebarHrefs.has(`/docs/${omitted}`)).toBe(false);
      expect(getDocsMarkdown(omitted)).toBeUndefined();
      expect(getDocsMarkdown(`/docs/${omitted}`)).toBeUndefined();
    }

    // Explicit /docs/index must not resolve as a duplicate route
    expect(docsSource.getPage(["index"])).toBeUndefined();
    expect(getDocsMarkdown("/docs/index")).toBeUndefined();
  });

  it("compiles and renders every published doc with valid TOC IDs, internal links, fragments, and images", async () => {
    const pages = docsSource.getPages();
    const publishedUrls = new Set(pages.map((page) => page.url));
    const redirectUrls = new Set(
      getDocsRedirects().map((redirect) => redirect.sourceUrl),
    );
    const availableImages = new Set(
      getDocsImagePaths().map(
        (segments) => `/docs/images/${segments.join("/")}`,
      ),
    );

    const renderedByUrl = new Map<string, { html: string; ids: Set<string> }>();

    for (const page of pages) {
      expect(page.title.trim().length).toBeGreaterThan(0);
      expect(page.description.trim().length).toBeGreaterThan(0);
      expect(page.body.trim().length).toBeGreaterThan(0);

      const compiled = await compileDocsMdx(page);
      const html = renderToStaticMarkup(
        createElement(compiled.body, { components: docsMdxComponents }),
      );
      expect(html.trim().length).toBeGreaterThan(0);

      const ids = new Set(
        [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
      );

      for (const item of compiled.toc) {
        const expectedId = item.url.replace(/^#/, "");
        expect(
          ids.has(expectedId),
          `Missing TOC heading id="${expectedId}" in ${page.url}`,
        ).toBe(true);
      }

      renderedByUrl.set(page.url, { html, ids });
    }

    // Validate every internal /docs link, #fragment anchor, and /docs/images/* target
    for (const [pageUrl, { html, ids }] of renderedByUrl) {
      for (const match of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
        const href = match[1];
        if (
          href.startsWith("http://") ||
          href.startsWith("https://") ||
          href.startsWith("mailto:")
        ) {
          continue;
        }
        if (href.startsWith("#")) {
          const fragment = decodeURIComponent(href.slice(1));
          expect(
            ids.has(fragment),
            `Broken local anchor "${href}" on ${pageUrl}`,
          ).toBe(true);
          continue;
        }
        if (href === "/openapi.json" || href === API_REFERENCE_PATH) {
          continue;
        }
        if (href.startsWith("/docs")) {
          const [rawPath, fragment] = href.split("#");
          const targetPath = rawPath.replace(/\/+$/, "") || "/docs";
          const exists =
            publishedUrls.has(targetPath) || redirectUrls.has(targetPath);
          expect(
            exists,
            `Broken internal docs link "${href}" on ${pageUrl}`,
          ).toBe(true);
          if (fragment && publishedUrls.has(targetPath)) {
            const targetRendered = renderedByUrl.get(targetPath);
            expect(
              targetRendered?.ids.has(decodeURIComponent(fragment)),
              `Broken fragment "#${fragment}" in link "${href}" on ${pageUrl}`,
            ).toBe(true);
          }
        }
      }

      for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
        const src = match[1];
        if (
          src.startsWith("http://") ||
          src.startsWith("https://") ||
          src.startsWith("data:")
        ) {
          continue;
        }
        expect(
          availableImages.has(src),
          `Missing or unrewritten docs image "${src}" referenced on ${pageUrl}`,
        ).toBe(true);
      }
    }
  }, 60_000);

  it("expands all 9 Mintlify JSX tags in raw markdown exports", () => {
    const jsxTagPattern =
      /<\/?(?:Card|CardGroup|Frame|Steps|Step|Note|Info|Tip|Warning)\b/;

    for (const page of docsSource.getPages()) {
      const markdown = getDocsMarkdown(page.url);
      expect(markdown, `Missing markdown for ${page.url}`).toBeTruthy();
      expect(
        jsxTagPattern.test(markdown ?? ""),
        `Unexpanded Mintlify JSX tag found in raw markdown for ${page.url}`,
      ).toBe(false);
    }
  });

  it("serves a schema-valid /docs/search-index.json covering every published doc", async () => {
    const response = getSearchIndex();
    expect(response.status).toBe(200);
    const json = await response.json();
    const parsed = DocsSearchEntrySchema.array().parse(json);

    const indexedUrls = new Set(parsed.map((entry) => entry.url));
    for (const page of docsSource.getPages()) {
      expect(
        indexedUrls.has(page.url),
        `Missing search index entry for ${page.url}`,
      ).toBe(true);
    }
    expect(indexedUrls.has(API_REFERENCE_PATH)).toBe(true);

    for (const omitted of omittedDocs) {
      expect(indexedUrls.has(`/docs/${omitted}`)).toBe(false);
    }
  });

  it("emits a deduplicated /docs/sitemap.xml covering every published doc and /api-reference", async () => {
    const response = getDocsSitemap();
    expect(response.status).toBe(200);
    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(
      (match) => match[1],
    );
    const origin = brand.publicUrl.replace(/\/+$/, "");

    expect(new Set(locs).size).toBe(locs.length);
    for (const page of docsSource.getPages()) {
      expect(locs).toContain(`${origin}${page.url}`);
    }
    expect(locs).toContain(`${origin}${API_REFERENCE_PATH}`);
    for (const omitted of omittedDocs) {
      expect(locs).not.toContain(`${origin}/docs/${omitted}`);
    }
  });

  it("generates unique titles, canonical URLs, social tags, and noindex for unknown slugs", async () => {
    const seenTitles = new Set<string>();

    for (const page of docsSource.getPages()) {
      const meta = await generateMetadata({
        params: Promise.resolve({ slug: page.slugs }),
      });
      const title = typeof meta.title === "string" ? meta.title : "";
      expect(title.length).toBeGreaterThan(0);
      expect(seenTitles.has(title), `Duplicate doc title: ${title}`).toBe(
        false,
      );
      seenTitles.add(title);
      expect(meta.alternates?.canonical).toBe(page.url);
      expect(meta.openGraph?.url).toBe(page.url);
      expect(meta.twitter?.title).toBeTruthy();
    }

    const missing = await generateMetadata({
      params: Promise.resolve({ slug: ["does-not-exist"] }),
    });
    expect(missing.robots).toMatchObject({ index: false, follow: false });
  });
});
