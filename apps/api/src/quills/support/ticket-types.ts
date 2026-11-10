import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import { ticketTypes } from "../../database/quills/schema/ticket-types";
import { tickets } from "../../database/quills/schema/tickets";
import { hexColor } from "../feedback/schemas";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import { FIELD_TYPES, fieldsSchema } from "./ticket-fields";
import { uniqueSlug } from "./ticket-statuses";
import { TICKET_KINDS } from "./ticket-view";

const errors = {
  404: "Ticket type not found",
  409: "The change conflicts with the type's tickets, its category default or another slug",
};
const params = z.object({
  ticketTypeId: flexibleToTypeIdSchema("ticket_type"),
});
const typeSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  category: z.enum(TICKET_KINDS),
  icon: z.string().nullable(),
  color: z.string(),
  fields: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      type: z.enum(FIELD_TYPES),
      required: z.boolean(),
      visibleToCustomer: z.boolean(),
      order: z.number(),
      options: z.array(z.string()).optional(),
    }),
  ),
  isDefault: z.boolean(),
  position: z.number(),
  intakeVisible: z.boolean(),
  archived: z.boolean(),
  ticketCount: z.number(),
});
type Row = typeof ticketTypes.$inferSelect;
const slug = z
  .string()
  .trim()
  .max(50)
  .regex(
    /^[a-z0-9][a-z0-9_]*$/,
    "Use lowercase letters, digits and underscores",
  );
const editable = {
  name: z.string().trim().min(1).max(50),
  icon: z.string().trim().max(50).nullable(),
  color: hexColor,
  fields: fieldsSchema,
  intakeVisible: z.boolean(),
  position: z.number().int().min(0).max(10000),
};

const usage = async (db: Database, id: Row["id"]) =>
  (
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tickets)
      .where(and(eq(tickets.ticketTypeId, id), isNull(tickets.deletedAt)))
  )[0]!.n;
const view = async (db: Database, row: Row) => ({
  ...row,
  archived: row.deletedAt !== null,
  ticketCount: await usage(db, row.id),
});
/** One live default per category: the caller demotes the current one first. */
const demoteDefault = (db: Database, category: Row["category"]) =>
  db
    .update(ticketTypes)
    .set({ isDefault: false })
    .where(
      and(
        eq(ticketTypes.category, category),
        eq(ticketTypes.isDefault, true),
        isNull(ticketTypes.deletedAt),
      ),
    );
async function findType(db: Database, id: Row["id"], archived = false) {
  const [row] = await db
    .select()
    .from(ticketTypes)
    .where(
      and(
        eq(ticketTypes.id, id),
        archived
          ? isNotNull(ticketTypes.deletedAt)
          : isNull(ticketTypes.deletedAt),
      ),
    )
    .for("update");
  if (!row) throw new HTTPException(404, { message: "Ticket type not found" });
  return row;
}

const listTypes = defineQuillsRoute({
  method: "get",
  path: "/ticket-types",
  operationId: "listQuillsTicketTypes",
  summary: "List ticket types and their form fields",
  action: "read",
  query: z.object({
    includeArchived: z.enum(["true", "false"]).default("false"),
    category: z.enum(TICKET_KINDS).optional(),
  }),
  response: z.object({ items: z.array(typeSchema) }),
  responseDescription: "The ticket types",
  handler: async ({ db, query }) => {
    const rows = await db
      .select()
      .from(ticketTypes)
      .where(
        and(
          query.includeArchived === "true"
            ? undefined
            : isNull(ticketTypes.deletedAt),
          query.category && eq(ticketTypes.category, query.category),
        ),
      )
      .orderBy(
        sql`case ${ticketTypes.category} when 'customer' then 0 when 'back_office' then 1 else 2 end`,
        asc(ticketTypes.position),
        asc(ticketTypes.name),
      )
      // ponytail: a type registry is tens of rows; the cap only bounds a broken import.
      .limit(500);
    const counts = new Map(
      (
        await db
          .select({ id: tickets.ticketTypeId, n: sql<number>`count(*)::int` })
          .from(tickets)
          .where(
            and(isNotNull(tickets.ticketTypeId), isNull(tickets.deletedAt)),
          )
          .groupBy(tickets.ticketTypeId)
      ).map((r) => [r.id, r.n]),
    );
    return {
      items: rows.map((row) => ({
        ...row,
        archived: row.deletedAt !== null,
        ticketCount: counts.get(row.id) ?? 0,
      })),
    };
  },
});

const createType = defineQuillsRoute({
  method: "post",
  path: "/ticket-types",
  operationId: "createQuillsTicketType",
  summary: "Create a ticket type",
  description:
    "isDefault=true makes it its category's default and demotes the current one.",
  action: "manage_settings",
  body: z.object({
    name: editable.name,
    category: z.enum(TICKET_KINDS),
    slug: slug.optional(),
    icon: editable.icon.optional(),
    color: editable.color.optional(),
    fields: editable.fields.optional(),
    intakeVisible: z.boolean().optional(),
    isDefault: z.boolean().optional(),
  }),
  response: typeSchema,
  responseDescription: "The new ticket type",
  errors,
  event: (_input, type) => ({
    type: "ticket_type.created",
    entityType: "ticket_type",
    entityId: type.id,
  }),
  handler: async ({ db, body }) => {
    const { next } = (
      await db
        .select({
          next: sql<number>`coalesce(max(${ticketTypes.position}) + 1, 0)::int`,
        })
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.category, body.category),
            isNull(ticketTypes.deletedAt),
          ),
        )
    )[0]!;
    if (body.isDefault) await demoteDefault(db, body.category);
    const [row] = await db
      .insert(ticketTypes)
      .values({
        name: body.name,
        slug:
          body.slug ?? (await uniqueSlug(db, ticketTypes, body.name, "type")),
        category: body.category,
        icon: body.icon || null,
        color: body.color ?? "#6b7280",
        fields: body.fields ?? [],
        intakeVisible: body.intakeVisible ?? true,
        isDefault: body.isDefault ?? false,
        position: next,
      })
      .onConflictDoNothing()
      .returning();
    if (!row)
      throw new HTTPException(409, {
        message: "A ticket type with this slug already exists",
      });
    return view(db, row);
  },
});

const updateType = defineQuillsRoute({
  method: "patch",
  path: "/ticket-types/{ticketTypeId}",
  operationId: "updateQuillsTicketType",
  summary: "Update a ticket type",
  description:
    "The category can change only while no live ticket uses the type. A default cannot be unset; set another type as default instead.",
  action: "manage_settings",
  params,
  body: z
    .object({
      name: editable.name.optional(),
      slug: slug.optional(),
      icon: editable.icon.optional(),
      color: editable.color.optional(),
      fields: editable.fields.optional(),
      intakeVisible: editable.intakeVisible.optional(),
      position: editable.position.optional(),
      category: z.enum(TICKET_KINDS).optional(),
      isDefault: z.boolean().optional(),
    })
    .refine(
      (b) => Object.values(b).some((v) => v !== undefined),
      "Send at least one field",
    ),
  response: typeSchema,
  responseDescription: "The ticket type",
  errors,
  event: ({ params }) => ({
    type: "ticket_type.updated",
    entityType: "ticket_type",
    entityId: params.ticketTypeId,
  }),
  handler: async ({ db, params, body }) => {
    const existing = await findType(db, params.ticketTypeId);
    const category = body.category ?? existing.category;
    if (category !== existing.category && (await usage(db, existing.id)) > 0)
      throw new HTTPException(409, {
        message:
          "Tickets use this type. Archive it and create a new type instead.",
      });
    if (body.isDefault === false && existing.isDefault)
      throw new HTTPException(409, {
        message:
          "Cannot unset the category default. Set another type as default instead.",
      });
    if (existing.isDefault && category !== existing.category)
      throw new HTTPException(409, {
        message:
          "Set another default for this category before moving its default type.",
      });
    const promote = body.isDefault === true && !existing.isDefault;
    if (promote) await demoteDefault(db, category);
    const [row] = await db
      .update(ticketTypes)
      .set({
        name: body.name,
        slug: body.slug,
        icon: body.icon === undefined ? undefined : body.icon || null,
        color: body.color,
        fields: body.fields,
        intakeVisible: body.intakeVisible,
        position: body.position,
        category,
        ...(promote && { isDefault: true }),
      })
      .where(eq(ticketTypes.id, existing.id))
      .returning()
      .catch((error: { cause?: { code?: string }; code?: string }) => {
        if ((error.cause?.code ?? error.code) === "23505")
          throw new HTTPException(409, {
            message: "Another ticket type uses this slug",
          });
        throw error;
      });
    return view(db, row!);
  },
});

const archiveType = defineQuillsRoute({
  method: "post",
  path: "/ticket-types/{ticketTypeId}/archive",
  operationId: "archiveQuillsTicketType",
  summary: "Archive a ticket type",
  description:
    "Tickets keep the type. An archived type is not offered for new tickets.",
  action: "manage_settings",
  params,
  response: typeSchema,
  responseDescription: "The archived ticket type",
  errors,
  event: ({ params }) => ({
    type: "ticket_type.archived",
    entityType: "ticket_type",
    entityId: params.ticketTypeId,
  }),
  handler: async ({ db, params }) => {
    const existing = await findType(db, params.ticketTypeId);
    const [row] = await db
      .update(ticketTypes)
      .set({ deletedAt: new Date() })
      .where(eq(ticketTypes.id, existing.id))
      .returning();
    return view(db, row!);
  },
});

const restoreType = defineQuillsRoute({
  method: "post",
  path: "/ticket-types/{ticketTypeId}/restore",
  operationId: "restoreQuillsTicketType",
  summary: "Restore an archived ticket type",
  description:
    "It comes back as its category's default only when it was the default and the category has no live default now.",
  action: "manage_settings",
  params,
  response: typeSchema,
  responseDescription: "The restored ticket type",
  errors,
  event: ({ params }) => ({
    type: "ticket_type.restored",
    entityType: "ticket_type",
    entityId: params.ticketTypeId,
  }),
  handler: async ({ db, params }) => {
    const existing = await findType(db, params.ticketTypeId, true);
    const [liveDefault] = existing.isDefault
      ? await db
          .select({ id: ticketTypes.id })
          .from(ticketTypes)
          .where(
            and(
              eq(ticketTypes.category, existing.category),
              eq(ticketTypes.isDefault, true),
              isNull(ticketTypes.deletedAt),
            ),
          )
      : [];
    const [row] = await db
      .update(ticketTypes)
      .set({ deletedAt: null, isDefault: existing.isDefault && !liveDefault })
      .where(eq(ticketTypes.id, existing.id))
      .returning();
    return view(db, row!);
  },
});

/** Teammate routes for the ticket type registry and its intake forms. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listTypes)
  .openapi(...createType)
  .openapi(...updateType)
  .openapi(...archiveType)
  .openapi(...restoreType);
