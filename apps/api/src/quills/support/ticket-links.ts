import { and, asc, eq, isNull, ne, sql, type SQLWrapper } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import {
  ticketConversations,
  ticketLinks,
  tickets,
} from "../../database/quills/schema/tickets";
import { defineQuillsRoute } from "../framework/define-route";
import {
  findTicket,
  notFound,
  pairConversationId,
  systemMessage,
  ticketParams,
  ticketSchema,
  ticketViews,
} from "./ticket-view";
import { lockTickets } from "./ticket-lifecycle";

const errors = {
  404: "Ticket or conversation not found",
  409: "The link is not allowed or already exists",
};
const changed = z.object({ changed: z.boolean() });
const trackerParams = ticketParams.extend({
  trackerTicketId: flexibleToTypeIdSchema("ticket"),
});
const tracked = eq(ticketLinks.relation, "tracks");

const getLinks = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/links",
  operationId: "getQuillsTicketLinks",
  summary: "Get a support ticket's tracker links",
  description:
    "A tracker lists the customer tickets it tracks; any other ticket names its tracker.",
  action: "read",
  params: ticketParams,
  response: z.object({
    tracker: ticketSchema.nullable(),
    linked: z.array(ticketSchema),
  }),
  responseDescription: "The tracker links",
  errors,
  handler: async ({ db, params }) => {
    const ticket = await findTicket(db, params.ticketId);
    if (ticket.type === "tracker") {
      const rows = await db
        .select()
        .from(tickets)
        .innerJoin(ticketLinks, eq(ticketLinks.linkedTicketId, tickets.id))
        .where(
          and(
            eq(ticketLinks.trackerTicketId, ticket.id),
            tracked,
            isNull(tickets.deletedAt),
          ),
        )
        .orderBy(asc(tickets.number))
        // ponytail: one tracker's links in one response; page it past a few hundred.
        .limit(500);
      return {
        tracker: null,
        linked: await ticketViews(
          db,
          rows.map((r) => r.tickets),
        ),
      };
    }
    const [row] = await db
      .select()
      .from(tickets)
      .innerJoin(ticketLinks, eq(ticketLinks.trackerTicketId, tickets.id))
      .where(
        and(
          eq(ticketLinks.linkedTicketId, ticket.id),
          tracked,
          isNull(tickets.deletedAt),
        ),
      );
    return {
      tracker: row ? ((await ticketViews(db, [row.tickets]))[0] ?? null) : null,
      linked: [],
    };
  },
});

const link = defineQuillsRoute({
  method: "put",
  path: "/tickets/{ticketId}/tracker/{trackerTicketId}",
  operationId: "linkQuillsTicketToTracker",
  summary: "Track a customer ticket under a tracker",
  description:
    "A customer ticket has at most one tracker. Linking it again to the same tracker changes nothing.",
  action: "update",
  params: trackerParams,
  response: changed,
  responseDescription: "Whether a link was added",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "ticket.tracker_linked",
      entityType: "ticket",
      entityId: params.ticketId,
      payload: { trackerTicketId: params.trackerTicketId },
    },
  handler: async ({ db, actor, params }) => {
    if (params.ticketId === params.trackerTicketId)
      throw new HTTPException(409, { message: "A ticket cannot track itself" });
    // Both tickets in one ID-ordered lock, like every other path that locks a tracker and its tickets.
    const locked = await lockTickets(db, [
      params.ticketId,
      params.trackerTicketId,
    ]);
    const linked = locked.find((t) => t.id === params.ticketId);
    const tracker = locked.find((t) => t.id === params.trackerTicketId);
    if (!linked || !tracker) throw notFound("Ticket");
    if (tracker.type !== "tracker" || linked.type !== "customer")
      throw new HTTPException(409, {
        message:
          "Only a tracker can track, and only customer tickets can be tracked",
      });
    const [existing] = await db
      .select({ trackerTicketId: ticketLinks.trackerTicketId })
      .from(ticketLinks)
      .where(and(eq(ticketLinks.linkedTicketId, linked.id), tracked));
    if (existing?.trackerTicketId === tracker.id) return { changed: false };
    if (existing)
      throw new HTTPException(409, {
        message: "This ticket is already tracked by another tracker",
      });
    await db.insert(ticketLinks).values({
      trackerTicketId: tracker.id,
      linkedTicketId: linked.id,
      relation: "tracks",
      linkedByPrincipalId: actor.principalId,
    });
    await systemMessage(
      db,
      linked.id,
      `Linked to tracker #${tracker.number}`,
      { kind: "ticket_linked", trackerReference: `#${tracker.number}` },
      true,
    );
    return { changed: true };
  },
});

const unlink = defineQuillsRoute({
  method: "delete",
  path: "/tickets/{ticketId}/tracker/{trackerTicketId}",
  operationId: "unlinkQuillsTicketFromTracker",
  summary: "Stop tracking a customer ticket under a tracker",
  action: "update",
  params: trackerParams,
  response: changed,
  responseDescription: "Whether a link was removed",
  errors,
  event: ({ params }, result) =>
    result.changed && {
      type: "ticket.tracker_unlinked",
      entityType: "ticket",
      entityId: params.ticketId,
      payload: { trackerTicketId: params.trackerTicketId },
    },
  handler: async ({ db, params }) => {
    await findTicket(db, params.ticketId);
    await findTicket(db, params.trackerTicketId);
    const rows = await db
      .delete(ticketLinks)
      .where(
        and(
          eq(ticketLinks.trackerTicketId, params.trackerTicketId),
          eq(ticketLinks.linkedTicketId, params.ticketId),
        ),
      )
      .returning({ id: ticketLinks.linkedTicketId });
    return { changed: rows.length > 0 };
  },
});

const linkConversation = defineQuillsRoute({
  method: "put",
  path: "/tickets/{ticketId}/conversations/{conversationId}",
  operationId: "linkQuillsTicketToConversation",
  summary: "Link a support ticket to the conversation it was opened from",
  description:
    "A customer ticket becomes the conversation's pair and shares its thread (one each way). Any other ticket records the conversation as its origin. Test and real records cannot be linked.",
  action: "create",
  params: ticketParams.extend({
    conversationId: flexibleToTypeIdSchema("conversation"),
  }),
  response: changed,
  responseDescription: "Whether the link was added",
  errors,
  event: ({ params }) => ({
    type: "ticket.conversation_linked",
    entityType: "ticket",
    entityId: params.ticketId,
    payload: { conversationId: params.conversationId },
  }),
  handler: async ({ db, actor, params }) => {
    const ticket = await findTicket(db, params.ticketId, true);
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, params.conversationId))
      .for("update");
    if (!conversation) throw notFound("Conversation");
    // A record is test data when a test customer owns it (database/quills/test-data.ts).
    const testOwner = (id: SQLWrapper) =>
      sql<boolean>`exists (select 1 from quills."principal" o where o.id = ${id} and o.test_owner_principal_id is not null)`;
    const [kind] = await db
      .select({
        testTicket: sql<boolean>`${testOwner(tickets.requesterPrincipalId)} or exists (
          select 1 from quills."ticket_conversations" l
          join quills."conversations" c on c.id = l.conversation_id and c.workspace_id = l.workspace_id
          join quills."principal" o on o.id = c.visitor_principal_id and o.workspace_id = c.workspace_id
          where l.ticket_id = ${tickets.id} and o.test_owner_principal_id is not null)`,
        testConversation: testOwner(conversations.visitorPrincipalId),
      })
      .from(tickets)
      .innerJoin(conversations, eq(conversations.id, conversation.id))
      .where(eq(tickets.id, ticket.id));
    if (kind?.testTicket !== kind?.testConversation)
      throw new HTTPException(409, {
        message: "Test and real conversations need separate tickets.",
      });
    // Any unique link rule (the same pair, one customer ticket per conversation and back) is a conflict.
    const rows = await db
      .insert(ticketConversations)
      .values({
        ticketId: ticket.id,
        conversationId: conversation.id,
        ticketType: ticket.type,
        linkedByPrincipalId: actor.principalId,
      })
      .onConflictDoNothing()
      .returning({ id: ticketConversations.ticketId });
    if (!rows.length)
      throw new HTTPException(409, {
        message: "This ticket or conversation is already linked",
      });
    const pair = ticket.type === "customer";
    if (pair && !ticket.firstResponseAt) {
      const [first] = await db
        .select({ at: conversationMessages.createdAt })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversation.id),
            eq(conversationMessages.senderType, "agent"),
            eq(conversationMessages.isInternal, false),
            isNull(conversationMessages.deletedAt),
          ),
        )
        .orderBy(
          asc(conversationMessages.createdAt),
          asc(conversationMessages.id),
        )
        .limit(1);
      if (first)
        await db
          .update(tickets)
          .set({ firstResponseAt: first.at })
          .where(eq(tickets.id, ticket.id));
    }
    const reference = `#${ticket.number}`;
    await db.insert(conversationMessages).values({
      conversationId: conversation.id,
      principalId: null,
      senderType: "system",
      isInternal: !pair,
      content: pair
        ? `Ticket ${reference} created from this conversation`
        : `Internal ticket ${reference} opened from this conversation`,
      metadata: {
        systemEvent: { kind: "ticket_created", ticketReference: reference },
      },
    });
    return { changed: true };
  },
});

const listConversations = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/conversations",
  operationId: "listQuillsTicketConversations",
  summary: "List the conversations a support ticket is linked to",
  description:
    "pairConversationId shares a customer ticket's thread. provenanceConversationIds are the conversations a non-customer ticket was opened from.",
  action: "read",
  params: ticketParams,
  response: z.object({
    pairConversationId: z.string().nullable(),
    provenanceConversationIds: z.array(z.string()),
    count: z.number(),
  }),
  responseDescription: "The linked conversations",
  errors,
  handler: async ({ db, params }) => {
    await findTicket(db, params.ticketId);
    const provenance = await db
      .select({ id: ticketConversations.conversationId })
      .from(ticketConversations)
      .where(
        and(
          eq(ticketConversations.ticketId, params.ticketId),
          ne(ticketConversations.ticketType, "customer"),
        ),
      )
      .orderBy(asc(ticketConversations.createdAt))
      .limit(100);
    return {
      pairConversationId: await pairConversationId(db, params.ticketId),
      provenanceConversationIds: provenance.map((r) => r.id),
      count: provenance.length,
    };
  },
});

/** Teammate routes for tracker links and ticket-conversation links. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...getLinks)
  .openapi(...link)
  .openapi(...unlink)
  .openapi(...linkConversation)
  .openapi(...listConversations);
