import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { KbArticleId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import { principal } from "../../../database/quills/schema/auth";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../framework/define-route";
import { statusOf } from "../../feedback/changelog";
import { checkOrder, positionCase } from "../../feedback/id-sets";
import { idList, someField } from "../../feedback/schemas";
import { categoryParams, requireCategory } from "./categories";
import {
  conflict,
  defaultCategoryId,
  deleteRedirectRules,
  freeSlug,
  inTrash,
  notFound,
  orderList,
  readConfig,
  requireSegments,
  restoreCutoff,
  rethrowUnique,
  slug,
  slugify,
  type Db,
} from "./shared";

export const article = z
  .object({
    id: z.string(),
    urlId: z.number().openapi({
      description:
        "Public numeric ID in help-center URLs. Updates and translations never change it.",
    }),
    slug: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    content: z.string(),
    status: z.enum(["draft", "scheduled", "published"]).openapi({
      description:
        "Public help-center reads show published articles only. Drafts are teammate data.",
    }),
    publishedAt: nullableResponseTimestamp,
    position: z.number().nullable(),
    segmentIds: z.array(z.string()),
    viewCount: z.number(),
    helpfulCount: z.number(),
    notHelpfulCount: z.number(),
    category: z.object({
      id: z.string(),
      urlId: z.number(),
      slug: z.string(),
      name: z.string(),
    }),
    author: z
      .object({
        id: z.string(),
        name: z.string(),
        avatarUrl: z.string().nullable(),
      })
      .nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    deletedAt: nullableResponseTimestamp,
  })
  .openapi("QuillsHelpCenterArticle");
const listed = article.omit({ content: true });
const changed = article.extend({
  transition: z.enum(["published", "unpublished"]).nullable().openapi({
    description: "The publish state change this request made, if any",
  }),
  autoTranslateRequested: z.boolean().openapi({
    description:
      "True when the publish asked the auto-translate worker for draft translations",
  }),
});
const columns = {
  id: helpCenterArticles.id,
  urlId: helpCenterArticles.urlId,
  slug: helpCenterArticles.slug,
  title: helpCenterArticles.title,
  description: helpCenterArticles.description,
  content: helpCenterArticles.content,
  publishedAt: helpCenterArticles.publishedAt,
  position: helpCenterArticles.position,
  segmentIds: helpCenterArticles.segmentIds,
  viewCount: helpCenterArticles.viewCount,
  helpfulCount: helpCenterArticles.helpfulCount,
  notHelpfulCount: helpCenterArticles.notHelpfulCount,
  createdAt: helpCenterArticles.createdAt,
  updatedAt: helpCenterArticles.updatedAt,
  deletedAt: helpCenterArticles.deletedAt,
  categoryId: helpCenterCategories.id,
  categoryUrlId: helpCenterCategories.urlId,
  categorySlug: helpCenterCategories.slug,
  categoryName: helpCenterCategories.name,
  authorId: principal.id,
  authorName: principal.displayName,
  authorAvatarUrl: principal.avatarUrl,
};
export const articleParams = z.object({
  articleId: flexibleToTypeIdSchema("article"),
});
const live = (id: KbArticleId) =>
  and(eq(helpCenterArticles.id, id), isNull(helpCenterArticles.deletedAt));
const fields = {
  categoryId: flexibleToTypeIdSchema("kb_category").optional(),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(100000).openapi({
    description:
      "Markdown. A stored rich-text body is cleared when this changes.",
  }),
  slug: slug.optional(),
  description: z.string().trim().max(300).nullable().optional(),
  position: z.number().int().min(0).max(1000000).nullable().optional(),
  segmentIds: idList("segment").optional(),
};

// The list reads no body: it can be 100,000 characters per row.
const { content: _content, ...listColumns } = columns;
const onCategory = eq(helpCenterCategories.id, helpCenterArticles.categoryId);
const onAuthor = eq(principal.id, helpCenterArticles.principalId);
const selectListed = (db: Db) =>
  db
    .select(listColumns)
    .from(helpCenterArticles)
    .innerJoin(helpCenterCategories, onCategory)
    .leftJoin(principal, onAuthor);

type ListRow = Awaited<ReturnType<typeof selectListed>>[number];
const view = ({
  categoryId,
  categoryUrlId,
  categorySlug,
  categoryName,
  authorId,
  authorName,
  authorAvatarUrl,
  ...row
}: ListRow) => ({
  ...row,
  status: statusOf(row.publishedAt),
  category: {
    id: categoryId,
    urlId: categoryUrlId,
    slug: categorySlug,
    name: categoryName,
  },
  author:
    authorId && authorName
      ? { id: authorId, name: authorName, avatarUrl: authorAvatarUrl }
      : null,
});

/** One live article with its body. */
export async function articleById(db: Db, id: KbArticleId) {
  const [row] = await db
    .select(columns)
    .from(helpCenterArticles)
    .innerJoin(helpCenterCategories, onCategory)
    .leftJoin(principal, onAuthor)
    .where(live(id));
  if (!row) throw notFound("Article");
  const { content, ...listed } = row;
  return { ...view(listed), content };
}

const slugTaken = (db: Db, except?: KbArticleId) => async (value: string) =>
  (
    await db
      .select({ id: helpCenterArticles.id })
      .from(helpCenterArticles)
      .where(
        and(
          eq(helpCenterArticles.slug, value),
          except ? ne(helpCenterArticles.id, except) : undefined,
        ),
      )
      .limit(1)
  ).length > 0;

const listArticles = defineQuillsRoute({
  method: "get",
  path: "/help-center/articles",
  operationId: "listQuillsHelpCenterArticles",
  summary: "List help-center articles, drafts included",
  description:
    "Keyword search only; the source's semantic ranking needs the AI provider. `deleted=true` lists articles deleted in the last 30 days. Items leave out the body.",
  action: "read",
  query: z.object({
    categoryId: flexibleToTypeIdSchema("kb_category").optional(),
    status: z.enum(["draft", "published", "all"]).default("all"),
    search: z.string().trim().min(1).max(200).optional(),
    deleted: z.enum(["true", "false"]).default("false"),
    sort: z.enum(["newest", "oldest"]).default("newest"),
    cursor: flexibleToTypeIdSchema("article").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
  response: z.object({
    articles: z.array(listed),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of articles",
  errors: { 404: "Category not found" },
  handler: async ({ db, query }) => {
    if (query.categoryId) {
      const [found] = await db
        .select({ id: helpCenterCategories.id })
        .from(helpCenterCategories)
        .where(eq(helpCenterCategories.id, query.categoryId));
      if (!found) throw notFound("Category");
    }
    const trash = query.deleted === "true";
    const conditions: (SQL | undefined)[] = [
      inTrash(helpCenterArticles.deletedAt, trash),
      query.categoryId
        ? eq(helpCenterArticles.categoryId, query.categoryId)
        : undefined,
    ];
    if (!trash && query.status === "draft")
      conditions.push(isNull(helpCenterArticles.publishedAt));
    if (!trash && query.status === "published")
      conditions.push(lte(helpCenterArticles.publishedAt, sql`now()`));
    if (query.search)
      conditions.push(
        sql`${helpCenterArticles.searchVector} @@ websearch_to_tsquery('english', ${query.search})`,
      );
    const oldest = query.sort === "oldest";
    if (query.cursor) {
      const after = oldest ? gt : lt;
      // Compared in SQL: a JS Date drops the stored microseconds and would repeat or skip rows.
      const anchor = db
        .select({ createdAt: helpCenterArticles.createdAt })
        .from(helpCenterArticles)
        .where(eq(helpCenterArticles.id, query.cursor));
      conditions.push(
        or(
          after(helpCenterArticles.createdAt, anchor),
          and(
            eq(helpCenterArticles.createdAt, anchor),
            after(helpCenterArticles.id, query.cursor),
          ),
        ),
      );
    }
    const direction = oldest ? asc : desc;
    const rows = await selectListed(db)
      .where(and(...conditions))
      .orderBy(
        direction(helpCenterArticles.createdAt),
        direction(helpCenterArticles.id),
      )
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit).map(view);
    const hasMore = rows.length > query.limit;
    return {
      articles: items,
      nextCursor: hasMore ? items[items.length - 1]!.id : null,
      hasMore,
    };
  },
});

const getArticle = defineQuillsRoute({
  method: "get",
  path: "/help-center/articles/{articleId}",
  operationId: "getQuillsHelpCenterArticle",
  summary: "Get a help-center article, drafts included",
  action: "read",
  params: articleParams,
  response: article,
  responseDescription: "The article",
  errors: { 404: "Article not found" },
  handler: ({ db, params }) => articleById(db, params.articleId),
});

const createArticle = defineQuillsRoute({
  method: "post",
  path: "/help-center/articles",
  operationId: "createQuillsHelpCenterArticle",
  summary: "Create a draft help-center article",
  description:
    "The caller is the author. Without a category, the article is filed under General. Publish it with an update.",
  action: "create",
  body: z.object(fields),
  response: article,
  responseDescription: "The created article",
  errors: { 404: "Category or segment not found", 409: "Slug taken" },
  event: (_input, result) => ({
    type: "help_center.article_created",
    entityType: "article",
    entityId: result.id,
  }),
  handler: async ({ db, actor, body }) => {
    await requireSegments(db, body.segmentIds);
    const categoryId = body.categoryId
      ? await requireCategory(db, body.categoryId)
      : await defaultCategoryId(db);
    const value = await freeSlug(
      body.slug ?? slugify(body.title, "article"),
      slugTaken(db),
    );
    const [row] = await db
      .insert(helpCenterArticles)
      .values({
        categoryId,
        title: body.title,
        content: body.content,
        slug: value,
        description: body.description || null,
        position: body.position ?? null,
        segmentIds: body.segmentIds ?? [],
        principalId: actor.principalId,
      })
      .onConflictDoNothing()
      .returning({ id: helpCenterArticles.id });
    if (!row) throw conflict("The slug is taken");
    return articleById(db, row.id);
  },
});

const updateArticle = defineQuillsRoute({
  method: "patch",
  path: "/help-center/articles/{articleId}",
  operationId: "updateQuillsHelpCenterArticle",
  summary: "Update, move, publish or unpublish a help-center article",
  description:
    "`published: true` publishes a draft now; `false` returns it to draft. Publishing records help_center.article_published, which also carries the auto-translate request when that setting is on. No translation runs in the request.",
  action: "update",
  params: articleParams,
  body: z
    .object({
      ...fields,
      title: fields.title.optional(),
      content: fields.content.optional(),
      published: z.boolean().optional(),
    })
    .refine(someField, "Change at least one field"),
  response: changed,
  responseDescription: "The updated article",
  errors: {
    404: "Article, category or segment not found",
    409: "Slug taken",
  },
  event: (_input, result) => ({
    type: result.transition
      ? (`help_center.article_${result.transition}` as const)
      : "help_center.article_updated",
    entityType: "article",
    entityId: result.id,
    payload: (result.autoTranslateRequested
      ? { autoTranslate: "requested" }
      : {}) as Record<string, string>,
  }),
  handler: async ({ db, params: { articleId }, body }) => {
    // Category before article: the lock order of reorders and category deletes.
    if (body.categoryId) await requireCategory(db, body.categoryId);
    const [current] = await db
      .select({ publishedAt: helpCenterArticles.publishedAt })
      .from(helpCenterArticles)
      .where(live(articleId))
      .for("update");
    if (!current) throw notFound("Article");
    await requireSegments(db, body.segmentIds);
    const value =
      body.slug && (await freeSlug(body.slug, slugTaken(db, articleId)));
    const transition =
      body.published === true && !current.publishedAt
        ? ("published" as const)
        : body.published === false && current.publishedAt
          ? ("unpublished" as const)
          : null;
    await db
      .update(helpCenterArticles)
      .set({
        categoryId: body.categoryId,
        title: body.title,
        content: body.content,
        // An imported rich body would otherwise outlive the new text.
        contentJson: body.content === undefined ? undefined : null,
        slug: value || undefined,
        description:
          body.description === undefined ? undefined : body.description || null,
        position: body.position,
        segmentIds: body.segmentIds,
        publishedAt:
          transition === "published"
            ? new Date()
            : transition === "unpublished"
              ? null
              : undefined,
        updatedAt: new Date(),
      })
      .where(live(articleId))
      .catch((error) => rethrowUnique(error, "The slug is taken"));
    const config = transition === "published" ? await readConfig(db) : null;
    return {
      ...(await articleById(db, articleId)),
      transition,
      autoTranslateRequested: Boolean(
        config?.autoTranslate.enabled && config.locales.additional.length,
      ),
    };
  },
});

const deleteArticle = defineQuillsRoute({
  method: "delete",
  path: "/help-center/articles/{articleId}",
  operationId: "deleteQuillsHelpCenterArticle",
  summary: "Delete a help-center article",
  description:
    "A soft delete that can be restored for 30 days. Redirect rules that point at the article are removed.",
  action: "delete",
  params: articleParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted article",
  errors: { 404: "Article not found" },
  event: ({ params }) => ({
    type: "help_center.article_deleted",
    entityType: "article",
    entityId: params.articleId,
  }),
  handler: async ({ db, params: { articleId } }) => {
    const [row] = await db
      .update(helpCenterArticles)
      .set({ deletedAt: new Date() })
      .where(live(articleId))
      .returning({ id: helpCenterArticles.id });
    if (!row) throw notFound("Article");
    await deleteRedirectRules(db, "article", [row.id]);
    return row;
  },
});

const restoreArticle = defineQuillsRoute({
  method: "post",
  path: "/help-center/articles/{articleId}/restore",
  operationId: "restoreQuillsHelpCenterArticle",
  summary: "Restore a deleted help-center article",
  description:
    "Within 30 days of its deletion, into a live category. Its URL ID is unchanged.",
  action: "delete",
  params: articleParams,
  response: article,
  responseDescription: "The restored article",
  errors: {
    404: "Article not found",
    409: "Not deleted, deleted too long ago, or the category is deleted",
  },
  event: ({ params }) => ({
    type: "help_center.article_restored",
    entityType: "article",
    entityId: params.articleId,
  }),
  handler: async ({ db, params: { articleId } }) => {
    const [row] = await db
      .select({
        deletedAt: helpCenterArticles.deletedAt,
        categoryId: helpCenterArticles.categoryId,
      })
      .from(helpCenterArticles)
      .where(eq(helpCenterArticles.id, articleId));
    if (!row) throw notFound("Article");
    // A restored article needs a live category, as a restored category needs a live parent.
    const [category] = await db
      .select({ id: helpCenterCategories.id })
      .from(helpCenterCategories)
      .where(
        and(
          eq(helpCenterCategories.id, row.categoryId),
          isNull(helpCenterCategories.deletedAt),
        ),
      )
      .for("no key update");
    if (!category) throw conflict("Restore the article's category first");
    const [locked] = await db
      .select({ deletedAt: helpCenterArticles.deletedAt })
      .from(helpCenterArticles)
      .where(eq(helpCenterArticles.id, articleId))
      .for("update");
    if (!locked?.deletedAt) throw conflict("The article is not deleted");
    if (locked.deletedAt < restoreCutoff())
      throw conflict(
        "Articles can only be restored within 30 days of deletion",
      );
    await db
      .update(helpCenterArticles)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(helpCenterArticles.id, articleId));
    return articleById(db, articleId);
  },
});

const reorderArticles = defineQuillsRoute({
  method: "put",
  path: "/help-center/categories/{categoryId}/articles/order",
  operationId: "reorderQuillsHelpCenterArticles",
  summary: "Reorder the articles in a category",
  description:
    "Send every live article of the category once, in the new order. A partial or stale list changes nothing.",
  action: "update",
  params: categoryParams,
  body: z.object({ articleIds: orderList("article") }),
  response: z.object({ articleIds: z.array(z.string()) }),
  responseDescription: "The new order",
  errors: {
    404: "Category or article not found",
    409: "The list is partial or stale",
  },
  event: ({ params, body }) => ({
    type: "help_center.articles_reordered",
    entityType: "help_center_category",
    entityId: params.categoryId,
    payload: { count: String(body.articleIds.length) },
  }),
  handler: async ({ db, params: { categoryId }, body: { articleIds } }) => {
    await requireCategory(db, categoryId);
    const rows = await db
      .select({ id: helpCenterArticles.id })
      .from(helpCenterArticles)
      .where(
        and(
          eq(helpCenterArticles.categoryId, categoryId),
          isNull(helpCenterArticles.deletedAt),
        ),
      )
      .orderBy(asc(helpCenterArticles.id))
      .for("update");
    checkOrder(
      articleIds,
      rows.map((row) => row.id),
    );
    await db
      .update(helpCenterArticles)
      .set({ position: positionCase(helpCenterArticles.id, articleIds) })
      .where(inArray(helpCenterArticles.id, articleIds));
    return { articleIds };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listArticles)
  .openapi(...getArticle)
  .openapi(...createArticle)
  .openapi(...updateArticle)
  .openapi(...deleteArticle)
  .openapi(...restoreArticle)
  .openapi(...reorderArticles);
