import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lte,
  sql,
  type AnyColumn,
  type SQL,
} from "drizzle-orm";
import type { ChangelogId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
} from "../../../openapi";
import { principal } from "../../../database/quills/schema/auth";
import {
  changelogEntries,
  changelogEntryPosts,
} from "../../../database/quills/schema/changelog";
import {
  changelogCategories,
  changelogEntryCategories,
} from "../../../database/quills/schema/changelog-categories";
import { posts, postVotes } from "../../../database/quills/schema/posts";
import { postStatuses } from "../../../database/quills/schema/statuses";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { notFound, notTest } from "../../feedback/visibility";
import {
  httpUrl,
  postVisible,
  STAGES,
  stageOf,
  title,
  viewerFor,
  visibleBoards,
  type Customer,
  type Viewer,
} from "./viewer";

// Published changelog entries for customers (audience: "portal" and audience: "widget"). Drafts,
// scheduled and deleted entries never show. An entry or one of its categories limited to segments
// shows only to a signed-in member of one of them; the "authenticated" changelog audience hides
// every entry from a visitor without sign-in.

/** Segment list gate: [] is everyone, otherwise a signed-in member of one listed segment. */
const segmentGate = (viewer: Viewer, list: SQL | AnyColumn): SQL =>
  viewer.signedIn && viewer.segmentIds.length
    ? sql`(jsonb_array_length(${list}) = 0 or ${list} ?| ${sql.param(viewer.segmentIds)}::text[])`
    : sql`jsonb_array_length(${list}) = 0`;

export function entryVisible(viewer: Viewer): SQL {
  if (!viewer.changelogPublic && !viewer.signedIn) return sql`false`;
  return and(
    isNull(changelogEntries.deletedAt),
    isNotNull(changelogEntries.publishedAt),
    lte(changelogEntries.publishedAt, sql`now()`),
    segmentGate(viewer, changelogEntries.segmentIds),
    sql`not exists (select 1 from ${changelogEntryCategories} gated_link join ${changelogCategories} gated on gated.id = gated_link.category_id
      where gated_link.changelog_entry_id = ${changelogEntries.id} and not ${segmentGate(viewer, sql.raw("gated.segment_ids"))})`,
  )!;
}

/** The date a customer sees: the display date, else the publish date. */
export const shownAt =
  sql<Date>`coalesce(${changelogEntries.displayDate}, ${changelogEntries.publishedAt})`.mapWith(
    changelogEntries.publishedAt,
  );

const entry = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  publishedAt: responseTimestamp,
  author: z
    .object({ name: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
  categories: z.array(
    z.object({ id: z.string(), name: z.string(), color: z.string() }),
  ),
  linkedPosts: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      voteCount: z.number(),
      stage: z.enum(STAGES).nullable(),
    }),
  ),
  requesterCount: z.number().openapi({
    description:
      "Distinct people who voted on the linked posts that the caller may see",
  }),
});

async function present(
  db: Database,
  viewer: Viewer,
  where: SQL,
  page: { offset: number; limit: number },
) {
  const rows = await db
    .select({
      id: changelogEntries.id,
      title: changelogEntries.title,
      content: changelogEntries.content,
      publishedAt: shownAt,
      authorName: principal.displayName,
      authorAvatar: principal.avatarUrl,
    })
    .from(changelogEntries)
    .leftJoin(principal, eq(principal.id, changelogEntries.principalId))
    .where(and(where, entryVisible(viewer)))
    .orderBy(desc(shownAt), desc(changelogEntries.id))
    .offset(page.offset)
    .limit(page.limit + 1);
  const items = rows.slice(0, page.limit);
  const ids = items.map((row) => row.id);
  if (!ids.length) return { items: [], hasMore: false };
  const boardIds = (await visibleBoards(db, viewer)).map((b) => b.id);
  const categories = await db
    .select({
      entryId: changelogEntryCategories.changelogEntryId,
      id: changelogCategories.id,
      name: changelogCategories.name,
      color: changelogCategories.color,
    })
    .from(changelogEntryCategories)
    .innerJoin(
      changelogCategories,
      eq(changelogCategories.id, changelogEntryCategories.categoryId),
    )
    .where(inArray(changelogEntryCategories.changelogEntryId, ids))
    .orderBy(asc(changelogCategories.position), asc(changelogCategories.id));
  const linked = await db
    .select({
      entryId: changelogEntryPosts.changelogEntryId,
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      slug: postStatuses.slug,
      category: postStatuses.category,
    })
    .from(changelogEntryPosts)
    .innerJoin(posts, eq(posts.id, changelogEntryPosts.postId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .where(
      and(
        inArray(changelogEntryPosts.changelogEntryId, ids),
        postVisible(viewer, boardIds),
      ),
    )
    .orderBy(asc(changelogEntryPosts.createdAt), asc(posts.id));
  const requesters = await db
    .select({
      entryId: changelogEntryPosts.changelogEntryId,
      n: sql<number>`count(distinct ${postVotes.principalId})::int`,
    })
    .from(changelogEntryPosts)
    .innerJoin(posts, eq(posts.id, changelogEntryPosts.postId))
    .innerJoin(postVotes, eq(postVotes.postId, posts.id))
    .where(
      and(
        inArray(changelogEntryPosts.changelogEntryId, ids),
        postVisible(viewer, boardIds),
        notTest(postVotes.principalId),
      ),
    )
    .groupBy(changelogEntryPosts.changelogEntryId);
  return {
    items: items.map(({ authorName, authorAvatar, ...row }) => ({
      ...row,
      author: authorName
        ? { name: authorName, avatarUrl: httpUrl(authorAvatar) }
        : null,
      categories: categories
        .filter((c) => c.entryId === row.id)
        .map(({ id, name, color }) => ({ id, name, color })),
      linkedPosts: linked
        .filter((p) => p.entryId === row.id)
        .map((p) => ({
          id: p.id,
          title: p.title,
          voteCount: p.voteCount,
          stage: stageOf(
            p.slug ? { slug: p.slug, category: p.category! } : null,
          ),
        })),
      requesterCount: requesters.find((r) => r.entryId === row.id)?.n ?? 0,
    })),
    hasMore: rows.length > page.limit,
  };
}

export const listChangelog = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/changelog`,
    operationId: `listQuills${title(audience)}Changelog`,
    summary: "List the published changelog entries that the caller may see",
    description:
      "Newest first by the shown date. content is the stored text, not sanitized HTML.",
    action: "read",
    query: z.object({
      offset: pagingNumber(0, 1000000, 0),
      limit: pagingNumber(1, 50, 20),
    }),
    response: z.object({
      entries: z.array(entry),
      nextOffset: z.number().nullable(),
    }),
    responseDescription: "One page of entries",
    handler: async ({ db, caller, query }) => {
      const viewer = await viewerFor(db, audience, caller);
      const page = await present(db, viewer, sql`true`, query);
      return {
        entries: page.items,
        nextOffset: page.hasMore ? query.offset + query.limit : null,
      };
    },
  });

export const getChangelogEntry = (audience: Customer) =>
  defineQuillsRoute({
    audience,
    signIn: audience === "widget",
    method: "get",
    path: `/${audience}/changelog/{entryId}`,
    operationId: `getQuills${title(audience)}ChangelogEntry`,
    summary: "Get a published changelog entry",
    action: "read",
    params: z.object({ entryId: flexibleToTypeIdSchema("changelog") }),
    response: entry,
    responseDescription: "The entry",
    errors: {
      403: "Blocked account or no portal access",
      404: "Changelog entry not found",
    },
    handler: async ({ db, caller, params }) => {
      const viewer = await viewerFor(db, audience, caller);
      const [found] = (
        await present(
          db,
          viewer,
          eq(changelogEntries.id, params.entryId as ChangelogId),
          {
            offset: 0,
            limit: 1,
          },
        )
      ).items;
      if (!found) throw notFound("Changelog entry");
      return found;
    },
  });

export const changelogRoutes = (audience: Customer) =>
  apiRouter()
    .openapi(...listChangelog(audience))
    .openapi(...getChangelogEntry(audience));
