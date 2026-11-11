import { and, desc, isNull } from "drizzle-orm";
import { apiRouter, z } from "../../../openapi";
import { settings } from "../../../database/quills/schema/auth";
import { changelogEntries } from "../../../database/quills/schema/changelog";
import { posts } from "../../../database/quills/schema/posts";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { record } from "../../settings/area";
import { apiBase } from "../unsubscribe-token";
import { entryVisible, shownAt } from "./changelog";
import { postVisible, requirePortal, viewerFor, visibleBoards } from "./viewer";

// Crawler and feed-reader documents (audience: "public"): what an anonymous visitor of a public
// portal sees, as RSS and sitemap XML. A private portal gives an empty document. The XML helpers
// here also serve the help-center sitemap and the status feed.

// ponytail: apps/web has no portal pages yet. Links use the portal path of the invite and post
// mails; point them at the real pages when the portal UI lands.
/** An absolute portal page URL: KANEO_CLIENT_URL/portal/{workspaceId}{path}. */
export const portalUrl = (workspaceId: string, path = "") =>
  `${(process.env.KANEO_CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "")}/portal/${encodeURIComponent(workspaceId)}${path}`;
/** The absolute URL of a document under /quills-public/{workspaceId}, as the unsubscribe link builds it. */
export const publicUrl = (workspaceId: string, path: string) =>
  `${apiBase()}/quills-public/${encodeURIComponent(workspaceId)}${path}`;

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};
/** Control characters other than tab, line feed and carriage return, and Unicode non-characters. */
const NOT_XML = /(?![\t\n\r])[\p{Cc}\p{Noncharacter_Code_Point}]/gu;
/** XML text: escaped, without the characters that XML 1.0 forbids. */
const escapeXml = (text: string) =>
  text.replace(NOT_XML, "").replace(/[&<>"']/g, (c) => ENTITIES[c]!);

/** An RSS 2.0 document, as the source's feeds build it. Items are newest first. */
export function rssDocument(channel: {
  title: string;
  description: string;
  link: string;
  self: string;
  items: {
    title: string;
    link: string;
    /** An opaque ID; without one, the link is the permalink guid. */
    guid?: string;
    description: string;
    publishedAt: Date;
  }[];
}) {
  const items = channel.items.map(
    (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      ${item.guid ? `<guid isPermaLink="false">${escapeXml(item.guid)}</guid>` : `<guid isPermaLink="true">${escapeXml(item.link)}</guid>`}
      <description>${escapeXml(item.description)}</description>
      <pubDate>${item.publishedAt.toUTCString()}</pubDate>
    </item>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(channel.title)}</title>
    <description>${escapeXml(channel.description)}</description>
    <link>${escapeXml(channel.link)}</link>
    <atom:link href="${escapeXml(channel.self)}" rel="self" type="application/rss+xml"/>
    <lastBuildDate>${(channel.items[0]?.publishedAt ?? new Date()).toUTCString()}</lastBuildDate>
    <language>en-us</language>
${items.join("\n")}
  </channel>
</rss>`;
}

/** A sitemap protocol document. At most 50,000 URLs: the callers bound their lists. */
export function sitemapDocument(
  urls: {
    loc: string;
    lastModified?: Date | null;
    alternates?: { hreflang: string; href: string }[];
  }[],
) {
  const entries = urls.map((url) => {
    const lines = [`    <loc>${escapeXml(url.loc)}</loc>`];
    if (url.lastModified)
      lines.push(
        `    <lastmod>${url.lastModified.toISOString().slice(0, 10)}</lastmod>`,
      );
    for (const alternate of url.alternates ?? [])
      lines.push(
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(alternate.hreflang)}" href="${escapeXml(alternate.href)}" />`,
      );
    return `  <url>\n${lines.join("\n")}\n  </url>`;
  });
  const xhtml = urls.some((url) => url.alternates?.length)
    ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"'
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${xhtml}>
${entries.join("\n")}
</urlset>`;
}

/** The anonymous visitor's view, or null on a private portal. 404 while the portal is off. */
async function anonymous(db: Database) {
  const config = await requirePortal(db);
  if (record(config.access).visibility === "private") return null;
  return viewerFor(db, "portal", {
    principalId: null,
    customerId: null,
    account: null,
  });
}

/** Text without markup, at most 500 characters, as the source's feed description. */
const summary = (content: string) =>
  content
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);

const feed = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/changelog/rss.xml",
  operationId: "getQuillsPublicChangelogFeed",
  summary: "Get the changelog RSS feed",
  description:
    "RSS 2.0 with the 50 newest published entries that an anonymous visitor may see; empty on a private portal. Links point to the portal pages of the web app (/portal/{workspaceId}). The source's /changelog/feed, /changelog/rss and /changelog/rss.xml.",
  action: "read",
  rateLimit: { limit: 30, windowSeconds: 60 },
  raw: "application/rss+xml",
  response: z.string(),
  responseDescription: "The RSS document",
  handler: async ({ db, workspaceId }) => {
    const viewer = await anonymous(db);
    const [row] = await db
      .select({ name: settings.name })
      .from(settings)
      .limit(1);
    const rows = viewer
      ? await db
          .select({
            id: changelogEntries.id,
            title: changelogEntries.title,
            content: changelogEntries.content,
            publishedAt: shownAt,
          })
          .from(changelogEntries)
          .where(entryVisible(viewer))
          .orderBy(desc(shownAt), desc(changelogEntries.id))
          .limit(50)
      : [];
    const name = row?.name || "Changelog";
    return rssDocument({
      title: `${name} Changelog`,
      description: `Latest updates and releases from ${name}`,
      link: portalUrl(workspaceId, "/changelog"),
      self: publicUrl(workspaceId, "/changelog/rss.xml"),
      items: rows.map((entry) => ({
        title: entry.title,
        link: portalUrl(workspaceId, `/changelog/${entry.id}`),
        description: summary(entry.content),
        publishedAt: new Date(entry.publishedAt),
      })),
    });
  },
});

const sitemap = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/sitemap.xml",
  operationId: "getQuillsPublicSitemap",
  summary: "Get the portal sitemap",
  description:
    "Sitemap XML of the portal home, the boards, posts and changelog entries that an anonymous visitor may see: at most 10,000 posts (newest created first) and 1,000 entries. Empty on a private portal.",
  action: "read",
  rateLimit: { limit: 30, windowSeconds: 60 },
  raw: "application/xml",
  response: z.string(),
  responseDescription: "The sitemap document",
  handler: async ({ db, workspaceId }) => {
    const viewer = await anonymous(db);
    if (!viewer) return sitemapDocument([]);
    const boardList = await visibleBoards(db, viewer);
    const slugs = new Map(boardList.map((b) => [b.id, b.slug]));
    const postRows = await db
      .select({
        id: posts.id,
        boardId: posts.boardId,
        updatedAt: posts.updatedAt,
      })
      .from(posts)
      .where(
        and(
          postVisible(
            viewer,
            boardList.map((b) => b.id),
          ),
          isNull(posts.canonicalPostId),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(10000);
    const entries = await db
      .select({
        id: changelogEntries.id,
        updatedAt: changelogEntries.updatedAt,
      })
      .from(changelogEntries)
      .where(entryVisible(viewer))
      .orderBy(desc(shownAt), desc(changelogEntries.id))
      .limit(1000);
    const page = (path: string, lastModified?: Date) => ({
      loc: portalUrl(workspaceId, path),
      lastModified,
    });
    return sitemapDocument([
      page(""),
      ...boardList.map((b) => page(`/b/${b.slug}`)),
      ...postRows.map((p) =>
        page(`/b/${slugs.get(p.boardId)!}/posts/${p.id}`, p.updatedAt),
      ),
      ...entries.map((e) => page(`/changelog/${e.id}`, e.updatedAt)),
    ]);
  },
});

export default apiRouter()
  .openapi(...feed)
  .openapi(...sitemap);
