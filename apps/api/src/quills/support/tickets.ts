import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, pagingNumber, z, type BaseVariables } from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import { companies } from "../../database/quills/schema/companies";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { ticketTypes } from "../../database/quills/schema/ticket-types";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import { defineQuillsRoute } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import {
  attributesInput,
  validateFieldValues,
  type AttributeValue,
} from "./ticket-fields";
import {
  changeAssignment,
  changePriority,
  changeStatus,
  lockTickets,
} from "./ticket-lifecycle";
import { listTicketPage } from "./ticket-list";
import {
  CATEGORIES,
  findStatus,
  findTeammate,
  findTicket,
  notFound,
  PRIORITIES,
  recordActivity,
  STAGES,
  subscribe,
  TICKET_KINDS,
  ticketParams,
  ticketSchema,
  ticketView,
  ticketViews,
} from "./ticket-view";

const errors = {
  404: "Ticket, status, type, teammate, team, company or conversation not found",
  409: "The ticket cannot change this way",
};
const loadMembers = ({ workspaceId }: { workspaceId: string }) =>
  memberUserIds(workspaceId);
const me = z.literal("me");

const listTickets = defineQuillsRoute({
  method: "get",
  path: "/tickets",
  operationId: "listQuillsTickets",
  summary: "List support tickets",
  description:
    "Leaves out deleted tickets. `search` matches the title or the ticket number (`42` or `#42`). Keyset paging: pass the last ticket ID as `cursor`.",
  action: "read",
  query: z.object({
    type: z.enum(TICKET_KINDS).optional(),
    ticketTypeId: flexibleToTypeIdSchema("ticket_type").optional(),
    statusId: flexibleToTypeIdSchema("ticket_status").optional(),
    statusCategory: z.enum(CATEGORIES).optional(),
    stage: z.enum(STAGES).optional(),
    priority: z.enum(PRIORITIES).optional(),
    assignee: z
      .union([me, z.literal("unassigned"), flexibleToTypeIdSchema("principal")])
      .optional(),
    teamId: flexibleToTypeIdSchema("team").optional(),
    requesterPrincipalId: flexibleToTypeIdSchema("principal").optional(),
    companyId: flexibleToTypeIdSchema("company").optional(),
    search: z.string().trim().min(1).max(200).optional(),
    sort: z.enum(["recent", "oldest", "created", "priority"]).default("recent"),
    cursor: flexibleToTypeIdSchema("ticket").optional(),
    limit: pagingNumber(1, 100, 50),
  }),
  response: z.object({
    items: z.array(ticketSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of tickets",
  errors,
  handler: ({ db, actor, query }) => listTicketPage(db, actor, query),
});

const getTicket = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}",
  operationId: "getQuillsTicket",
  summary: "Get a support ticket",
  action: "read",
  params: ticketParams,
  response: ticketSchema,
  responseDescription: "The ticket",
  errors,
  handler: async ({ db, params }) =>
    ticketView(db, await findTicket(db, params.ticketId)),
});

const createTicket = defineQuillsRoute({
  method: "post",
  path: "/tickets",
  operationId: "createQuillsTicket",
  summary: "Open a support ticket",
  description:
    "The number comes from the workspace ticket sequence. With a registry type, the type decides the category and `customAttributes` must answer its form. Without an assignee, the ticket goes to the source conversation's assignee, else to the caller. A customer ticket for a requester and with no source conversation gets its own conversation, which shares the ticket thread.",
  action: "create",
  body: z.object({
    type: z.enum(TICKET_KINDS).optional(),
    ticketTypeId: flexibleToTypeIdSchema("ticket_type").optional(),
    title: z.string().trim().min(1).max(300),
    description: z.string().trim().max(4000).optional(),
    priority: z.enum(PRIORITIES).optional(),
    requesterPrincipalId: flexibleToTypeIdSchema("principal").optional(),
    assigneePrincipalId: flexibleToTypeIdSchema("principal").optional(),
    conversationId: flexibleToTypeIdSchema("conversation").optional(),
    companyId: flexibleToTypeIdSchema("company").optional(),
    customAttributes: attributesInput.optional(),
  }),
  response: ticketSchema,
  responseDescription: "The new ticket",
  errors,
  event: (_input, ticket) => ({
    type: "ticket.created",
    entityType: "ticket",
    entityId: ticket.id,
    payload: { number: String(ticket.number) },
  }),
  load: loadMembers,
  handler: async ({ db, actor, body, loaded: members }) => {
    const [status] = await db
      .select()
      .from(ticketStatuses)
      .where(
        and(
          eq(ticketStatuses.isDefault, true),
          isNull(ticketStatuses.deletedAt),
        ),
      )
      .limit(1);
    if (!status)
      throw new HTTPException(409, {
        message: "No default ticket status is configured",
      });
    let type = body.type ?? "customer";
    let customAttributes: Record<string, AttributeValue> =
      body.customAttributes ?? {};
    if (body.ticketTypeId) {
      const [registry] = await db
        .select()
        .from(ticketTypes)
        .where(
          and(
            eq(ticketTypes.id, body.ticketTypeId),
            isNull(ticketTypes.deletedAt),
          ),
        );
      if (!registry) throw notFound("Ticket type");
      if (body.type && body.type !== registry.category)
        throw new HTTPException(400, {
          message: `Ticket type '${registry.name}' belongs to category '${registry.category}'`,
        });
      type = registry.category;
      customAttributes = validateFieldValues(registry.fields, customAttributes);
    }
    let requesterCompanyId = null;
    if (body.requesterPrincipalId) {
      const [requester] = await db
        .select({ companyId: principal.companyId })
        .from(principal)
        .where(eq(principal.id, body.requesterPrincipalId));
      if (!requester) throw notFound("Requester");
      requesterCompanyId = requester.companyId;
    }
    if (body.companyId) {
      const [company] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, body.companyId));
      if (!company) throw notFound("Company");
    }
    let assignee = body.assigneePrincipalId
      ? (await findTeammate(db, members, body.assigneePrincipalId)).id
      : null;
    if (body.conversationId) {
      const [source] = await db
        .select({ assigned: conversations.assignedAgentPrincipalId })
        .from(conversations)
        .where(eq(conversations.id, body.conversationId));
      if (!source) throw notFound("Conversation");
      // A default never fails the create: a former teammate leaves the ticket unassigned.
      if (!assignee && source.assigned)
        assignee =
          (await findTeammate(db, members, source.assigned).catch(() => null))
            ?.id ?? null;
    }
    if (!assignee && members.includes(actor.userId))
      assignee = actor.principalId;
    const [ticket] = await db
      .insert(tickets)
      .values({
        type,
        ticketTypeId: body.ticketTypeId ?? null,
        title: body.title,
        statusId: status.id,
        priority: body.priority ?? "none",
        requesterPrincipalId: body.requesterPrincipalId ?? null,
        assigneePrincipalId: assignee,
        companyId: body.companyId ?? requesterCompanyId,
        customAttributes,
      })
      .returning();
    const row = ticket!;
    let conversationId = null;
    if (
      type === "customer" &&
      body.requesterPrincipalId &&
      !body.conversationId
    ) {
      const now = new Date();
      const [backing] = await db
        .insert(conversations)
        .values({
          visitorPrincipalId: body.requesterPrincipalId,
          channel: "messenger",
          source: "ticket_form",
          status: "open",
          subject: (body.description || body.title).slice(0, 140),
          waitingSince: now,
          visitorLastReadAt: now,
        })
        .returning({ id: conversations.id });
      conversationId = backing!.id;
      await db.insert(ticketConversations).values({
        ticketId: row.id,
        conversationId,
        ticketType: "customer",
        linkedByPrincipalId: actor.principalId,
      });
    }
    if (body.description) {
      await db.insert(conversationMessages).values({
        ...(conversationId ? { conversationId } : { ticketId: row.id }),
        principalId: actor.principalId,
        senderType: "agent",
        content: body.description,
      });
      if (conversationId)
        await db
          .update(conversations)
          .set({
            lastMessageAt: new Date(),
            lastMessagePreview: body.description.slice(0, 140),
          })
          .where(eq(conversations.id, conversationId));
    }
    const requester = body.requesterPrincipalId;
    if (requester) await subscribe(db, row.id, requester, "requester");
    if (assignee && assignee !== requester)
      await subscribe(db, row.id, assignee, "assignee");
    if (actor.principalId !== requester && actor.principalId !== assignee)
      await subscribe(db, row.id, actor.principalId, "manual");
    await recordActivity(db, row.id, actor.principalId, "ticket.created", {
      ticketType: type,
    });
    return ticketView(db, row);
  },
});

const setStatus = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/status",
  operationId: "setQuillsTicketStatus",
  summary: "Set a support ticket's status",
  description:
    "Entering a closed status stamps resolvedAt; leaving one clears it and counts a reopen. A tracker moves its open linked customer tickets in the same transaction.",
  action: "update",
  params: ticketParams,
  body: z.object({ statusId: flexibleToTypeIdSchema("ticket_status") }),
  response: ticketSchema,
  responseDescription: "The ticket",
  errors,
  event: ({ params, body }) => ({
    type: "ticket.status_changed",
    entityType: "ticket",
    entityId: params.ticketId,
    payload: { statusId: body.statusId },
  }),
  handler: async ({ db, actor, params, body }) => {
    // A tracker and the tickets it moves are locked together, in ID order.
    const locked = await lockTickets(db, [params.ticketId], true);
    const ticket = locked.find((row) => row.id === params.ticketId);
    if (!ticket) throw notFound("Ticket");
    const target = await findStatus(db, body.statusId);
    return ticketView(db, await changeStatus(db, actor, ticket, target));
  },
});

const setPriority = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/priority",
  operationId: "setQuillsTicketPriority",
  summary: "Set a support ticket's priority",
  action: "update",
  params: ticketParams,
  body: z.object({ priority: z.enum(PRIORITIES) }),
  response: ticketSchema,
  responseDescription: "The ticket",
  errors,
  event: ({ params, body }) => ({
    type: "ticket.priority_changed",
    entityType: "ticket",
    entityId: params.ticketId,
    payload: { priority: body.priority },
  }),
  handler: async ({ db, actor, params, body }) => {
    const ticket = await findTicket(db, params.ticketId, true);
    return ticketView(
      db,
      await changePriority(db, actor, ticket, body.priority),
    );
  },
});

const assignee = z
  .union([me, flexibleToTypeIdSchema("principal")])
  .nullable()
  .optional();
const assignTicket = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/assign",
  operationId: "assignQuillsTicket",
  summary: "Assign a support ticket to a teammate or a team",
  description:
    "A field that is not sent stays as it is; null clears it. `me` is the caller. The teammate must be a current member and the team must be live.",
  action: "update",
  params: ticketParams,
  body: z
    .object({
      assigneePrincipalId: assignee,
      assigneeTeamId: flexibleToTypeIdSchema("team").nullable().optional(),
    })
    .refine(
      (b) =>
        b.assigneePrincipalId !== undefined || b.assigneeTeamId !== undefined,
      "Send a teammate, a team or both",
    ),
  response: ticketSchema,
  responseDescription: "The ticket",
  errors,
  event: ({ params }, ticket) => ({
    type: "ticket.assigned",
    entityType: "ticket",
    entityId: params.ticketId,
    payload: {
      principalId: ticket.assignee.principalId ?? "",
      teamId: ticket.assignee.teamId ?? "",
    },
  }),
  load: loadMembers,
  handler: async ({ db, actor, params, body, loaded }) => {
    const ticket = await findTicket(db, params.ticketId, true);
    const principalId =
      body.assigneePrincipalId === "me"
        ? actor.principalId
        : body.assigneePrincipalId;
    return ticketView(
      db,
      await changeAssignment(db, actor, ticket, loaded, {
        principalId,
        teamId: body.assigneeTeamId,
      }),
    );
  },
});

const bulkAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assign"),
    assignTo: z.union([me, flexibleToTypeIdSchema("principal")]).nullable(),
  }),
  z.object({
    type: z.literal("assign_team"),
    teamId: flexibleToTypeIdSchema("team").nullable(),
  }),
  z.object({ type: z.literal("priority"), priority: z.enum(PRIORITIES) }),
  z.object({
    type: z.literal("set_status"),
    statusId: flexibleToTypeIdSchema("ticket_status"),
  }),
]);
const bulkUpdate = defineQuillsRoute({
  method: "post",
  path: "/tickets/bulk",
  operationId: "bulkUpdateQuillsTickets",
  summary: "Apply one action to several support tickets",
  description:
    "All or nothing: an unknown or deleted ticket, teammate, team or status changes no ticket.",
  action: "update",
  body: z.object({
    ticketIds: z
      .array(flexibleToTypeIdSchema("ticket"))
      .min(1)
      .max(100)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Each ID can appear only once",
      ),
    action: bulkAction,
  }),
  response: z.object({ items: z.array(ticketSchema) }),
  responseDescription: "The changed tickets",
  errors,
  event: ({ workspaceId, body }) => ({
    type: "ticket.bulk_updated",
    entityType: "workspace",
    entityId: workspaceId,
    payload: { action: body.action.type, count: String(body.ticketIds.length) },
  }),
  load: loadMembers,
  handler: async ({ db, actor, body, loaded }) => {
    const action = body.action;
    // One ID-ordered lock over the batch and, for a status move, every ticket its trackers move.
    const locked = await lockTickets(
      db,
      body.ticketIds,
      action.type === "set_status",
    );
    const batch = new Set<string>(body.ticketIds);
    if (locked.filter((row) => batch.has(row.id)).length !== batch.size)
      throw notFound("Ticket");
    const target =
      action.type === "set_status"
        ? await findStatus(db, action.statusId)
        : null;
    for (const row of locked) {
      if (!batch.has(row.id)) continue;
      // A tracker earlier in the batch may already have moved this ticket.
      const ticket = await findTicket(db, row.id);
      if (action.type === "assign")
        await changeAssignment(db, actor, ticket, loaded, {
          principalId:
            action.assignTo === "me" ? actor.principalId : action.assignTo,
        });
      else if (action.type === "assign_team")
        await changeAssignment(db, actor, ticket, loaded, {
          teamId: action.teamId,
        });
      else if (action.type === "priority")
        await changePriority(db, actor, ticket, action.priority);
      else await changeStatus(db, actor, ticket, target!);
    }
    const changed = await db
      .select()
      .from(tickets)
      .where(inArray(tickets.id, body.ticketIds));
    const order = new Map(body.ticketIds.map((ticketId, i) => [ticketId, i]));
    changed.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
    return { items: await ticketViews(db, changed) };
  },
});

/** Teammate routes for tickets: list, read, open, status, priority and assignment. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listTickets)
  .openapi(...bulkUpdate)
  .openapi(...createTicket)
  .openapi(...getTicket)
  .openapi(...setStatus)
  .openapi(...setPriority)
  .openapi(...assignTicket);
