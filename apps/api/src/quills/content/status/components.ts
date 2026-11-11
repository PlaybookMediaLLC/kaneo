import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { StatusComponentGroupId, StatusComponentId } from "@kaneo/ids";
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
import { idList, someField } from "../../feedback/schemas";
import { orderList, requireSegments } from "../help-center/shared";
import {
  componentStatus,
  notFound,
  writeComponentStatus,
  type Db,
} from "./shared";

export const component = z
  .object({
    id: z.string(),
    groupId: z.string().nullable(),
    name: z.string(),
    description: z.string().nullable(),
    status: componentStatus,
    position: z.number(),
    showUptime: z.boolean(),
    segmentIds: z.array(z.string()),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsStatusComponent");
export const componentColumns = {
  id: statusComponents.id,
  groupId: statusComponents.groupId,
  name: statusComponents.name,
  description: statusComponents.description,
  status: statusComponents.status,
  position: statusComponents.position,
  showUptime: statusComponents.showUptime,
  segmentIds: statusComponents.segmentIds,
  createdAt: statusComponents.createdAt,
  updatedAt: statusComponents.updatedAt,
};
const params = z.object({
  componentId: flexibleToTypeIdSchema("status_component"),
});
const live = (id: StatusComponentId) =>
  and(eq(statusComponents.id, id), isNull(statusComponents.deletedAt));
const fields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  groupId: flexibleToTypeIdSchema("status_group").nullable().optional(),
  showUptime: z.boolean().optional(),
  segmentIds: idList("segment").optional(),
  status: componentStatus.optional(),
};

async function requireGroup(
  db: Db,
  id: StatusComponentGroupId | null | undefined,
) {
  if (!id) return;
  const [row] = await db
    .select({ id: statusComponentGroups.id })
    .from(statusComponentGroups)
    .where(eq(statusComponentGroups.id, id))
    .for("key share");
  if (!row) throw notFound("Group");
}

async function componentById(db: Db, id: StatusComponentId) {
  const [row] = await db
    .select(componentColumns)
    .from(statusComponents)
    .where(live(id));
  if (!row) throw notFound("Component");
  return row;
}

// ponytail: returns every live component and group (the editor tree); page it if pages grow past hundreds.
const listComponents = defineQuillsRoute({
  method: "get",
  path: "/status/components",
  operationId: "listQuillsStatusComponents",
  summary: "List status components by group",
  description:
    "Every group with its live components, then the ungrouped components, in position order. Segment gates do not hide components from teammates.",
  action: "read",
  response: z.object({
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        position: z.number(),
        collapsed: z.boolean(),
        components: z.array(component),
      }),
    ),
    ungrouped: z.array(component),
  }),
  responseDescription: "The component tree",
  handler: async ({ db }) => {
    const groups = await db
      .select({
        id: statusComponentGroups.id,
        name: statusComponentGroups.name,
        position: statusComponentGroups.position,
        collapsed: statusComponentGroups.collapsed,
      })
      .from(statusComponentGroups)
      .orderBy(
        asc(statusComponentGroups.position),
        asc(statusComponentGroups.id),
      );
    const components = await db
      .select(componentColumns)
      .from(statusComponents)
      .where(isNull(statusComponents.deletedAt))
      .orderBy(asc(statusComponents.position), asc(statusComponents.id));
    return {
      groups: groups.map((group) => ({
        ...group,
        components: components.filter((c) => c.groupId === group.id),
      })),
      ungrouped: components.filter((c) => !c.groupId),
    };
  },
});

const getComponent = defineQuillsRoute({
  method: "get",
  path: "/status/components/{componentId}",
  operationId: "getQuillsStatusComponent",
  summary: "Get a status component",
  action: "read",
  params,
  response: component,
  responseDescription: "The component",
  errors: { 404: "Component not found" },
  handler: ({ db, params }) => componentById(db, params.componentId),
});

const createComponent = defineQuillsRoute({
  method: "post",
  path: "/status/components",
  operationId: "createQuillsStatusComponent",
  summary: "Create a status component",
  description:
    "The component goes last. Its starting status writes no history.",
  action: "manage_settings",
  body: z.object(fields),
  response: component,
  responseDescription: "The created component",
  errors: { 404: "Group or segment not found" },
  event: (_input, result) => ({
    type: "status.component_created",
    entityType: "status_component",
    entityId: result.id,
  }),
  handler: async ({ db, body }) => {
    await requireGroup(db, body.groupId);
    await requireSegments(db, body.segmentIds);
    const [row] = await db
      .insert(statusComponents)
      .values({
        name: body.name,
        description: body.description || null,
        groupId: body.groupId ?? null,
        status: body.status ?? "operational",
        showUptime: body.showUptime ?? true,
        segmentIds: body.segmentIds ?? [],
        position: sql`(select coalesce(max(${statusComponents.position}), -1) + 1 from ${statusComponents})`,
      })
      .returning(componentColumns);
    return row!;
  },
});

const updateComponent = defineQuillsRoute({
  method: "patch",
  path: "/status/components/{componentId}",
  operationId: "updateQuillsStatusComponent",
  summary: "Update a status component or set its live status",
  description:
    "A `status` change appends to the uptime history. A `{ status }` body alone is the monitoring automation hook.",
  action: "manage_settings",
  params,
  body: z
    .object({ ...fields, name: fields.name.optional() })
    .refine(someField, "Change at least one field"),
  response: component.extend({
    previousStatus: componentStatus.nullable().openapi({
      description: "The replaced status when this request changed it",
    }),
  }),
  responseDescription: "The updated component",
  errors: { 404: "Component, group or segment not found" },
  event: (_input, result) => ({
    type: result.previousStatus
      ? "status.component_changed"
      : "status.component_updated",
    entityType: "status_component",
    entityId: result.id,
    payload: (result.previousStatus
      ? { previousStatus: result.previousStatus, status: result.status }
      : {}) as Record<string, string>,
  }),
  handler: async ({ db, params: { componentId }, body }) => {
    const [current] = await db
      .select({ id: statusComponents.id, status: statusComponents.status })
      .from(statusComponents)
      .where(live(componentId))
      .for("no key update");
    if (!current) throw notFound("Component");
    await requireGroup(db, body.groupId);
    await requireSegments(db, body.segmentIds);
    await db
      .update(statusComponents)
      .set({
        name: body.name,
        description:
          body.description === undefined ? undefined : body.description || null,
        groupId: body.groupId,
        showUptime: body.showUptime,
        segmentIds: body.segmentIds,
        updatedAt: new Date(),
      })
      .where(live(componentId));
    const changed =
      body.status !== undefined &&
      (await writeComponentStatus(db, current, body.status, "manual", null));
    return {
      ...(await componentById(db, componentId)),
      previousStatus: changed ? current.status : null,
    };
  },
});

const deleteComponent = defineQuillsRoute({
  method: "delete",
  path: "/status/components/{componentId}",
  operationId: "deleteQuillsStatusComponent",
  summary: "Delete a status component",
  description:
    "A soft delete: incident history keeps its links, and lifecycle writes skip the component.",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted component",
  errors: { 404: "Component not found" },
  event: ({ params }) => ({
    type: "status.component_deleted",
    entityType: "status_component",
    entityId: params.componentId,
  }),
  handler: async ({ db, params }) => {
    const [row] = await db
      .update(statusComponents)
      .set({ deletedAt: new Date() })
      .where(live(params.componentId))
      .returning({ id: statusComponents.id });
    if (!row) throw notFound("Component");
    return row;
  },
});

const reorderComponents = defineQuillsRoute({
  method: "put",
  path: "/status/components/order",
  operationId: "reorderQuillsStatusComponents",
  summary: "Reorder all status components",
  description:
    "Send every live component ID once, in the new order. A partial or stale list changes nothing.",
  action: "manage_settings",
  body: z.object({ componentIds: orderList("status_component") }),
  response: z.object({ componentIds: z.array(z.string()) }),
  responseDescription: "The new order",
  errors: { 404: "Component not found", 409: "The list is partial or stale" },
  event: ({ workspaceId, body }) => ({
    type: "status.components_reordered",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { count: String(body.componentIds.length) },
  }),
  handler: async ({ db, body: { componentIds } }) => {
    // Locked in id order, as a lifecycle recompute takes them.
    const rows = await db
      .select({ id: statusComponents.id })
      .from(statusComponents)
      .where(isNull(statusComponents.deletedAt))
      .orderBy(asc(statusComponents.id))
      .for("no key update");
    checkOrder(
      componentIds,
      rows.map((row) => row.id),
    );
    await db
      .update(statusComponents)
      .set({ position: positionCase(statusComponents.id, componentIds) })
      .where(inArray(statusComponents.id, componentIds));
    return { componentIds };
  },
});

// Static paths first: /status/components/{componentId} would otherwise match them.
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...reorderComponents)
  .openapi(...listComponents)
  .openapi(...getComponent)
  .openapi(...createComponent)
  .openapi(...updateComponent)
  .openapi(...deleteComponent);
