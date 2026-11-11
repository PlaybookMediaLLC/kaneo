import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { ChangelogCategoryId, SegmentId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { changelogCategories } from "../../database/quills/schema/changelog-categories";
import { segments } from "../../database/quills/schema/segments";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { checkOrder, positionCase, requireAll } from "./id-sets";
import { hexColor, idList, page, pageQuery, someField } from "./schemas";

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

const category = z
  .object({
    id: z.string(),
    name: z.string(),
    color: z.string(),
    segmentIds: z.array(z.string()),
    position: z.number(),
    createdAt: responseTimestamp,
  })
  .openapi("QuillsChangelogCategory");
const columns = {
  id: changelogCategories.id,
  name: changelogCategories.name,
  color: changelogCategories.color,
  segmentIds: changelogCategories.segmentIds,
  position: changelogCategories.position,
  createdAt: changelogCategories.createdAt,
};
const params = z.object({
  categoryId: flexibleToTypeIdSchema("changelog_category"),
});
const name = z.string().trim().min(1).max(50);
const notFound = () =>
  new HTTPException(404, { message: "Category not found" });
const duplicate = (value: string) =>
  new HTTPException(409, {
    message: `A category named "${value}" already exists`,
  });
const categoryEvent =
  (
    type:
      | "changelog.category_created"
      | "changelog.category_updated"
      | "changelog.category_deleted",
  ) =>
  (_input: unknown, result: { id: string }) => ({
    type,
    entityType: "changelog" as const,
    entityId: result.id,
  });

/** Names are unique without regard to case (the table's lower(name) index). */
async function assertUniqueName(
  db: Db,
  value: string,
  except?: ChangelogCategoryId,
) {
  const [found] = await db
    .select({ id: changelogCategories.id })
    .from(changelogCategories)
    .where(
      and(
        sql`lower(${changelogCategories.name}) = lower(${value})`,
        except ? ne(changelogCategories.id, except) : undefined,
      ),
    );
  if (found) throw duplicate(value);
}

async function requireSegments(db: Db, ids: SegmentId[] | undefined) {
  if (ids?.length)
    requireAll(
      ids,
      await db
        .select({ id: segments.id })
        .from(segments)
        .where(and(inArray(segments.id, ids), isNull(segments.deletedAt))),
      "Segment",
    );
}

const listCategories = defineQuillsRoute({
  method: "get",
  path: "/changelog/categories",
  operationId: "listQuillsChangelogCategories",
  summary: "List changelog categories",
  action: "read",
  query: z.object(pageQuery),
  response: z.object({
    categories: z.array(category),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Categories in position order",
  handler: async ({ db, query }) => {
    const { items, nextOffset } = page(
      await db
        .select(columns)
        .from(changelogCategories)
        .orderBy(
          asc(changelogCategories.position),
          asc(changelogCategories.createdAt),
          asc(changelogCategories.id),
        )
        .offset(query.offset)
        .limit(query.limit + 1),
      query,
    );
    return { categories: items, nextOffset };
  },
});

const createCategory = defineQuillsRoute({
  method: "post",
  path: "/changelog/categories",
  operationId: "createQuillsChangelogCategory",
  summary: "Create a changelog category",
  action: "manage_settings",
  body: z.object({
    name,
    color: hexColor.default("#6b7280"),
    segmentIds: idList("segment").optional(),
  }),
  response: category,
  responseDescription: "The created category",
  errors: { 404: "Segment not found", 409: "A category with this name exists" },
  event: categoryEvent("changelog.category_created"),
  handler: async ({ db, body }) => {
    await assertUniqueName(db, body.name);
    await requireSegments(db, body.segmentIds);
    const [next] = await db
      .select({
        position: sql<number>`coalesce(max(${changelogCategories.position}), -1)::int + 1`,
      })
      .from(changelogCategories);
    const [row] = await db
      .insert(changelogCategories)
      .values({
        name: body.name,
        color: body.color,
        segmentIds: body.segmentIds ?? [],
        position: next!.position,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!row) throw duplicate(body.name);
    return row;
  },
});

const updateCategory = defineQuillsRoute({
  method: "patch",
  path: "/changelog/categories/{categoryId}",
  operationId: "updateQuillsChangelogCategory",
  summary: "Update a changelog category",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: name.optional(),
      color: hexColor.optional(),
      segmentIds: idList("segment").optional(),
    })
    .refine(someField, "Change at least one field"),
  response: category,
  responseDescription: "The updated category",
  errors: {
    404: "Category or segment not found",
    409: "A category with this name exists",
  },
  event: categoryEvent("changelog.category_updated"),
  handler: async ({ db, params, body }) => {
    if (body.name !== undefined)
      await assertUniqueName(db, body.name, params.categoryId);
    await requireSegments(db, body.segmentIds);
    const [row] = await db
      .update(changelogCategories)
      .set({ name: body.name, color: body.color, segmentIds: body.segmentIds })
      .where(eq(changelogCategories.id, params.categoryId))
      .returning(columns);
    if (!row) throw notFound();
    return row;
  },
});

// Entry links cascade with the category.
const deleteCategory = defineQuillsRoute({
  method: "delete",
  path: "/changelog/categories/{categoryId}",
  operationId: "deleteQuillsChangelogCategory",
  summary: "Delete a changelog category",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted category",
  errors: { 404: "Category not found" },
  event: categoryEvent("changelog.category_deleted"),
  handler: async ({ db, params }) => {
    const [row] = await db
      .delete(changelogCategories)
      .where(eq(changelogCategories.id, params.categoryId))
      .returning({ id: changelogCategories.id });
    if (!row) throw notFound();
    return row;
  },
});

const reorderCategories = defineQuillsRoute({
  method: "put",
  path: "/changelog/categories/order",
  operationId: "reorderQuillsChangelogCategories",
  summary: "Reorder all changelog categories",
  description:
    "Send every category ID once, in the new order. A partial or stale list changes nothing.",
  action: "manage_settings",
  body: z.object({ categoryIds: idList("changelog_category").min(1) }),
  response: z.object({ categoryIds: z.array(z.string()) }),
  responseDescription: "The new order",
  errors: { 404: "Category not found", 409: "The list is partial or stale" },
  event: ({ workspaceId, body }) => ({
    type: "changelog.category_reordered",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { count: String(body.categoryIds.length) },
  }),
  handler: async ({ db, body: { categoryIds } }) => {
    const rows = await db
      .select({ id: changelogCategories.id })
      .from(changelogCategories)
      .for("update");
    checkOrder(
      categoryIds,
      rows.map((row) => row.id),
    );
    await db
      .update(changelogCategories)
      .set({ position: positionCase(changelogCategories.id, categoryIds) })
      .where(inArray(changelogCategories.id, categoryIds));
    return { categoryIds };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...reorderCategories)
  .openapi(...listCategories)
  .openapi(...createCategory)
  .openapi(...updateCategory)
  .openapi(...deleteCategory);
