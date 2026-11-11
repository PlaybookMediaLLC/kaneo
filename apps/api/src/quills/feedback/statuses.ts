import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type { PostStatusId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { posts } from "../../database/quills/schema/posts";
import {
  postStatuses,
  STATUS_CATEGORIES,
} from "../../database/quills/schema/statuses";
import {
  defineQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { checkOrder, positionCase } from "./id-sets";
import { hexColor, idList, page, pageQuery, someField } from "./schemas";

type Db = Parameters<AnyQuillsRoute["handler"]>[0]["db"];

const status = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    color: z.string(),
    category: z.enum(STATUS_CATEGORIES),
    position: z.number(),
    showOnRoadmap: z.boolean(),
    isDefault: z.boolean(),
    createdAt: responseTimestamp,
  })
  .openapi("QuillsStatus");
const columns = {
  id: postStatuses.id,
  name: postStatuses.name,
  slug: postStatuses.slug,
  color: postStatuses.color,
  category: postStatuses.category,
  position: postStatuses.position,
  showOnRoadmap: postStatuses.showOnRoadmap,
  isDefault: postStatuses.isDefault,
  createdAt: postStatuses.createdAt,
};
const params = z.object({ statusId: flexibleToTypeIdSchema("post_status") });
const name = z.string().trim().min(1).max(50);
const live = (id: PostStatusId) =>
  and(eq(postStatuses.id, id), isNull(postStatuses.deletedAt));
const notFound = () => new HTTPException(404, { message: "Status not found" });

/**
 * Locks every live status first. A concurrent flip then commits before this UPDATE takes its
 * snapshot, so two requests cannot leave two defaults under READ COMMITTED.
 */
async function makeDefault(db: Db, id: PostStatusId) {
  await db
    .select({ id: postStatuses.id })
    .from(postStatuses)
    .where(isNull(postStatuses.deletedAt))
    .orderBy(asc(postStatuses.id))
    .for("update");
  await db
    .update(postStatuses)
    .set({ isDefault: eq(postStatuses.id, id) })
    .where(or(eq(postStatuses.isDefault, true), eq(postStatuses.id, id)));
}

const getRow = async (db: Db, id: PostStatusId) => {
  const [row] = await db.select(columns).from(postStatuses).where(live(id));
  if (!row) throw notFound();
  return row;
};

const listStatuses = defineQuillsRoute({
  method: "get",
  path: "/statuses",
  operationId: "listQuillsStatuses",
  summary: "List post statuses",
  action: "read",
  query: z.object(pageQuery),
  response: z.object({
    statuses: z.array(status),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Statuses by category, then position",
  handler: async ({ db, query }) => {
    const rows = await db
      .select(columns)
      .from(postStatuses)
      .where(isNull(postStatuses.deletedAt))
      .orderBy(
        sql`array_position(array['active','complete','closed'], ${postStatuses.category})`,
        asc(postStatuses.position),
        asc(postStatuses.id),
      )
      .offset(query.offset)
      .limit(query.limit + 1);
    const { items, nextOffset } = page(rows, query);
    return { statuses: items, nextOffset };
  },
});

const getStatus = defineQuillsRoute({
  method: "get",
  path: "/statuses/{statusId}",
  operationId: "getQuillsStatus",
  summary: "Get a post status",
  action: "read",
  params,
  response: status,
  responseDescription: "The status",
  errors: { 404: "Status not found" },
  handler: ({ db, params }) => getRow(db, params.statusId),
});

const createStatus = defineQuillsRoute({
  method: "post",
  path: "/statuses",
  operationId: "createQuillsStatus",
  summary: "Create a post status",
  action: "manage_settings",
  body: z.object({
    name,
    slug: z
      .string()
      .min(1)
      .max(50)
      .regex(/^[a-z0-9_]+$/, "Use lowercase letters, digits and underscores"),
    color: hexColor,
    category: z.enum(STATUS_CATEGORIES),
    position: z.number().int().min(0).max(10000).optional(),
    showOnRoadmap: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  }),
  response: status,
  responseDescription: "The created status",
  errors: { 409: "A status with this slug exists" },
  event: (_input, result) => ({
    type: "status.created",
    entityType: "status",
    entityId: result.id,
  }),
  handler: async ({ db, body }) => {
    // Slugs stay unique against deleted statuses too (the table constraint).
    const [row] = await db
      .insert(postStatuses)
      .values({
        name: body.name,
        slug: body.slug,
        color: body.color,
        category: body.category,
        position: body.position ?? 0,
        showOnRoadmap: body.showOnRoadmap ?? false,
        isDefault: body.isDefault ?? false,
      })
      .onConflictDoNothing()
      .returning({ id: postStatuses.id });
    if (!row)
      throw new HTTPException(409, {
        message: `A status with slug "${body.slug}" already exists`,
      });
    if (body.isDefault) await makeDefault(db, row.id);
    return getRow(db, row.id);
  },
});

const updateStatus = defineQuillsRoute({
  method: "patch",
  path: "/statuses/{statusId}",
  operationId: "updateQuillsStatus",
  summary: "Update a post status",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: name.optional(),
      color: hexColor.optional(),
      showOnRoadmap: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    })
    .refine(someField, "Change at least one field"),
  response: status,
  responseDescription: "The updated status",
  errors: { 404: "Status not found" },
  event: ({ params }) => ({
    type: "status.updated",
    entityType: "status",
    entityId: params.statusId,
  }),
  handler: async ({ db, params, body }) => {
    await getRow(db, params.statusId);
    if (body.isDefault) await makeDefault(db, params.statusId);
    const changes = {
      name: body.name,
      color: body.color,
      showOnRoadmap: body.showOnRoadmap,
      isDefault: body.isDefault === false ? false : undefined,
    };
    if (someField(changes))
      await db.update(postStatuses).set(changes).where(live(params.statusId));
    return getRow(db, params.statusId);
  },
});

const deleteStatus = defineQuillsRoute({
  method: "delete",
  path: "/statuses/{statusId}",
  operationId: "deleteQuillsStatus",
  summary: "Delete a post status that no post uses",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted status",
  errors: {
    404: "Status not found",
    409: "The status is the default or posts still use it",
  },
  event: ({ params }) => ({
    type: "status.deleted",
    entityType: "status",
    entityId: params.statusId,
  }),
  handler: async ({ db, params }) => {
    // FOR UPDATE waits for writers that hold a key-share lock through a post's status foreign key.
    const [row] = await db
      .select({ isDefault: postStatuses.isDefault })
      .from(postStatuses)
      .where(live(params.statusId))
      .for("update");
    if (!row) throw notFound();
    if (row.isDefault)
      throw new HTTPException(409, {
        message: "Set another default status before you delete this one",
      });
    const [used] = await db
      .select({ n: count() })
      .from(posts)
      .where(and(eq(posts.statusId, params.statusId), isNull(posts.deletedAt)));
    if (used!.n > 0)
      throw new HTTPException(409, {
        message: `${used!.n} post(s) use this status. Move them first.`,
      });
    await db
      .update(postStatuses)
      .set({ deletedAt: new Date() })
      .where(live(params.statusId));
    return { id: params.statusId };
  },
});

const reorderStatuses = defineQuillsRoute({
  method: "put",
  path: "/statuses/order",
  operationId: "reorderQuillsStatuses",
  summary: "Reorder all post statuses",
  description:
    "Send every live status ID once, in the new order. A partial or stale list changes nothing.",
  action: "manage_settings",
  body: z.object({ statusIds: idList("post_status").min(1) }),
  response: z.object({ statusIds: z.array(z.string()) }),
  responseDescription: "The new order",
  errors: { 404: "Status not found", 409: "The list is partial or stale" },
  event: ({ workspaceId, body }) => ({
    type: "status.reordered",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { count: String(body.statusIds.length) },
  }),
  handler: async ({ db, body: { statusIds } }) => {
    const rows = await db
      .select({ id: postStatuses.id })
      .from(postStatuses)
      .where(isNull(postStatuses.deletedAt))
      .orderBy(asc(postStatuses.id))
      .for("update");
    checkOrder(
      statusIds,
      rows.map((row) => row.id),
    );
    await db
      .update(postStatuses)
      .set({ position: positionCase(postStatuses.id, statusIds) })
      .where(inArray(postStatuses.id, statusIds));
    return { statusIds };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...reorderStatuses)
  .openapi(...listStatuses)
  .openapi(...getStatus)
  .openapi(...createStatus)
  .openapi(...updateStatus)
  .openapi(...deleteStatus);
