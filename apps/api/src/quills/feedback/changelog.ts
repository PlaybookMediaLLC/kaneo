import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type {
  ChangelogCategoryId,
  ChangelogId,
  PostId,
  SegmentId,
} from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { boards } from "../../database/quills/schema/boards";
import {
  changelogEntries,
  changelogEntryPosts,
} from "../../database/quills/schema/changelog";
import {
  changelogCategories,
  changelogEntryCategories,
} from "../../database/quills/schema/changelog-categories";
import { posts } from "../../database/quills/schema/posts";
import { segments } from "../../database/quills/schema/segments";
import { postStatuses } from "../../database/quills/schema/statuses";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { requireAll } from "./id-sets";
import { idList, someField } from "./schemas";
import { boardVisible, loadProjects, visiblePost } from "./visibility";

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];
type Status = "draft" | "scheduled" | "published";

const entry = z
  .object({
    id: z.string(),
    title: z.string(),
    content: z.string(),
    status: z.enum(["draft", "scheduled", "published"]),
    publishedAt: nullableResponseTimestamp,
    displayDate: nullableResponseTimestamp,
    segmentIds: z.array(z.string()),
    viewCount: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    author: z
      .object({
        id: z.string(),
        name: z.string(),
        avatarUrl: z.string().nullable(),
      })
      .nullable(),
    linkedPosts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        voteCount: z.number(),
        status: z.object({ name: z.string(), color: z.string() }).nullable(),
      }),
    ),
    categories: z.array(
      z.object({ id: z.string(), name: z.string(), color: z.string() }),
    ),
  })
  .openapi("QuillsChangelogEntry");
const changed = entry.extend({
  publishedNow: z
    .boolean()
    .openapi({ description: "True when this request published the entry" }),
});
const fields = {
  id: changelogEntries.id,
  title: changelogEntries.title,
  content: changelogEntries.content,
  principalId: changelogEntries.principalId,
  publishedAt: changelogEntries.publishedAt,
  displayDate: changelogEntries.displayDate,
  segmentIds: changelogEntries.segmentIds,
  viewCount: changelogEntries.viewCount,
  createdAt: changelogEntries.createdAt,
  updatedAt: changelogEntries.updatedAt,
};
type Row = Pick<typeof changelogEntries.$inferSelect, keyof typeof fields>;
const params = z.object({ entryId: flexibleToTypeIdSchema("changelog") });
const date = z.iso.datetime({ offset: true });
const publishState = z.discriminatedUnion("type", [
  z.object({ type: z.literal("draft") }),
  z.object({ type: z.literal("scheduled"), publishAt: date }),
  z.object({ type: z.literal("published"), publishAt: date.optional() }),
]);
const links = {
  linkedPostIds: idList("post").optional(),
  categoryIds: idList("changelog_category").optional(),
  segmentIds: idList("segment").optional(),
};
const live = (id: ChangelogId) =>
  and(eq(changelogEntries.id, id), isNull(changelogEntries.deletedAt));
const notFound = () =>
  new HTTPException(404, { message: "Changelog entry not found" });
const bad = (message: string) => new HTTPException(400, { message });

export function statusOf(publishedAt: Date | null, now = new Date()): Status {
  if (!publishedAt) return "draft";
  return publishedAt > now ? "scheduled" : "published";
}

/** The stored publish time. A schedule is in the future; a publish time is not. */
function publishedAtOf(state: z.output<typeof publishState>): Date | null {
  const now = new Date();
  if (state.type === "draft") return null;
  const at = state.publishAt ? new Date(state.publishAt) : now;
  if (state.type === "scheduled" && at <= now)
    throw bad("A scheduled entry needs a future publish time");
  if (state.type === "published" && at > now)
    throw bad("Use a scheduled state for a future publish time");
  return at;
}

/** A display date belongs to a published entry, is not in the future and is dropped on the publish day. */
function displayDateOf(value: string | null, publishedAt: Date | null) {
  if (value === null) return null;
  const now = new Date();
  const shown = new Date(value);
  if (!publishedAt || publishedAt > now)
    throw bad("Only a published entry can have a display date");
  if (shown > now) throw bad("A display date cannot be in the future");
  return shown.toISOString().slice(0, 10) ===
    publishedAt.toISOString().slice(0, 10)
    ? null
    : shown;
}

/** Linked posts must be visible to the caller; categories and segments must exist. */
async function requireLinks(
  db: Db,
  projects: string[],
  body: {
    linkedPostIds?: PostId[];
    categoryIds?: ChangelogCategoryId[];
    segmentIds?: SegmentId[];
  },
) {
  if (body.linkedPostIds?.length)
    requireAll(
      body.linkedPostIds,
      await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(inArray(posts.id, body.linkedPostIds), visiblePost(projects)),
        ),
      "Post",
    );
  if (body.categoryIds?.length)
    requireAll(
      body.categoryIds,
      await db
        .select({ id: changelogCategories.id })
        .from(changelogCategories)
        .where(inArray(changelogCategories.id, body.categoryIds)),
      "Category",
    );
  if (body.segmentIds?.length)
    requireAll(
      body.segmentIds,
      await db
        .select({ id: segments.id })
        .from(segments)
        .where(
          and(
            inArray(segments.id, body.segmentIds),
            isNull(segments.deletedAt),
          ),
        ),
      "Segment",
    );
}

async function replaceLinks(
  db: Db,
  id: ChangelogId,
  projects: string[],
  {
    linkedPostIds,
    categoryIds,
  }: { linkedPostIds?: PostId[]; categoryIds?: ChangelogCategoryId[] },
) {
  if (linkedPostIds) {
    // Links to posts that the caller cannot see stay: the caller can neither read nor send them.
    await db
      .delete(changelogEntryPosts)
      .where(
        and(
          eq(changelogEntryPosts.changelogEntryId, id),
          inArray(
            changelogEntryPosts.postId,
            db
              .select({ id: posts.id })
              .from(posts)
              .where(visiblePost(projects)),
          ),
        ),
      );
    if (linkedPostIds.length)
      await db
        .insert(changelogEntryPosts)
        .values(
          linkedPostIds.map((postId) => ({ changelogEntryId: id, postId })),
        );
  }
  if (categoryIds) {
    await db
      .delete(changelogEntryCategories)
      .where(eq(changelogEntryCategories.changelogEntryId, id));
    if (categoryIds.length)
      await db.insert(changelogEntryCategories).values(
        categoryIds.map((categoryId) => ({
          changelogEntryId: id,
          categoryId,
        })),
      );
  }
}

/** Author, visible linked posts and categories for each entry. */
async function withDetails(db: Db, rows: Row[], projects: string[]) {
  const ids = rows.map((row) => row.id);
  if (!ids.length) return [];
  const authorIds = [
    ...new Set(
      rows.flatMap((row) => (row.principalId ? [row.principalId] : [])),
    ),
  ];
  const authors = authorIds.length
    ? await db
        .select({
          id: principal.id,
          name: principal.displayName,
          avatarUrl: principal.avatarUrl,
        })
        .from(principal)
        .where(inArray(principal.id, authorIds))
    : [];
  const linked = await db
    .select({
      entryId: changelogEntryPosts.changelogEntryId,
      id: posts.id,
      title: posts.title,
      voteCount: posts.voteCount,
      statusName: postStatuses.name,
      statusColor: postStatuses.color,
    })
    .from(changelogEntryPosts)
    .innerJoin(posts, eq(posts.id, changelogEntryPosts.postId))
    .leftJoin(postStatuses, eq(postStatuses.id, posts.statusId))
    .where(
      and(
        inArray(changelogEntryPosts.changelogEntryId, ids),
        visiblePost(projects),
      ),
    )
    .orderBy(asc(changelogEntryPosts.createdAt), asc(posts.id));
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
  return rows.map(({ principalId, ...row }) => {
    const author = authors.find((a) => a.id === principalId);
    return {
      ...row,
      status: statusOf(row.publishedAt),
      author: author?.name
        ? { id: author.id, name: author.name, avatarUrl: author.avatarUrl }
        : null,
      linkedPosts: linked
        .filter((post) => post.entryId === row.id)
        .map((post) => ({
          id: post.id,
          title: post.title,
          voteCount: post.voteCount,
          status:
            post.statusName && post.statusColor
              ? { name: post.statusName, color: post.statusColor }
              : null,
        })),
      categories: categories
        .filter((category) => category.entryId === row.id)
        .map(({ id, name, color }) => ({ id, name, color })),
    };
  });
}

async function entryById(db: Db, id: ChangelogId, projects: string[]) {
  const [row] = await db.select(fields).from(changelogEntries).where(live(id));
  if (!row) throw notFound();
  return (await withDetails(db, [row], projects))[0]!;
}

/** `changelog.published` carries the subscriber notification for the P4 mail handler. */
const changeEvent =
  (otherwise: "changelog.created" | "changelog.updated") =>
  (
    { body }: { body: { notify?: boolean } },
    result: { id: string; publishedNow: boolean },
  ) => {
    const payload: Record<string, string> = result.publishedNow
      ? { notify: String(body.notify ?? true) }
      : {};
    return {
      type: result.publishedNow ? ("changelog.published" as const) : otherwise,
      entityType: "changelog" as const,
      entityId: result.id,
      payload,
    };
  };

const listChangelog = defineQuillsRoute({
  method: "get",
  path: "/changelog",
  operationId: "listQuillsChangelog",
  summary: "List changelog entries, drafts included",
  action: "read",
  query: z.object({
    status: z.enum(["draft", "scheduled", "published", "all"]).default("all"),
    sort: z.enum(["newest", "oldest"]).default("newest"),
    search: z.string().trim().min(1).max(200).optional(),
    cursor: flexibleToTypeIdSchema("changelog").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  load: loadProjects,
  response: z.object({
    entries: z.array(entry),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of entries",
  handler: async ({ db, query, loaded }) => {
    const now = new Date();
    const oldest = query.sort === "oldest";
    const after = oldest ? gt : lt;
    const conditions: (SQL | undefined)[] = [
      isNull(changelogEntries.deletedAt),
    ];
    if (query.search)
      conditions.push(
        sql`to_tsvector('english', coalesce(${changelogEntries.title}, '') || ' ' || coalesce(${changelogEntries.content}, '')) @@ websearch_to_tsquery('english', ${query.search})`,
      );
    if (query.status === "draft")
      conditions.push(isNull(changelogEntries.publishedAt));
    if (query.status === "scheduled")
      conditions.push(gt(changelogEntries.publishedAt, now));
    if (query.status === "published")
      conditions.push(
        isNotNull(changelogEntries.publishedAt),
        lte(changelogEntries.publishedAt, now),
      );
    if (query.cursor) {
      // Compared in SQL: a JS Date drops the stored microseconds and would repeat or skip rows.
      const anchor = db
        .select({ createdAt: changelogEntries.createdAt })
        .from(changelogEntries)
        .where(eq(changelogEntries.id, query.cursor));
      conditions.push(
        or(
          after(changelogEntries.createdAt, anchor),
          and(
            eq(changelogEntries.createdAt, anchor),
            after(changelogEntries.id, query.cursor),
          ),
        ),
      );
    }
    const direction = oldest ? asc : desc;
    const rows = await db
      .select(fields)
      .from(changelogEntries)
      .where(and(...conditions))
      .orderBy(
        direction(changelogEntries.createdAt),
        direction(changelogEntries.id),
      )
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit);
    const hasMore = rows.length > query.limit;
    return {
      entries: await withDetails(db, items, loaded),
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
      hasMore,
    };
  },
});

const getEntry = defineQuillsRoute({
  method: "get",
  path: "/changelog/{entryId}",
  operationId: "getQuillsChangelogEntry",
  summary: "Get a changelog entry, drafts included",
  action: "read",
  params,
  load: loadProjects,
  response: entry,
  responseDescription: "The entry",
  errors: { 404: "Changelog entry not found" },
  handler: ({ db, params, loaded }) => entryById(db, params.entryId, loaded),
});

const createEntry = defineQuillsRoute({
  method: "post",
  path: "/changelog",
  operationId: "createQuillsChangelogEntry",
  summary: "Create a changelog entry",
  description:
    "Publishing records changelog.published for the subscriber mail handler; this request sends no mail.",
  action: "create",
  body: z.object({
    title: z.string().trim().min(1).max(200),
    content: z.string().trim().min(1).max(100000),
    publishState,
    displayDate: date.nullable().optional(),
    notify: z.boolean().optional(),
    ...links,
  }),
  load: loadProjects,
  response: changed,
  responseDescription: "The created entry",
  errors: { 404: "A linked post, category or segment was not found" },
  event: changeEvent("changelog.created"),
  handler: async ({ db, actor, body, loaded }) => {
    const publishedAt = publishedAtOf(body.publishState);
    const displayDate = displayDateOf(body.displayDate ?? null, publishedAt);
    await requireLinks(db, loaded, body);
    const [row] = await db
      .insert(changelogEntries)
      .values({
        title: body.title,
        content: body.content,
        principalId: actor.principalId,
        publishedAt,
        displayDate,
        segmentIds: body.segmentIds ?? [],
      })
      .returning({ id: changelogEntries.id });
    await replaceLinks(db, row!.id, loaded, body);
    const created = await entryById(db, row!.id, loaded);
    return { ...created, publishedNow: created.status === "published" };
  },
});

const updateEntry = defineQuillsRoute({
  method: "patch",
  path: "/changelog/{entryId}",
  operationId: "updateQuillsChangelogEntry",
  summary: "Update a changelog entry and its publish state",
  description:
    "Lists replace the stored set; links to posts that the caller cannot see stay. Publishing records changelog.published instead of changelog.updated.",
  action: "update",
  params,
  body: z
    .object({
      title: z.string().trim().min(1).max(200).optional(),
      content: z.string().trim().min(1).max(100000).optional(),
      publishState: publishState.optional(),
      displayDate: date.nullable().optional(),
      notify: z.boolean().optional(),
      ...links,
    })
    .refine(someField, "Change at least one field"),
  load: loadProjects,
  response: changed,
  responseDescription: "The updated entry",
  errors: {
    404: "Changelog entry, linked post, category or segment not found",
  },
  event: changeEvent("changelog.updated"),
  handler: async ({ db, params: { entryId }, body, loaded }) => {
    const [current] = await db
      .select({ publishedAt: changelogEntries.publishedAt })
      .from(changelogEntries)
      .where(live(entryId))
      .for("update");
    if (!current) throw notFound();
    const publishedAt = body.publishState
      ? publishedAtOf(body.publishState)
      : current.publishedAt;
    const displayDate =
      body.displayDate === undefined
        ? undefined
        : displayDateOf(body.displayDate, publishedAt);
    await requireLinks(db, loaded, body);
    await db
      .update(changelogEntries)
      .set({
        title: body.title,
        content: body.content,
        // An imported rich body would otherwise outlive the new text.
        contentJson: body.content === undefined ? undefined : null,
        publishedAt: body.publishState ? publishedAt : undefined,
        displayDate,
        segmentIds: body.segmentIds,
        updatedAt: new Date(),
      })
      .where(live(entryId));
    await replaceLinks(db, entryId, loaded, body);
    const updated = await entryById(db, entryId, loaded);
    return {
      ...updated,
      publishedNow:
        body.publishState !== undefined &&
        updated.status === "published" &&
        statusOf(current.publishedAt) !== "published",
    };
  },
});

// Soft delete keeps publishedAt, so public cursors still have an anchor.
const deleteEntry = defineQuillsRoute({
  method: "delete",
  path: "/changelog/{entryId}",
  operationId: "deleteQuillsChangelogEntry",
  summary: "Delete a changelog entry",
  action: "delete",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted entry",
  errors: { 404: "Changelog entry not found" },
  event: ({ params }) => ({
    type: "changelog.deleted",
    entityType: "changelog",
    entityId: params.entryId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(changelogEntries)
      .set({ deletedAt: new Date() })
      .where(live(params.entryId))
      .returning({ id: changelogEntries.id });
    if (!row) throw notFound();
    return row;
  },
});

const searchShippedPosts = defineQuillsRoute({
  method: "get",
  path: "/changelog/shipped-posts",
  operationId: "searchQuillsShippedPosts",
  summary: "Search shipped posts to link to a changelog entry",
  description:
    "Posts whose status is in the complete category, limited to posts that the caller may see.",
  action: "read",
  query: z.object({
    query: z.string().trim().min(1).max(200).optional(),
    boardId: flexibleToTypeIdSchema("board").optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),
  load: loadProjects,
  response: z.object({
    posts: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        voteCount: z.number(),
        boardSlug: z.string(),
        authorName: z.string().nullable(),
        createdAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "Matching shipped posts",
  errors: { 404: "Board not found" },
  handler: async ({ db, query, loaded }) => {
    if (query.boardId) {
      const [board] = await db
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.id, query.boardId), boardVisible(loaded)));
      if (!board) throw new HTTPException(404, { message: "Board not found" });
    }
    return {
      posts: await db
        .select({
          id: posts.id,
          title: posts.title,
          voteCount: posts.voteCount,
          boardSlug: boards.slug,
          authorName: principal.displayName,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .innerJoin(boards, eq(boards.id, posts.boardId))
        .innerJoin(postStatuses, eq(postStatuses.id, posts.statusId))
        .leftJoin(principal, eq(principal.id, posts.principalId))
        .where(
          and(
            eq(postStatuses.category, "complete"),
            visiblePost(loaded),
            query.boardId ? eq(posts.boardId, query.boardId) : undefined,
            query.query
              ? sql`${posts.title} ilike ${`%${query.query}%`}`
              : undefined,
          ),
        )
        .orderBy(desc(posts.voteCount), desc(posts.createdAt), asc(posts.id))
        .limit(query.limit),
    };
  },
});

// Static paths first: /changelog/{entryId} would otherwise match them.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...searchShippedPosts)
  .openapi(...listChangelog)
  .openapi(...getEntry)
  .openapi(...createEntry)
  .openapi(...updateEntry)
  .openapi(...deleteEntry);
