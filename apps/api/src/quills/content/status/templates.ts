import { asc, eq, inArray, sql } from "drizzle-orm";
import type { StatusComponentId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../../openapi";
import {
  statusIncidentTemplates,
  statusIncidentUpdates,
} from "../../../database/quills/schema/status";
import { defineQuillsRoute } from "../../framework/define-route";
import { idList, page, pageQuery, someField } from "../../feedback/schemas";
import { impact, liveComponentIds, notFound, type Db } from "./shared";

const template = z
  .object({
    id: z.string(),
    name: z.string(),
    title: z.string(),
    body: z.string(),
    impact,
    componentIds: z.array(z.string()).openapi({
      description: "Live components only: a deleted one is left out",
    }),
    usageCount: z.number(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("QuillsStatusTemplate");
const columns = {
  id: statusIncidentTemplates.id,
  name: statusIncidentTemplates.name,
  title: statusIncidentTemplates.title,
  body: statusIncidentTemplates.body,
  impact: statusIncidentTemplates.impact,
  componentIds: statusIncidentTemplates.componentIds,
  createdAt: statusIncidentTemplates.createdAt,
  updatedAt: statusIncidentTemplates.updatedAt,
};
type Row = Pick<
  typeof statusIncidentTemplates.$inferSelect,
  keyof typeof columns
>;
const params = z.object({ templateId: flexibleToTypeIdSchema("status_tmpl") });
const fields = {
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(10000),
  impact: impact.optional(),
  componentIds: idList("status_component").optional(),
};
const event =
  (
    type:
      | "status.template_created"
      | "status.template_updated"
      | "status.template_deleted",
  ) =>
  (_input: unknown, result: { id: string }) => ({
    type,
    entityType: "status_template" as const,
    entityId: result.id,
  });

/** Usage counts derive from the updates that cite the template, so they cannot drift. */
async function withUsage(db: Db, rows: Row[]) {
  const ids = rows.map((row) => row.id);
  const usage = ids.length
    ? await db
        .select({
          templateId: statusIncidentUpdates.templateId,
          n: sql<number>`count(*)::int`,
        })
        .from(statusIncidentUpdates)
        .where(inArray(statusIncidentUpdates.templateId, ids))
        .groupBy(statusIncidentUpdates.templateId)
    : [];
  const live = await liveComponentIds(
    db,
    rows.flatMap((row) => row.componentIds),
  );
  return rows.map((row) => ({
    ...row,
    componentIds: row.componentIds.filter((id) => live.has(id)),
    usageCount: usage.find((u) => u.templateId === row.id)?.n ?? 0,
  }));
}

/** Every component exists and is live in this workspace. */
async function requireComponents(db: Db, ids: StatusComponentId[] | undefined) {
  if (!ids?.length) return;
  const live = await liveComponentIds(db, ids);
  if (ids.some((id) => !live.has(id))) throw notFound("Component");
}

const listTemplates = defineQuillsRoute({
  method: "get",
  path: "/status/templates",
  operationId: "listQuillsStatusTemplates",
  summary: "List incident templates",
  action: "read",
  query: z.object(pageQuery),
  response: z.object({
    templates: z.array(template),
    nextOffset: z.number().nullable(),
  }),
  responseDescription: "Templates by name",
  handler: async ({ db, query }) => {
    const { items, nextOffset } = page(
      await db
        .select(columns)
        .from(statusIncidentTemplates)
        .orderBy(
          asc(statusIncidentTemplates.name),
          asc(statusIncidentTemplates.id),
        )
        .offset(query.offset)
        .limit(query.limit + 1),
      query,
    );
    return { templates: await withUsage(db, items), nextOffset };
  },
});

const createTemplate = defineQuillsRoute({
  method: "post",
  path: "/status/templates",
  operationId: "createQuillsStatusTemplate",
  summary: "Create an incident template",
  action: "manage_settings",
  body: z.object(fields),
  response: template,
  responseDescription: "The created template",
  errors: { 404: "Component not found" },
  event: event("status.template_created"),
  handler: async ({ db, body }) => {
    await requireComponents(db, body.componentIds);
    const [row] = await db
      .insert(statusIncidentTemplates)
      .values({
        name: body.name,
        title: body.title,
        body: body.body,
        impact: body.impact ?? "minor",
        componentIds: body.componentIds ?? [],
      })
      .returning(columns);
    return (await withUsage(db, [row!]))[0]!;
  },
});

const updateTemplate = defineQuillsRoute({
  method: "patch",
  path: "/status/templates/{templateId}",
  operationId: "updateQuillsStatusTemplate",
  summary: "Update an incident template",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: fields.name.optional(),
      title: fields.title.optional(),
      body: fields.body.optional(),
      impact: fields.impact,
      componentIds: fields.componentIds,
    })
    .refine(someField, "Change at least one field"),
  response: template,
  responseDescription: "The updated template",
  errors: { 404: "Template or component not found" },
  event: event("status.template_updated"),
  handler: async ({ db, params, body }) => {
    await requireComponents(db, body.componentIds);
    const [row] = await db
      .update(statusIncidentTemplates)
      .set({
        name: body.name,
        title: body.title,
        body: body.body,
        impact: body.impact,
        componentIds: body.componentIds,
        updatedAt: new Date(),
      })
      .where(eq(statusIncidentTemplates.id, params.templateId))
      .returning(columns);
    if (!row) throw notFound("Template");
    return (await withUsage(db, [row]))[0]!;
  },
});

const deleteTemplate = defineQuillsRoute({
  method: "delete",
  path: "/status/templates/{templateId}",
  operationId: "deleteQuillsStatusTemplate",
  summary: "Delete an incident template",
  description: "Updates that used it keep their text and lose the link.",
  action: "manage_settings",
  params,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted template",
  errors: { 404: "Template not found" },
  event: event("status.template_deleted"),
  handler: async ({ db, params }) => {
    const [row] = await db
      .delete(statusIncidentTemplates)
      .where(eq(statusIncidentTemplates.id, params.templateId))
      .returning({ id: statusIncidentTemplates.id });
    if (!row) throw notFound("Template");
    return row;
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listTemplates)
  .openapi(...createTemplate)
  .openapi(...updateTemplate)
  .openapi(...deleteTemplate);
