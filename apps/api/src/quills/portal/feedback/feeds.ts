import { and, desc, isNull } from "drizzle-orm";
import { apiRouter, responseTimestamp, z } from "../../../openapi";
import { settings } from "../../../database/quills/schema/auth";
import { changelogEntries } from "../../../database/quills/schema/changelog";
import { posts } from "../../../database/quills/schema/posts";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { record } from "../../settings/area";
import { entryVisible, shownAt } from "./changelog";
import { postVisible, requirePortal, viewerFor, visibleBoards } from "./viewer";

// Crawler and feed-reader reads (audience: "public"): what an anonymous visitor of a public portal
// sees. A private portal gives empty lists. JSON, not XML: defineQuillsRoute answers JSON only, so
// the portal host renders the RSS and sitemap documents with its own absolute URLs.

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
  path: "/changelog/feed",
  operationId: "getQuillsPublicChangelogFeed",
  summary: "Get the changelog feed",
  description:
    "The 50 newest published entries that an anonymous visitor may see. The source's /changelog/rss and /changelog/rss.xml redirect here.",
  action: "read",
  rateLimit: { limit: 30, windowSeconds: 60 },
  response: z.object({
    title: z.string(),
    items: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        summary: z.string(),
        publishedAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "The feed",
  handler: async ({ db }) => {
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
    return {
      title: `${row?.name || "Changelog"} changelog`,
      items: rows.map(({ content, ...entry }) => ({
        ...entry,
        summary: summary(content),
      })),
    };
  },
});

const sitemap = defineQuillsRoute({
  audience: "public",
  method: "get",
  path: "/sitemap",
  operationId: "getQuillsPublicSitemap",
  summary: "Get the public pages for a sitemap",
  description:
    "Boards, posts and changelog entries that an anonymous visitor may see: at most 10,000 posts (newest created first) and 1,000 entries.",
  action: "read",
  rateLimit: { limit: 30, windowSeconds: 60 },
  response: z.object({
    boards: z.array(z.object({ slug: z.string() })),
    posts: z.array(
      z.object({
        id: z.string(),
        boardSlug: z.string(),
        updatedAt: responseTimestamp,
      }),
    ),
    changelog: z.array(
      z.object({ id: z.string(), updatedAt: responseTimestamp }),
    ),
  }),
  responseDescription: "Sitemap entries",
  handler: async ({ db }) => {
    const viewer = await anonymous(db);
    if (!viewer) return { boards: [], posts: [], changelog: [] };
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
    return {
      boards: boardList.map((b) => ({ slug: b.slug })),
      posts: postRows.map((p) => ({
        id: p.id,
        boardSlug: slugs.get(p.boardId)!,
        updatedAt: p.updatedAt,
      })),
      changelog: entries,
    };
  },
});

export default apiRouter()
  .openapi(...feed)
  .openapi(...sitemap);
