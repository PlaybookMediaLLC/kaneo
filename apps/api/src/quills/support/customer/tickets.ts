import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
  type SQL,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { createId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  responseTimestamp,
  z,
} from "../../../openapi";
import { principal } from "../../../database/quills/schema/auth";
import { conversations } from "../../../database/quills/schema/conversation";
import { ticketSubscriptions } from "../../../database/quills/schema/ticket-subscriptions";
import { ticketTypes } from "../../../database/quills/schema/ticket-types";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../../database/quills/schema/tickets";
import { defineQuillsRoute, type Database } from "../../framework/define-route";
import { attributesInput, validateFieldValues } from "../ticket-fields";
import {
  recordActivity,
  STAGES,
  stageLabels,
  subscribe,
  ticketParams,
} from "../ticket-view";
import {
  conflict,
  conversationParams,
  insertVisitorMessage,
  notFound,
  ownConversation,
  requireSurface,
  type Customer,
  type PrincipalId,
} from "./model";

// The requester's own customer tickets, for the widget (`/widget/...`) and the portal
// (`/support/...`). Internal status names never reach a requester: a status without a public
// stage shows no stage. Replies ride the ticket's paired conversation (conversations.ts).

const errors = {
  404: "Ticket, conversation, ticket type or tickets surface not found",
};
const myTicket = z.object({
  id: z.string(),
  number: z.number(),
  reference: z.string(),
  title: z.string(),
  stage: z.enum(STAGES).nullable(),
  stageLabel: z.string().nullable(),
  ticketType: z.object({ name: z.string() }).nullable(),
  /** The paired conversation that carries the ticket's thread. */
  conversationId: z.string().nullable(),
  createdAt: responseTimestamp,
  updatedAt: nullableResponseTimestamp,
  resolvedAt: nullableResponseTimestamp,
});
const watchStatus = z.object({
  watching: z.boolean(),
  mutedUntil: nullableResponseTimestamp,
});

/** The caller's live customer tickets. */
const mine = (me: PrincipalId) =>
  and(
    eq(tickets.requesterPrincipalId, me),
    eq(tickets.type, "customer"),
    isNull(tickets.deletedAt),
  )!;

/** Requester summaries of the caller's tickets that match `where`, newest first. */
async function summaries(
  db: Database,
  me: PrincipalId,
  where: SQL | undefined,
  limit = 50,
) {
  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      title: tickets.title,
      stage: ticketStatuses.publicStage,
      typeName: ticketTypes.name,
      conversationId: ticketConversations.conversationId,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
      resolvedAt: tickets.resolvedAt,
    })
    .from(tickets)
    .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
    .leftJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    .leftJoin(
      ticketConversations,
      and(
        eq(ticketConversations.ticketId, tickets.id),
        eq(ticketConversations.ticketType, "customer"),
      ),
    )
    .where(and(mine(me), where))
    .orderBy(desc(tickets.createdAt), desc(tickets.id))
    .limit(limit);
  const labels = rows.length ? await stageLabels(db) : null;
  return rows.map(({ stage, typeName, ...row }) => ({
    ...row,
    reference: `#${row.number}`,
    stage,
    stageLabel: stage ? labels![stage] : null,
    ticketType: typeName ? { name: typeName } : null,
  }));
}

/** The caller's own live customer ticket, or 404. */
async function ownTicket(
  db: Database,
  me: PrincipalId | null,
  id: (typeof tickets.$inferSelect)["id"],
) {
  if (!me) throw notFound("Ticket");
  const [row] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, id), mine(me)))
    .limit(1);
  if (!row) throw notFound("Ticket");
  return row;
}

async function watchOf(
  db: Database,
  me: PrincipalId,
  ticketId: (typeof tickets.$inferSelect)["id"],
) {
  const [row] = await db
    .select({ mutedUntil: ticketSubscriptions.mutedUntil })
    .from(ticketSubscriptions)
    .where(
      and(
        eq(ticketSubscriptions.ticketId, ticketId),
        eq(ticketSubscriptions.principalId, me),
      ),
    );
  return { watching: Boolean(row), mutedUntil: row?.mutedUntil ?? null };
}

/** Live intake types a requester may file: customer category, shown on the intake form. */
const intakeTypes = (
  db: Database,
  id?: (typeof ticketTypes.$inferSelect)["id"],
) =>
  db
    .select()
    .from(ticketTypes)
    .where(
      and(
        isNull(ticketTypes.deletedAt),
        eq(ticketTypes.category, "customer"),
        eq(ticketTypes.intakeVisible, true),
        id ? eq(ticketTypes.id, id) : undefined,
      ),
    )
    .orderBy(asc(ticketTypes.position), asc(ticketTypes.id));

const customerFields = (type: typeof ticketTypes.$inferSelect) =>
  type.fields
    .filter((field) => field.visibleToCustomer)
    .sort((a, b) => a.order - b.order);

/** Builds the requester ticket routes of one customer audience. */
export function ticketRoutes(audience: Customer) {
  const widget = audience === "widget";
  const base = widget ? "/widget" : "/support";
  const name = (forWidget: string, forPortal: string) =>
    widget ? forWidget : forPortal;
  const who = widget ? "the widget visitor" : "the signed-in customer";
  const writer = widget ? {} : { ensureCustomer: true };

  const list = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/tickets`,
    operationId: name("getQuillsWidgetMyTickets", "getQuillsMyTickets"),
    summary: `List the tickets of ${who}`,
    description:
      "Newest first. `cursor` is the last ticket of the previous page. The stage is the status's public stage; a status without one shows no stage.",
    action: "read",
    query: z.object({
      cursor: flexibleToTypeIdSchema("ticket").optional(),
      limit: pagingNumber(1, 50, 20),
    }),
    response: z.object({
      items: z.array(myTicket),
      nextCursor: z.string().nullable(),
    }),
    responseDescription: "One page of the caller's tickets",
    errors,
    handler: async ({ db, caller, query }) => {
      await requireSurface(db, audience, caller, "tickets");
      const me = caller.principalId;
      if (!me) return { items: [], nextCursor: null };
      if (query.cursor) await ownTicket(db, me, query.cursor);
      const keys = sql`${tickets.createdAt}, ${tickets.id}`;
      const items = await summaries(
        db,
        me,
        query.cursor
          ? sql`(${keys}) < (select ${keys} from ${tickets} where ${eq(tickets.id, query.cursor)})`
          : undefined,
        query.limit + 1,
      );
      const page = items.slice(0, query.limit);
      return {
        items: page,
        nextCursor: items.length > query.limit ? page.at(-1)!.id : null,
      };
    },
  });

  const form = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/ticket-form`,
    operationId: name("getQuillsWidgetMyTicketForm", "getQuillsMyTicketForm"),
    summary: `Get the ticket types and fields ${who} can file`,
    description:
      "Live customer types shown on the intake form, with only their customer-visible fields.",
    action: "read",
    response: z.object({
      types: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
          isDefault: z.boolean(),
          fields: z.array(
            z.object({
              key: z.string(),
              label: z.string(),
              type: z.string(),
              required: z.boolean(),
              options: z.array(z.string()),
            }),
          ),
        }),
      ),
    }),
    responseDescription: "The intake form",
    errors,
    handler: async ({ db, caller }) => {
      await requireSurface(db, audience, caller, "tickets");
      return {
        types: (await intakeTypes(db)).map((type) => ({
          id: type.id,
          name: type.name,
          slug: type.slug,
          isDefault: type.isDefault,
          fields: customerFields(type).map((field) => ({
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required,
            options: field.options ?? [],
          })),
        })),
      };
    },
  });

  const create = defineQuillsRoute({
    audience,
    ...writer,
    method: "post",
    path: `${base}/tickets`,
    operationId: name("createQuillsWidgetMyTicket", "createQuillsMyTicket"),
    summary: `Open a ticket as ${who}`,
    description:
      "The caller is the requester. Without ticketTypeId the default intake type applies, if any. fieldValues answer only the type's customer-visible fields. The ticket gets its own conversation, which carries its thread; the description is the first message. An anonymous visitor needs a contact email first.",
    action: "create",
    rateLimit: { limit: 10, windowSeconds: 600 },
    body: z.object({
      title: z.string().trim().min(1).max(300),
      description: z.string().trim().max(4000).optional(),
      ticketTypeId: flexibleToTypeIdSchema("ticket_type").optional(),
      fieldValues: attributesInput.optional(),
    }),
    response: myTicket,
    responseDescription: "The new ticket",
    errors: { ...errors, 409: "No default ticket status, or no contact email" },
    event: (_input, ticket) => ({
      type: "ticket.created",
      entityType: "ticket",
      entityId: ticket.id,
      payload: { number: String(ticket.number) },
    }),
    handler: async ({ db, caller, body }) => {
      await requireSurface(db, audience, caller, "tickets");
      const me = caller.principalId!;
      const [person] = await db
        .select({
          type: principal.type,
          contactEmail: principal.contactEmail,
          companyId: principal.companyId,
        })
        .from(principal)
        .where(eq(principal.id, me));
      if (person?.type === "anonymous" && !person.contactEmail)
        throw conflict("Add a contact email before opening a ticket");
      const [status] = await db
        .select({ id: ticketStatuses.id })
        .from(ticketStatuses)
        .where(
          and(
            eq(ticketStatuses.isDefault, true),
            isNull(ticketStatuses.deletedAt),
          ),
        )
        .limit(1);
      if (!status) throw conflict("No default ticket status is configured");
      const types = await intakeTypes(db, body.ticketTypeId);
      const type = body.ticketTypeId
        ? types[0]
        : types.find((candidate) => candidate.isDefault);
      if (body.ticketTypeId && !type) throw notFound("Ticket type");
      const customAttributes = type
        ? validateFieldValues(customerFields(type), body.fieldValues ?? {})
        : {};
      if (!type && body.fieldValues && Object.keys(body.fieldValues).length)
        throw new HTTPException(400, {
          message: "fieldValues need a ticket type with a form",
        });
      const [ticket] = await db
        .insert(tickets)
        .values({
          type: "customer",
          ticketTypeId: type?.id ?? null,
          title: body.title,
          statusId: status.id,
          priority: "none",
          requesterPrincipalId: me,
          companyId: person?.companyId ?? null,
          customAttributes,
        })
        .returning({ id: tickets.id });
      const now = new Date();
      const [pair] = await db
        .insert(conversations)
        .values({
          visitorPrincipalId: me,
          channel: "messenger",
          source: "ticket_form",
          status: "open",
          subject: (body.description || body.title).slice(0, 140),
          waitingSince: now,
          visitorLastReadAt: now,
        })
        .returning();
      await db.insert(ticketConversations).values({
        ticketId: ticket!.id,
        conversationId: pair!.id,
        ticketType: "customer",
        linkedByPrincipalId: me,
      });
      if (body.description)
        await insertVisitorMessage(
          db,
          me,
          pair!,
          createId("conversation_message"),
          body.description,
        );
      await subscribe(db, ticket!.id, me, "requester");
      await recordActivity(db, ticket!.id, me, "ticket.created", {
        ticketType: "customer",
      });
      return (await summaries(db, me, eq(tickets.id, ticket!.id)))[0]!;
    },
  });

  const labels = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/ticket-stage-labels`,
    operationId: name(
      "getQuillsWidgetMyTicketStageLabels",
      "getQuillsMyTicketStageLabels",
    ),
    summary: "Get the requester-facing ticket stage labels",
    description:
      "The workspace's saved labels over the defaults, for the stage tracker.",
    action: "read",
    response: z.object(
      Object.fromEntries(STAGES.map((stage) => [stage, z.string()])) as {
        [K in (typeof STAGES)[number]]: z.ZodString;
      },
    ),
    responseDescription: "The stage labels",
    errors,
    handler: async ({ db, caller }) => {
      await requireSurface(db, audience, caller, "tickets");
      return stageLabels(db);
    },
  });

  const watchGet = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/tickets/{ticketId}/watch`,
    operationId: name(
      "getQuillsWidgetMyTicketWatchStatus",
      "getQuillsMyTicketWatchStatus",
    ),
    summary: `Get whether ${who} watches a ticket`,
    action: "read",
    params: ticketParams,
    response: watchStatus,
    responseDescription: "The caller's watch state",
    errors,
    handler: async ({ db, caller, params }) => {
      await requireSurface(db, audience, caller, "tickets");
      const ticket = await ownTicket(db, caller.principalId, params.ticketId);
      return watchOf(db, caller.principalId!, ticket.id);
    },
  });

  const watch = (on: boolean) =>
    defineQuillsRoute({
      audience,
      ...writer,
      method: on ? "put" : "delete",
      path: `${base}/tickets/{ticketId}/watch`,
      operationId: on
        ? name("watchQuillsWidgetMyTicket", "watchQuillsMyTicket")
        : name("unwatchQuillsWidgetMyTicket", "unwatchQuillsMyTicket"),
      summary: on
        ? `Watch a ticket of ${who}`
        : `Stop watching a ticket of ${who}`,
      description: on
        ? "Idempotent. An existing subscription keeps its reason and mute."
        : "Idempotent.",
      action: "update",
      params: ticketParams,
      response: watchStatus,
      responseDescription: "The caller's watch state",
      errors,
      event: { none: "A watch is the requester's own preference" },
      handler: async ({ db, caller, params }) => {
        await requireSurface(db, audience, caller, "tickets");
        const me = caller.principalId!;
        const ticket = await ownTicket(db, me, params.ticketId);
        if (on) await subscribe(db, ticket.id, me, "manual");
        else
          await db
            .delete(ticketSubscriptions)
            .where(
              and(
                eq(ticketSubscriptions.ticketId, ticket.id),
                eq(ticketSubscriptions.principalId, me),
              ),
            );
        return watchOf(db, me, ticket.id);
      },
    });

  const linked = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/conversations/{conversationId}/ticket`,
    operationId: name(
      "getQuillsWidgetConversationLinkedTicket",
      "getQuillsConversationLinkedTicket",
    ),
    summary: `Get the ticket paired with a conversation of ${who}`,
    description: "Null when the conversation has no ticket of the caller.",
    action: "read",
    params: conversationParams,
    response: z.object({ ticket: myTicket.nullable() }),
    responseDescription: "The paired ticket, or null",
    errors,
    handler: async ({ db, caller, params }) => {
      await requireSurface(db, audience, caller, "tickets");
      const me = caller.principalId;
      const conversation = await ownConversation(db, me, params.conversationId);
      const pairs = await db
        .select({ ticketId: ticketConversations.ticketId })
        .from(ticketConversations)
        .where(
          and(
            eq(ticketConversations.conversationId, conversation.id),
            eq(ticketConversations.ticketType, "customer"),
          ),
        );
      const [ticket] = pairs.length
        ? await summaries(
            db,
            me!,
            inArray(
              tickets.id,
              pairs.map((pair) => pair.ticketId),
            ),
          )
        : [];
      return { ticket: ticket ?? null };
    },
  });

  return apiRouter()
    .openapi(...list)
    .openapi(...create)
    .openapi(...form)
    .openapi(...labels)
    .openapi(...watchGet)
    .openapi(...watch(true))
    .openapi(...watch(false))
    .openapi(...linked);
}
