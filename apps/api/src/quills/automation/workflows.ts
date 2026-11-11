import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import {
  workflowVersions,
  workflows,
} from "../../database/quills/schema/workflows";
import { defineQuillsRoute } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import { checkOrder, positionCase } from "../feedback/id-sets";
import { someField } from "../feedback/schemas";
import { conflict, notFound } from "../support/conversation-model";
import {
  actingPrincipal,
  actorsOf,
  checkReferences,
  findWorkflow,
  graphInput,
  TRIGGERS,
  view,
  workflowOut,
  writeVersion,
  type WorkflowGraph,
} from "./model";

// Workflow configuration. Every route needs manage_settings. Each save that changes what a
// workflow does, and each publish, writes a version by the caller: the newest version's
// author is the teammate the live workflow acts as (see model.ts actingPrincipal).

export const workflowParams = z.object({
  workflowId: flexibleToTypeIdSchema("workflow"),
});
const errors = {
  404: "Workflow, version, teammate, team or tag not found",
  409: "The workflow cannot change this way",
};
const name = z.string().trim().min(1).max(120);
const triggerType = z.enum(TRIGGERS);
const loadMembers = ({ workspaceId }: { workspaceId: string }) =>
  memberUserIds(workspaceId);
const workflowEvent =
  (
    type:
      | "workflow.updated"
      | "workflow.deleted"
      | "workflow.published"
      | "workflow.paused",
  ) =>
  ({ params }: { params: { workflowId: string } }, result: object) =>
    (!("changed" in result) || result.changed === true) && {
      type,
      entityType: "workflow" as const,
      entityId: params.workflowId,
    };

/** JSON with sorted keys: stored jsonb and request bodies order keys differently. */
const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : v,
  );

/** A stored graph must still validate before it can go live or come back from history. */
function validGraph(raw: unknown) {
  const parsed = graphInput.safeParse(raw);
  if (!parsed.success)
    throw conflict("The stored graph is not valid; save the workflow again");
  return parsed.data;
}

const list = defineQuillsRoute({
  method: "get",
  path: "/automation/workflows",
  operationId: "listQuillsWorkflows",
  summary: "List workflows",
  description: "In run order. Deleted workflows are left out.",
  action: "manage_settings",
  response: z.object({ workflows: z.array(workflowOut) }),
  responseDescription: "The workflows",
  handler: async ({ db }) => {
    // ponytail: the first 200 workflows; page this list if workspaces build more.
    const rows = await db
      .select()
      .from(workflows)
      .where(isNull(workflows.deletedAt))
      .orderBy(asc(workflows.sortOrder), asc(workflows.createdAt))
      .limit(200);
    const actors = await actorsOf(
      db,
      rows.map((row) => row.id),
    );
    return {
      workflows: rows.map((row) => view(row, actors.get(row.id) ?? null)),
    };
  },
});

const get = defineQuillsRoute({
  method: "get",
  path: "/automation/workflows/{workflowId}",
  operationId: "getQuillsWorkflow",
  summary: "Get a workflow",
  action: "manage_settings",
  params: workflowParams,
  response: workflowOut,
  responseDescription: "The workflow",
  errors: { 404: "Workflow not found" },
  handler: async ({ db, params }) => {
    const row = await findWorkflow(db, params.workflowId);
    return view(row, await actingPrincipal(db, row.id));
  },
});

const create = defineQuillsRoute({
  method: "post",
  path: "/automation/workflows",
  operationId: "createQuillsWorkflow",
  summary: "Create a draft workflow",
  description:
    "Every teammate, team and tag an action names must exist. A workflow starts as a draft and runs only after it is published.",
  action: "manage_settings",
  body: z.object({
    name,
    triggerType,
    graph: graphInput.default({ nodes: [], edges: [] }),
  }),
  load: loadMembers,
  response: workflowOut,
  responseDescription: "The created workflow",
  errors: { 404: "Teammate, team or tag not found" },
  event: (_input, result) => ({
    type: "workflow.created",
    entityType: "workflow",
    entityId: result.id,
  }),
  handler: async ({ db, actor, body, loaded }) => {
    await checkReferences(db, loaded, body.graph);
    const [last] = await db
      .select({
        next: sql<number>`coalesce(max(${workflows.sortOrder}) + 1, 0)::int`,
      })
      .from(workflows)
      .where(isNull(workflows.deletedAt));
    const [row] = await db
      .insert(workflows)
      .values({
        name: body.name,
        // Every run is a background run: no customer-facing journey steps are ported.
        class: "background",
        status: "draft",
        triggerType: body.triggerType,
        graph: body.graph as Record<string, unknown>,
        sortOrder: last?.next ?? 0,
        createdBy: actor.principalId,
      })
      .returning();
    await writeVersion(db, row!, actor.principalId);
    return view(row!, actor.principalId);
  },
});

const update = defineQuillsRoute({
  method: "patch",
  path: "/automation/workflows/{workflowId}",
  operationId: "updateQuillsWorkflow",
  summary: "Update a workflow",
  description:
    "A change writes a version by the caller. A live workflow then acts as the caller, so an edit never runs with another teammate's permissions.",
  action: "manage_settings",
  params: workflowParams,
  body: z
    .object({
      name: name.optional(),
      triggerType: triggerType.optional(),
      graph: graphInput.optional(),
    })
    .refine(someField, "Change at least one field"),
  load: loadMembers,
  response: workflowOut.extend({ changed: z.boolean() }),
  responseDescription: "The workflow and whether it changed",
  errors,
  event: workflowEvent("workflow.updated"),
  handler: async ({ db, actor, params, body, loaded }) => {
    const current = await findWorkflow(db, params.workflowId, true);
    if (body.graph) await checkReferences(db, loaded, body.graph);
    const next = {
      name: body.name ?? current.name,
      triggerType: body.triggerType ?? current.triggerType,
      graph: (body.graph ?? current.graph) as Record<string, unknown>,
    };
    const changed =
      next.name !== current.name ||
      next.triggerType !== current.triggerType ||
      stable(next.graph) !== stable(current.graph);
    if (!changed)
      return {
        ...view(current, await actingPrincipal(db, current.id)),
        changed,
      };
    const [row] = await db
      .update(workflows)
      .set({
        name: next.name,
        triggerType: next.triggerType,
        graph: next.graph,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, current.id))
      .returning();
    await writeVersion(db, row!, actor.principalId);
    return { ...view(row!, actor.principalId), changed };
  },
});

const remove = defineQuillsRoute({
  method: "delete",
  path: "/automation/workflows/{workflowId}",
  operationId: "deleteQuillsWorkflow",
  summary: "Delete a workflow",
  description:
    "A soft delete: it stops running and its runs and versions stay for reporting.",
  action: "manage_settings",
  params: workflowParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted workflow",
  errors: { 404: "Workflow not found" },
  event: workflowEvent("workflow.deleted"),
  handler: async ({ db, params }) => {
    const current = await findWorkflow(db, params.workflowId, true);
    await db
      .update(workflows)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workflows.id, current.id));
    return { id: current.id };
  },
});

const reorder = defineQuillsRoute({
  method: "put",
  path: "/automation/workflows/order",
  operationId: "reorderQuillsWorkflows",
  summary: "Reorder all workflows",
  description:
    "Send every workflow ID once, in the new order. Runs for one event are queued in this order. A partial or stale list changes nothing.",
  action: "manage_settings",
  body: z.object({
    workflowIds: z
      .array(flexibleToTypeIdSchema("workflow"))
      .min(1)
      .max(200)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Each ID can appear only once",
      ),
  }),
  response: z.object({ workflowIds: z.array(z.string()) }),
  responseDescription: "The new order",
  errors: { 404: "Workflow not found", 409: "The list is partial or stale" },
  event: ({ workspaceId, body }) => ({
    type: "workflow.reordered",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { count: String(body.workflowIds.length) },
  }),
  handler: async ({ db, body: { workflowIds } }) => {
    const rows = await db
      .select({ id: workflows.id })
      .from(workflows)
      .where(isNull(workflows.deletedAt))
      .orderBy(asc(workflows.id))
      .for("update");
    checkOrder(
      workflowIds,
      rows.map((row) => row.id),
    );
    await db
      .update(workflows)
      .set({ sortOrder: positionCase(workflows.id, workflowIds) })
      .where(inArray(workflows.id, workflowIds));
    return { workflowIds };
  },
});

const publish = defineQuillsRoute({
  method: "post",
  path: "/automation/workflows/{workflowId}/publish",
  operationId: "publishQuillsWorkflow",
  summary: "Publish or re-enable a workflow",
  description:
    "Makes the workflow live and records the caller as the teammate it acts as. Each run checks that teammate's current Kaneo role; a run they may not do fails as denied.",
  action: "manage_settings",
  params: workflowParams,
  load: loadMembers,
  response: workflowOut,
  responseDescription: "The live workflow",
  errors,
  event: workflowEvent("workflow.published"),
  handler: async ({ db, actor, params, loaded }) => {
    const current = await findWorkflow(db, params.workflowId, true);
    if (!(TRIGGERS as readonly string[]).includes(current.triggerType))
      throw conflict("The workflow's trigger is not available");
    await checkReferences(db, loaded, validGraph(current.graph));
    const [row] = await db
      .update(workflows)
      .set({ status: "live", updatedAt: new Date() })
      .where(eq(workflows.id, current.id))
      .returning();
    await writeVersion(db, row!, actor.principalId);
    return view(row!, actor.principalId);
  },
});

const pause = defineQuillsRoute({
  method: "post",
  path: "/automation/workflows/{workflowId}/pause",
  operationId: "pauseQuillsWorkflow",
  summary: "Pause a live workflow",
  description:
    "Queued runs that have not started do nothing once it is paused.",
  action: "manage_settings",
  params: workflowParams,
  response: workflowOut.extend({ changed: z.boolean() }),
  responseDescription: "The workflow and whether it changed",
  errors: { 404: "Workflow not found" },
  event: workflowEvent("workflow.paused"),
  handler: async ({ db, params }) => {
    const current = await findWorkflow(db, params.workflowId, true);
    const changed = current.status === "live";
    const [row] = changed
      ? await db
          .update(workflows)
          .set({ status: "paused", updatedAt: new Date() })
          .where(eq(workflows.id, current.id))
          .returning()
      : [current];
    return {
      ...view(row!, await actingPrincipal(db, current.id)),
      changed,
    };
  },
});

const versionOut = z.object({
  id: z.string(),
  name: z.string(),
  triggerType: z.string(),
  nodeCount: z.number(),
  edgeCount: z.number(),
  createdBy: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: responseTimestamp,
});
const count = (graph: unknown, key: "nodes" | "edges") => {
  const items = (graph as Record<string, unknown> | null)?.[key];
  return Array.isArray(items) ? items.length : 0;
};

const versions = defineQuillsRoute({
  method: "get",
  path: "/automation/workflows/{workflowId}/versions",
  operationId: "listQuillsWorkflowVersions",
  summary: "List a workflow's versions",
  description:
    "Newest first; the newest 50 are kept. A publish is a version too.",
  action: "manage_settings",
  params: workflowParams,
  response: z.object({ versions: z.array(versionOut) }),
  responseDescription: "The versions",
  errors: { 404: "Workflow not found" },
  handler: async ({ db, params }) => {
    const row = await findWorkflow(db, params.workflowId);
    const rows = await db
      .select({
        id: workflowVersions.id,
        name: workflowVersions.name,
        triggerType: workflowVersions.triggerType,
        graph: workflowVersions.graph,
        createdBy: workflowVersions.createdBy,
        createdByName: principal.displayName,
        createdAt: workflowVersions.createdAt,
      })
      .from(workflowVersions)
      .leftJoin(principal, eq(principal.id, workflowVersions.createdBy))
      .where(eq(workflowVersions.workflowId, row.id))
      .orderBy(desc(workflowVersions.createdAt), desc(workflowVersions.id))
      .limit(50);
    return {
      versions: rows.map(({ graph, ...version }) => ({
        ...version,
        nodeCount: count(graph, "nodes"),
        edgeCount: count(graph, "edges"),
      })),
    };
  },
});

const restore = defineQuillsRoute({
  method: "post",
  path: "/automation/workflows/{workflowId}/versions/{versionId}/restore",
  operationId: "restoreQuillsWorkflowVersion",
  summary: "Restore a workflow version",
  description:
    "Copies the version's name, trigger and graph back and writes a new version by the caller. The status does not change.",
  action: "manage_settings",
  params: workflowParams.extend({
    versionId: flexibleToTypeIdSchema("workflow_version"),
  }),
  load: loadMembers,
  response: workflowOut,
  responseDescription: "The restored workflow",
  errors,
  event: ({ params }) => ({
    type: "workflow.version_restored",
    entityType: "workflow",
    entityId: params.workflowId,
    payload: { versionId: params.versionId },
  }),
  handler: async ({ db, actor, params, loaded }) => {
    const current = await findWorkflow(db, params.workflowId, true);
    const [version] = await db
      .select()
      .from(workflowVersions)
      .where(
        and(
          eq(workflowVersions.id, params.versionId),
          eq(workflowVersions.workflowId, current.id),
        ),
      );
    if (!version) throw notFound("Version");
    const trigger = triggerType.safeParse(version.triggerType);
    if (!trigger.success)
      throw conflict("The version's trigger is not available");
    const graph: WorkflowGraph = validGraph(version.graph);
    await checkReferences(db, loaded, graph);
    const [row] = await db
      .update(workflows)
      .set({
        name: version.name,
        triggerType: trigger.data,
        graph: graph as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(workflows.id, current.id))
      .returning();
    await writeVersion(db, row!, actor.principalId);
    return view(row!, actor.principalId);
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...reorder)
  .openapi(...list)
  .openapi(...get)
  .openapi(...create)
  .openapi(...update)
  .openapi(...remove)
  .openapi(...publish)
  .openapi(...pause)
  .openapi(...versions)
  .openapi(...restore);
