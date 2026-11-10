import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { ticketTypes } from "../../database/quills/schema/ticket-types";
import { ticketStatuses } from "../../database/quills/schema/tickets";
import { hexColor } from "../feedback/schemas";
import { checkOrder, positionCase } from "../feedback/id-sets";
import { writeSettingsKey } from "../feedback/settings-json";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  CATEGORIES,
  DEFAULT_STAGE_LABELS,
  findStatus,
  notFound,
  STAGE_LABELS_KEY,
  STAGES,
  stageLabels,
  ticketsOnStatus,
} from "./ticket-view";

const errors = {
  404: "Ticket status not found",
  409: "The status is in use, the default, the last of its category, or a duplicate",
};
const statusParams = z.object({
  statusId: flexibleToTypeIdSchema("ticket_status"),
});
const statusSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  color: z.string(),
  category: z.enum(CATEGORIES),
  position: z.number(),
  isDefault: z.boolean(),
  publicStage: z.enum(STAGES).nullable(),
});
const columns = {
  id: ticketStatuses.id,
  name: ticketStatuses.name,
  slug: ticketStatuses.slug,
  color: ticketStatuses.color,
  category: ticketStatuses.category,
  position: ticketStatuses.position,
  isDefault: ticketStatuses.isDefault,
  publicStage: ticketStatuses.publicStage,
};
const live = isNull(ticketStatuses.deletedAt);
const categoryOrder = sql`case ${ticketStatuses.category} when 'open' then 0 when 'pending' then 1 else 2 end`;
const name = z.string().trim().min(1).max(50);

/** A slug from the name, with _2, _3 … when taken (archived rows included). */
export async function uniqueSlug(
  db: Database,
  table: typeof ticketStatuses | typeof ticketTypes,
  text: string,
  fallback: string,
) {
  const base =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 50) || fallback;
  const taken = new Set(
    (
      await db
        .select({ slug: table.slug })
        .from(table)
        .where(
          sql`${table.slug} = ${base} or ${table.slug} like ${`${base}\\_%`}`,
        )
    ).map((r) => r.slug),
  );
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}_${i}`;
  return slug;
}

const listStatuses = defineQuillsRoute({
  method: "get",
  path: "/ticket-statuses",
  operationId: "listQuillsTicketStatuses",
  summary: "List ticket statuses",
  description:
    "Live statuses, ordered open, pending, closed, then by position.",
  action: "read",
  response: z.object({ items: z.array(statusSchema) }),
  responseDescription: "The ticket statuses",
  handler: async ({ db }) => ({
    items: await db
      .select(columns)
      .from(ticketStatuses)
      .where(live)
      .orderBy(categoryOrder, asc(ticketStatuses.position))
      // ponytail: a status catalogue is tens of rows; the cap only bounds a broken import.
      .limit(500),
  }),
});

const createStatus = defineQuillsRoute({
  method: "post",
  path: "/ticket-statuses",
  operationId: "createQuillsTicketStatus",
  summary: "Create a ticket status",
  description:
    "The new status goes last. publicStage null hides it from requesters.",
  action: "manage_settings",
  body: z.object({
    name,
    color: hexColor,
    category: z.enum(CATEGORIES),
    publicStage: z.enum(STAGES).nullable().optional(),
  }),
  response: statusSchema,
  responseDescription: "The new status",
  errors,
  event: (_input, status) => ({
    type: "ticket_status.created",
    entityType: "ticket_status",
    entityId: status.id,
  }),
  handler: async ({ db, body }) => {
    const { next } = (
      await db
        .select({
          next: sql<number>`coalesce(max(${ticketStatuses.position}) + 1, 0)::int`,
        })
        .from(ticketStatuses)
        .where(live)
    )[0]!;
    const [row] = await db
      .insert(ticketStatuses)
      .values({
        name: body.name,
        slug: await uniqueSlug(db, ticketStatuses, body.name, "status"),
        color: body.color,
        category: body.category,
        position: next,
        publicStage: body.publicStage ?? null,
      })
      .onConflictDoNothing()
      .returning(columns);
    if (!row)
      throw new HTTPException(409, {
        message: `A status derived from '${body.name}' already exists`,
      });
    return row;
  },
});

const updateStatus = defineQuillsRoute({
  method: "patch",
  path: "/ticket-statuses/{statusId}",
  operationId: "updateQuillsTicketStatus",
  summary: "Update a ticket status",
  action: "manage_settings",
  params: statusParams,
  body: z
    .object({
      name: name.optional(),
      color: hexColor.optional(),
      category: z.enum(CATEGORIES).optional(),
      publicStage: z.enum(STAGES).nullable().optional(),
      position: z.number().int().min(0).max(10000).optional(),
    })
    .refine(
      (b) => Object.values(b).some((v) => v !== undefined),
      "Send at least one field",
    ),
  response: statusSchema,
  responseDescription: "The status",
  errors,
  event: ({ params }) => ({
    type: "ticket_status.updated",
    entityType: "ticket_status",
    entityId: params.statusId,
  }),
  handler: async ({ db, params, body }) => {
    await findStatus(db, params.statusId, "update");
    const [row] = await db
      .update(ticketStatuses)
      .set({
        name: body.name,
        color: body.color,
        category: body.category,
        publicStage: body.publicStage,
        position: body.position,
      })
      .where(and(eq(ticketStatuses.id, params.statusId), live))
      .returning(columns);
    if (!row) throw notFound("Ticket status");
    return row;
  },
});

const deleteStatus = defineQuillsRoute({
  method: "delete",
  path: "/ticket-statuses/{statusId}",
  operationId: "deleteQuillsTicketStatus",
  summary: "Delete a ticket status",
  description:
    "Soft delete. Refused (409) for the default status, the last status of a category, or a status that live tickets use.",
  action: "manage_settings",
  params: statusParams,
  response: z.object({ id: z.string() }),
  responseDescription: "The deleted status",
  errors,
  event: ({ params }) => ({
    type: "ticket_status.deleted",
    entityType: "ticket_status",
    entityId: params.statusId,
  }),
  handler: async ({ db, params }) => {
    const [found] = await db
      .select({ category: ticketStatuses.category })
      .from(ticketStatuses)
      .where(and(eq(ticketStatuses.id, params.statusId), live));
    if (!found) throw notFound("Ticket status");
    // Locks the category's live statuses in one statement before any check, so two deletes cannot
    // both pass the last-status check, and a ticket move (share lock) waits for this delete.
    const sameCategory = await db
      .select()
      .from(ticketStatuses)
      .where(and(eq(ticketStatuses.category, found.category), live))
      .orderBy(ticketStatuses.id)
      .for("update");
    const status = sameCategory.find((s) => s.id === params.statusId);
    if (!status) throw notFound("Ticket status");
    if (status.isDefault)
      throw new HTTPException(409, {
        message: "Cannot delete the default status",
      });
    if (sameCategory.length <= 1)
      throw new HTTPException(409, {
        message: `Cannot delete the last '${status.category}' status`,
      });
    const used = await ticketsOnStatus(db, status.id);
    if (used > 0)
      throw new HTTPException(409, {
        message: `${used} ticket(s) use this status. Move them first.`,
      });
    await db
      .update(ticketStatuses)
      .set({ deletedAt: new Date() })
      .where(eq(ticketStatuses.id, status.id));
    return { id: status.id };
  },
});

const reorderStatuses = defineQuillsRoute({
  method: "put",
  path: "/ticket-statuses/order",
  operationId: "reorderQuillsTicketStatuses",
  summary: "Reorder the ticket statuses",
  description:
    "Send every live status ID once, in the new order. A stale or partial list is 409.",
  action: "manage_settings",
  body: z.object({
    statusIds: z
      .array(flexibleToTypeIdSchema("ticket_status"))
      .min(1)
      .max(500)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Each ID can appear only once",
      ),
  }),
  response: z.object({ items: z.array(statusSchema) }),
  responseDescription: "The reordered statuses",
  errors,
  event: ({ workspaceId }) => ({
    type: "ticket_status.reordered",
    entityType: "workspace",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) => {
    const current = await db
      .select({ id: ticketStatuses.id })
      .from(ticketStatuses)
      .where(live)
      .for("update");
    checkOrder(
      body.statusIds,
      current.map((r) => r.id),
    );
    await db
      .update(ticketStatuses)
      .set({ position: positionCase(ticketStatuses.id, body.statusIds) })
      .where(inArray(ticketStatuses.id, body.statusIds));
    return {
      items: await db
        .select(columns)
        .from(ticketStatuses)
        .where(live)
        .orderBy(categoryOrder, asc(ticketStatuses.position)),
    };
  },
});

const labelsSchema = z.object(
  Object.fromEntries(STAGES.map((stage) => [stage, z.string()])) as Record<
    (typeof STAGES)[number],
    z.ZodString
  >,
);

const getLabels = defineQuillsRoute({
  method: "get",
  path: "/ticket-stage-labels",
  operationId: "getQuillsTicketStageLabels",
  summary: "Get the requester-facing ticket stage labels",
  action: "read",
  response: labelsSchema,
  responseDescription: "The stage labels",
  handler: async ({ db }) => stageLabels(db),
});

const setLabels = defineQuillsRoute({
  method: "put",
  path: "/ticket-stage-labels",
  operationId: "setQuillsTicketStageLabels",
  summary: "Set the requester-facing ticket stage labels",
  description: "A stage that is not sent goes back to its default label.",
  action: "manage_settings",
  body: z
    .object(
      Object.fromEntries(
        STAGES.map((stage) => [
          stage,
          z.string().trim().min(1).max(60).optional(),
        ]),
      ),
    )
    .refine(
      (b) => Object.values(b).some((v) => v !== undefined),
      "Send at least one label",
    ),
  response: labelsSchema,
  responseDescription: "The stage labels",
  event: ({ workspaceId }) => ({
    type: "settings.ticket_stage_labels_updated",
    entityType: "settings",
    entityId: workspaceId,
  }),
  handler: async ({ db, body }) => {
    const labels = { ...DEFAULT_STAGE_LABELS };
    for (const stage of STAGES) {
      const value = (body as Record<string, string | undefined>)[stage];
      if (value) labels[stage] = value;
    }
    return writeSettingsKey(db, "metadata", STAGE_LABELS_KEY, () => labels);
  },
});

/** Teammate routes for the ticket status catalogue and the requester-facing stage labels. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listStatuses)
  .openapi(...reorderStatuses)
  .openapi(...createStatus)
  .openapi(...updateStatus)
  .openapi(...deleteStatus)
  .openapi(...getLabels)
  .openapi(...setLabels);
