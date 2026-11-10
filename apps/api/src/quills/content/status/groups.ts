import { asc, eq, inArray, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import {
  statusComponentGroups,
  statusComponents,
} from "../../../database/quills/schema/status";
import { defineQuillsRoute } from "../../framework/define-route";
import { checkOrder, positionCase } from "../../feedback/id-sets";
import { someField } from "../../feedback/schemas";
import { orderList } from "../help-center/shared";
import { notFound } from "./shared";

const group = z
  .object({
    id: z.string(),
    name: z.string(),
    position: z.number(),
    collapsed: z.boolean(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsStatusGroup");
const columns = {
  id: statusComponentGroups.id,
  name: statusComponentGroups.name,
  position: statusComponentGroups.position,
  collapsed: statusComponentGroups.collapsed,
  createdAt: statusComponentGroups.createdAt,
  updatedAt: statusComponentGroups.updatedAt,
};
const params = z.object({ groupId: flexibleToTypeIdSchema("status_group") });
const name = z.string().trim().min(1).max(200);
const event =
  (
    type:
      | "status.group_created"
      | "status.group_updated"
      | "status.group_deleted",
  ) =>
  (_input: unknown, result: { id: string }) => ({
    type,
    entityType: "status_group" as const,
    entityId: result.id,
  });

const createGroup = defineQuillsRoute({
  method: "post",
  path: "/status/groups",
  operationId: "createQuillsStatusGroup",
  summary: "Create a status component group",
  description: "The group goes last.",
  action: "manage_settings",
  body: z.object({ name, collapsed: z.boolean().optional() }),
  response: group,
  responseDescription: "The created group",
  event: event("status.group_created"),
  handler: async ({ db, body }) => {
    const [row] = await db
      .insert(statusComponentGroups)
      .values({
        name: body.name,
        collapsed: body.collapsed ?? false,
        position: sql`(select coalesce(max(${statusComponentGroups.position}), -1) + 1 from ${statusComponentGroups})`,
      })
      .returning(columns);
    return row!;
  },
});

const updateGroup = defineQuillsRoute({
  method: "patch",
  path: "/status/groups/{groupId}",
  operationId: "updateQuillsStatusGroup",
  summary: "Rename or collapse a status component group",
  action: "manage_settings",
  params,
  body: z
    .object({ name: name.optional(), collapsed: z.boolean().optional() })
    .refine(someField, "Change at least one field"),
  response: group,
  responseDescription: "The updated group",
  errors: { 404: "Group not found" },
  event: event("status.group_updated"),
  handler: async ({ db, params, body }) => {
    const [row] = await db
      .update(statusComponentGroups)
      .set({
        name: body.name,
        collapsed: body.collapsed,
        updatedAt: new Date(),
      })
      .where(eq(statusComponentGroups.id, params.groupId))
      .returning(columns);
    if (!row) throw notFound("Group");
    return row;
  },
});

const deleteGroup = defineQuillsRoute({
  method: "delete",
  path: "/status/groups/{groupId}",
  operationId: "deleteQuillsStatusGroup",
  summary: "Delete a status component group",
  description: "Its components stay and become ungrouped.",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted group",
  errors: { 404: "Group not found" },
  event: event("status.group_deleted"),
  handler: async ({ db, params }) => {
    // The foreign key ungroups the components. Lock them in id order first, as a lifecycle
    // recompute does, so the cascade cannot deadlock against one.
    await db
      .select({ id: statusComponents.id })
      .from(statusComponents)
      .where(eq(statusComponents.groupId, params.groupId))
      .orderBy(asc(statusComponents.id))
      .for("no key update");
    const [row] = await db
      .delete(statusComponentGroups)
      .where(eq(statusComponentGroups.id, params.groupId))
      .returning({ id: statusComponentGroups.id });
    if (!row) throw notFound("Group");
    return row;
  },
});

const reorderGroups = defineQuillsRoute({
  method: "put",
  path: "/status/groups/order",
  operationId: "reorderQuillsStatusGroups",
  summary: "Reorder all status component groups",
  description:
    "Send every group ID once, in the new order. A partial or stale list changes nothing.",
  action: "manage_settings",
  body: z.object({ groupIds: orderList("status_group") }),
  response: z.object({ groupIds: z.array(z.string()) }),
  responseDescription: "The new order",
  errors: { 404: "Group not found", 409: "The list is partial or stale" },
  event: ({ workspaceId, body }) => ({
    type: "status.groups_reordered",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { count: String(body.groupIds.length) },
  }),
  handler: async ({ db, body: { groupIds } }) => {
    const rows = await db
      .select({ id: statusComponentGroups.id })
      .from(statusComponentGroups)
      .orderBy(asc(statusComponentGroups.id))
      .for("update");
    checkOrder(
      groupIds,
      rows.map((row) => row.id),
    );
    await db
      .update(statusComponentGroups)
      .set({ position: positionCase(statusComponentGroups.id, groupIds) })
      .where(inArray(statusComponentGroups.id, groupIds));
    return { groupIds };
  },
});

// Static paths first: /status/groups/{groupId} would otherwise match them.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...reorderGroups)
  .openapi(...createGroup)
  .openapi(...updateGroup)
  .openapi(...deleteGroup);
