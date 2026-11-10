import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { KbCategoryId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../../database/quills/schema/kb";
import { defineQuillsRoute } from "../../framework/define-route";
import { checkOrder, positionCase } from "../../feedback/id-sets";
import { idList, page, pageQuery, someField } from "../../feedback/schemas";
import {
  bad,
  conflict,
  deleteRedirectRules,
  freeSlug,
  inTrash,
  notFound,
  orderList,
  requireSegments,
  restoreCutoff,
  rethrowUnique,
  slug,
  slugify,
  type Db,
} from "./shared";

/** The source's MAX_CATEGORY_DEPTH: a top-level category, a child and a grandchild. */
const MAX_DEPTH = 3;

export const category = z
  .object({
    id: z.string(),
    urlId: z.number().openapi({
      description: "Public numeric ID in help-center URLs. It never changes.",
    }),
    parentId: z.string().nullable(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    icon: z.string().nullable(),
    isPublic: z.boolean(),
    segmentIds: z.array(z.string()),
    position: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    deletedAt: nullableResponseTimestamp,
  })
  .openapi("QuillsHelpCenterCategory");
const counted = category.extend({
  articleCount: z.number(),
  publishedArticleCount: z.number(),
  recursiveArticleCount: z.number(),
  recursivePublishedArticleCount: z.number(),
});
const columns = {
  id: helpCenterCategories.id,
  urlId: helpCenterCategories.urlId,
  parentId: helpCenterCategories.parentId,
  slug: helpCenterCategories.slug,
  name: helpCenterCategories.name,
  description: helpCenterCategories.description,
  icon: helpCenterCategories.icon,
  isPublic: helpCenterCategories.isPublic,
  segmentIds: helpCenterCategories.segmentIds,
  position: helpCenterCategories.position,
  createdAt: helpCenterCategories.createdAt,
  updatedAt: helpCenterCategories.updatedAt,
  deletedAt: helpCenterCategories.deletedAt,
};
export const categoryParams = z.object({
  categoryId: flexibleToTypeIdSchema("kb_category"),
});
const live = (id: KbCategoryId) =>
  and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt));
const fields = {
  name: z.string().trim().min(1).max(200),
  slug: slug.optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  isPublic: z.boolean().optional(),
  segmentIds: idList("segment").optional(),
  position: z.number().int().min(0).max(1000000).optional(),
  parentId: flexibleToTypeIdSchema("kb_category").nullable().optional(),
};
const event =
  (
    type:
      | "help_center.category_created"
      | "help_center.category_updated"
      | "help_center.category_deleted"
      | "help_center.category_restored",
  ) =>
  (_input: unknown, result: { id: string }) => ({
    type,
    entityType: "help_center_category" as const,
    entityId: result.id,
  });

type Node = { id: string; parentId: string | null };
const childrenOf = (flat: Node[], id: string) =>
  flat.filter((node) => node.parentId === id);

/** The category and every live descendant. Visits each node once, so a stored cycle ends. */
export function subtree(flat: Node[], rootId: string) {
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length)
    for (const child of childrenOf(flat, stack.pop()!))
      if (!out.has(child.id)) {
        out.add(child.id);
        stack.push(child.id);
      }
  return out;
}

/** Levels below the node: 0 for a leaf. */
const height = (flat: Node[], id: string, seen = new Set<string>()): number => {
  if (seen.has(id)) return 0;
  seen.add(id);
  return Math.max(
    0,
    ...childrenOf(flat, id).map((child) => height(flat, child.id, seen) + 1),
  );
};

/** Ancestors above the node: 0 for a top-level category. */
const depth = (flat: Node[], id: string) => {
  let levels = 0;
  let node = flat.find((n) => n.id === id);
  const seen = new Set<string>();
  while (node?.parentId && !seen.has(node.id)) {
    seen.add(node.id);
    node = flat.find((n) => n.id === node!.parentId);
    if (node) levels++;
  }
  return levels;
};

/** The source's hierarchy rules: a live parent, no cycle, and no node deeper than MAX_DEPTH. */
export function checkPlacement(
  flat: Node[],
  movingId: string | null,
  parentId: string | null,
) {
  const below = movingId ? height(flat, movingId) : 0;
  if (parentId === null) {
    if (below + 1 > MAX_DEPTH)
      throw bad(`Category subtree exceeds maximum depth of ${MAX_DEPTH}`);
    return;
  }
  if (movingId && subtree(flat, movingId).has(parentId))
    throw bad("A category cannot be moved under itself or its descendant");
  if (!flat.some((node) => node.id === parentId))
    throw notFound("Parent category");
  if (depth(flat, parentId) + 1 + below > MAX_DEPTH - 1)
    throw bad(
      `Placing this category here would exceed the maximum depth of ${MAX_DEPTH}`,
    );
}

/** Every live category, locked, so two moves cannot build a cycle together. */
const lockTree = (db: Db) =>
  db
    .select({
      id: helpCenterCategories.id,
      parentId: helpCenterCategories.parentId,
    })
    .from(helpCenterCategories)
    .where(isNull(helpCenterCategories.deletedAt))
    .orderBy(asc(helpCenterCategories.id))
    .for("update");

const slugTaken = (db: Db, except?: KbCategoryId) => async (value: string) =>
  (
    await db
      .select({ id: helpCenterCategories.id })
      .from(helpCenterCategories)
      .where(
        and(
          eq(helpCenterCategories.slug, value),
          except ? ne(helpCenterCategories.id, except) : undefined,
        ),
      )
      .limit(1)
  ).length > 0;

async function categoryById(db: Db, id: KbCategoryId) {
  const [row] = await db
    .select(columns)
    .from(helpCenterCategories)
    .where(live(id));
  if (!row) throw notFound("Category");
  return row;
}

const listCategories = defineQuillsRoute({
  method: "get",
  path: "/help-center/categories",
  operationId: "listQuillsHelpCenterCategories",
  summary: "List help-center categories with article counts",
  description:
    "Live categories, or categories deleted in the last 30 days with `deleted=true`. Counts include draft articles; recursive counts include descendants.",
  action: "read",
  query: z.object({
    deleted: z.enum(["true", "false"]).default("false"),
    ...pageQuery,
    limit: pageQuery.limit.default(100),
  }),
  response: z.object({
    categories: z.array(counted),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Categories in position order",
  handler: async ({ db, query }) => {
    const trash = query.deleted === "true";
    const { items, nextOffset } = page(
      await db
        .select(columns)
        .from(helpCenterCategories)
        .where(inTrash(helpCenterCategories.deletedAt, trash))
        .orderBy(
          asc(helpCenterCategories.position),
          asc(helpCenterCategories.name),
          asc(helpCenterCategories.id),
        )
        .offset(query.offset)
        .limit(query.limit + 1),
      query,
    );
    // Recursive counts walk the whole tree of the same state, not only this page.
    const tree = await db
      .select({
        id: helpCenterCategories.id,
        parentId: helpCenterCategories.parentId,
      })
      .from(helpCenterCategories)
      .where(inTrash(helpCenterCategories.deletedAt, trash));
    const counts = await db
      .select({
        categoryId: helpCenterArticles.categoryId,
        total: sql<number>`count(*)::int`,
        published: sql<number>`(count(*) filter (where ${helpCenterArticles.publishedAt} <= now()))::int`,
      })
      .from(helpCenterArticles)
      .where(inTrash(helpCenterArticles.deletedAt, trash))
      .groupBy(helpCenterArticles.categoryId);
    const direct = new Map(counts.map((row) => [row.categoryId, row]));
    const sum = (id: string, key: "total" | "published") =>
      [...subtree(tree, id)].reduce(
        (total, node) => total + (direct.get(node as KbCategoryId)?.[key] ?? 0),
        0,
      );
    return {
      categories: items.map((row) => ({
        ...row,
        articleCount: direct.get(row.id)?.total ?? 0,
        publishedArticleCount: direct.get(row.id)?.published ?? 0,
        recursiveArticleCount: sum(row.id, "total"),
        recursivePublishedArticleCount: sum(row.id, "published"),
      })),
      nextOffset,
    };
  },
});

const getCategory = defineQuillsRoute({
  method: "get",
  path: "/help-center/categories/{categoryId}",
  operationId: "getQuillsHelpCenterCategory",
  summary: "Get a help-center category",
  action: "read",
  params: categoryParams,
  response: category,
  responseDescription: "The category",
  errors: { 404: "Category not found" },
  handler: ({ db, params }) => categoryById(db, params.categoryId),
});

const createCategory = defineQuillsRoute({
  method: "post",
  path: "/help-center/categories",
  operationId: "createQuillsHelpCenterCategory",
  summary: "Create a help-center category",
  description:
    "Without a slug, the category gets a free slug made from its name. The public URL ID is allocated once and never changes.",
  action: "manage_settings",
  body: z.object(fields),
  response: category,
  responseDescription: "The created category",
  errors: { 404: "Parent category or segment not found", 409: "Slug taken" },
  event: event("help_center.category_created"),
  handler: async ({ db, body }) => {
    await requireSegments(db, body.segmentIds);
    if (body.parentId) checkPlacement(await lockTree(db), null, body.parentId);
    const value = await freeSlug(
      body.slug ?? slugify(body.name, "category"),
      slugTaken(db),
    );
    const [row] = await db
      .insert(helpCenterCategories)
      .values({
        name: body.name,
        slug: value,
        description: body.description || null,
        icon: body.icon ?? null,
        isPublic: body.isPublic ?? true,
        segmentIds: body.segmentIds ?? [],
        position: body.position ?? 0,
        parentId: body.parentId ?? null,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!row) throw conflict("The slug is taken");
    return row;
  },
});

const updateCategory = defineQuillsRoute({
  method: "patch",
  path: "/help-center/categories/{categoryId}",
  operationId: "updateQuillsHelpCenterCategory",
  summary: "Update or move a help-center category",
  description:
    "A taken slug gets a numeric suffix. A move keeps the tree at most three levels deep and rejects a cycle.",
  action: "manage_settings",
  params: categoryParams,
  body: z
    .object({ ...fields, name: fields.name.optional() })
    .refine(someField, "Change at least one field"),
  response: category,
  responseDescription: "The updated category",
  errors: {
    404: "Category, parent category or segment not found",
    409: "Slug taken",
  },
  event: event("help_center.category_updated"),
  handler: async ({ db, params: { categoryId }, body }) => {
    await requireSegments(db, body.segmentIds);
    if (body.parentId !== undefined) {
      const tree = await lockTree(db);
      if (!tree.some((node) => node.id === categoryId))
        throw notFound("Category");
      checkPlacement(tree, categoryId, body.parentId);
    }
    const value =
      body.slug && (await freeSlug(body.slug, slugTaken(db, categoryId)));
    const [row] = await db
      .update(helpCenterCategories)
      .set({
        name: body.name,
        slug: value || undefined,
        description:
          body.description === undefined ? undefined : body.description || null,
        icon: body.icon,
        isPublic: body.isPublic,
        segmentIds: body.segmentIds,
        position: body.position,
        parentId: body.parentId,
        updatedAt: new Date(),
      })
      .where(live(categoryId))
      .returning(columns)
      .catch((error) => rethrowUnique(error, "The slug is taken"));
    if (!row) throw notFound("Category");
    return row;
  },
});

const deleteCategory = defineQuillsRoute({
  method: "delete",
  path: "/help-center/categories/{categoryId}",
  operationId: "deleteQuillsHelpCenterCategory",
  summary: "Delete a help-center category, its descendants and their articles",
  description:
    "A soft delete: each category and article can be restored for 30 days. Redirect rules that point at them are removed.",
  action: "manage_settings",
  params: categoryParams,
  response: z.object({
    id: z.string(),
    categoryIds: z.array(z.string()),
    articleIds: z.array(z.string()),
  }),
  responseDescription: "The deleted category and what it took with it",
  errors: { 404: "Category not found" },
  event: event("help_center.category_deleted"),
  handler: async ({ db, params: { categoryId } }) => {
    const tree = await lockTree(db);
    if (!tree.some((node) => node.id === categoryId))
      throw notFound("Category");
    const ids = [...subtree(tree, categoryId)] as KbCategoryId[];
    const now = new Date();
    await db
      .update(helpCenterCategories)
      .set({ deletedAt: now })
      .where(inArray(helpCenterCategories.id, ids));
    const articles = await db
      .update(helpCenterArticles)
      .set({ deletedAt: now })
      .where(
        and(
          inArray(helpCenterArticles.categoryId, ids),
          isNull(helpCenterArticles.deletedAt),
        ),
      )
      .returning({ id: helpCenterArticles.id });
    const articleIds = articles.map((article) => article.id);
    await deleteRedirectRules(db, "category", ids);
    await deleteRedirectRules(db, "article", articleIds);
    return { id: categoryId, categoryIds: ids, articleIds };
  },
});

const restoreCategory = defineQuillsRoute({
  method: "post",
  path: "/help-center/categories/{categoryId}/restore",
  operationId: "restoreQuillsHelpCenterCategory",
  summary: "Restore a deleted help-center category",
  description:
    "Restores the category only, within 30 days of its deletion. Restore a deleted parent first.",
  action: "manage_settings",
  params: categoryParams,
  response: category,
  responseDescription: "The restored category",
  errors: {
    404: "Category not found",
    409: "Not deleted, deleted too long ago, or the parent is deleted",
  },
  event: event("help_center.category_restored"),
  handler: async ({ db, params: { categoryId } }) => {
    const [row] = await db
      .select({
        deletedAt: helpCenterCategories.deletedAt,
        parentId: helpCenterCategories.parentId,
      })
      .from(helpCenterCategories)
      .where(eq(helpCenterCategories.id, categoryId))
      .for("update");
    if (!row) throw notFound("Category");
    if (!row.deletedAt) throw conflict("The category is not deleted");
    if (row.deletedAt < restoreCutoff())
      throw conflict(
        "Categories can only be restored within 30 days of deletion",
      );
    if (row.parentId) {
      const [parent] = await db
        .select({ deletedAt: helpCenterCategories.deletedAt })
        .from(helpCenterCategories)
        .where(eq(helpCenterCategories.id, row.parentId));
      if (parent?.deletedAt)
        throw conflict("Restore the parent category first");
      // The parent may have moved since; the tree still stays three levels deep.
      checkPlacement(await lockTree(db), null, row.parentId);
    }
    const [restored] = await db
      .update(helpCenterCategories)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(helpCenterCategories.id, categoryId))
      .returning(columns);
    return restored!;
  },
});

const reorderCategories = defineQuillsRoute({
  method: "put",
  path: "/help-center/categories/order",
  operationId: "reorderQuillsHelpCenterCategories",
  summary: "Reorder the categories under one parent",
  description:
    "Send every live child of `parentId` (null for top-level categories) once, in the new order. A partial or stale list changes nothing.",
  action: "manage_settings",
  body: z.object({
    parentId: flexibleToTypeIdSchema("kb_category").nullable(),
    categoryIds: orderList("kb_category"),
  }),
  response: z.object({ categoryIds: z.array(z.string()) }),
  responseDescription: "The new order",
  errors: {
    404: "Category or parent not found",
    409: "The list is partial or stale",
  },
  event: ({ workspaceId, body }) => ({
    type: "help_center.categories_reordered",
    entityType: "workspace",
    entityId: workspaceId,
    payload: {
      parentId: body.parentId ?? "",
      count: String(body.categoryIds.length),
    },
  }),
  handler: async ({ db, body: { parentId, categoryIds } }) => {
    const tree = await lockTree(db);
    if (parentId && !tree.some((node) => node.id === parentId))
      throw notFound("Parent category");
    checkOrder(
      categoryIds,
      tree.filter((node) => node.parentId === parentId).map((node) => node.id),
    );
    await db
      .update(helpCenterCategories)
      .set({ position: positionCase(helpCenterCategories.id, categoryIds) })
      .where(inArray(helpCenterCategories.id, categoryIds));
    return { categoryIds };
  },
});

// Static paths first: /help-center/categories/{categoryId} would otherwise match them.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...reorderCategories)
  .openapi(...listCategories)
  .openapi(...getCategory)
  .openapi(...createCategory)
  .openapi(...updateCategory)
  .openapi(...deleteCategory)
  .openapi(...restoreCategory);

/** A live category in this workspace, locked against a concurrent delete, for routes that write under it. */
export const requireCategory = async (db: Db, id: KbCategoryId) => {
  const [row] = await db
    .select({ id: helpCenterCategories.id })
    .from(helpCenterCategories)
    .where(live(id))
    .for("no key update");
  if (!row) throw notFound("Category");
  return row.id;
};
