import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import { principal } from "../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { ticketActivity } from "../../database/quills/schema/ticket-activity";
import {
  ticketConversations,
  tickets,
} from "../../database/quills/schema/tickets";
import {
  defineQuillsRoute,
  type Database,
  type QuillsActor,
} from "../framework/define-route";
import { lockedLinkedTickets, lockTickets } from "./ticket-lifecycle";
import {
  findTicket,
  notFound,
  pairConversationId,
  subscribe,
  ticketParams,
  type TicketRow,
} from "./ticket-view";

const errors = { 404: "Ticket or message not found" };
type MessageRow = typeof conversationMessages.$inferSelect;

const messageSchema = z.object({
  id: z.string(),
  ticketId: z.string().nullable(),
  conversationId: z.string().nullable(),
  senderType: z.enum(conversationMessages.senderType.enumValues),
  isInternal: z.boolean(),
  author: z
    .object({ principalId: z.string(), displayName: z.string().nullable() })
    .nullable(),
  content: z.string(),
  systemEvent: z
    .object({
      kind: z.string(),
      stageLabel: z.string().optional(),
      closed: z.boolean().optional(),
      ticketReference: z.string().optional(),
      trackerReference: z.string().optional(),
    })
    .nullable(),
  createdAt: responseTimestamp,
});

async function messageViews(db: Database, rows: MessageRow[]) {
  const ids = [
    ...new Set(rows.flatMap((r) => (r.principalId ? [r.principalId] : []))),
  ];
  const names = new Map(
    (ids.length
      ? await db
          .select({ id: principal.id, name: principal.displayName })
          .from(principal)
          .where(inArray(principal.id, ids))
      : []
    ).map((r) => [r.id as string, r.name]),
  );
  return rows.map((r) => {
    const event = r.metadata?.systemEvent;
    return {
      id: r.id,
      ticketId: r.ticketId,
      conversationId: r.conversationId,
      senderType: r.senderType,
      isInternal: r.isInternal,
      author: r.principalId
        ? {
            principalId: r.principalId,
            displayName: names.get(r.principalId) ?? null,
          }
        : null,
      content: r.content,
      systemEvent: event
        ? {
            kind: event.kind,
            stageLabel: event.stageLabel,
            closed: event.closed,
            ticketReference: event.ticketReference,
            trackerReference: event.trackerReference,
          }
        : null,
      createdAt: r.createdAt,
    };
  });
}

/** The ticket's own rows plus, for a customer pair, its conversation's rows. */
async function threadOf(
  db: Database,
  ticketId: TypeId<"ticket">,
): Promise<SQL> {
  const pair = await pairConversationId(db, ticketId);
  return pair
    ? or(
        eq(conversationMessages.ticketId, ticketId),
        eq(conversationMessages.conversationId, pair),
      )!
    : eq(conversationMessages.ticketId, ticketId);
}

const listMessages = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/messages",
  operationId: "listQuillsTicketMessages",
  summary: "List a support ticket's thread",
  description:
    "Oldest first. A customer ticket's thread includes its conversation's messages. Internal notes need includeInternal=true. Pass the oldest message ID as `before` for the previous page.",
  action: "read",
  params: ticketParams,
  query: z.object({
    before: flexibleToTypeIdSchema("conversation_msg").optional(),
    includeInternal: z.enum(["true", "false"]).default("false"),
    limit: pagingNumber(1, 100, 50),
  }),
  response: z.object({
    items: z.array(messageSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of the thread",
  errors,
  handler: async ({ db, params, query }) => {
    await findTicket(db, params.ticketId);
    const thread = await threadOf(db, params.ticketId);
    const visible = and(
      thread,
      isNull(conversationMessages.deletedAt),
      query.includeInternal === "true"
        ? undefined
        : eq(conversationMessages.isInternal, false),
    );
    let before;
    if (query.before) {
      const [cursor] = await db
        .select({
          at: sql<string>`${conversationMessages.createdAt}::text`,
          id: sql<string>`${conversationMessages.id}::text`,
        })
        .from(conversationMessages)
        .where(and(visible, eq(conversationMessages.id, query.before)));
      if (!cursor) throw notFound("Message");
      before = sql`(${conversationMessages.createdAt}, ${conversationMessages.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
    }
    const rows = await db
      .select()
      .from(conversationMessages)
      .where(and(visible, before))
      .orderBy(
        desc(conversationMessages.createdAt),
        desc(conversationMessages.id),
      )
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit).reverse();
    return {
      items: await messageViews(db, page),
      nextCursor: hasMore ? page[0]!.id : null,
      hasMore,
    };
  },
});

/**
 * An agent reply. A customer pair's reply lands on its conversation and stops the requester's
 * wait; any other ticket keeps it on its own thread and stamps the first response.
 */
async function insertReply(
  db: Database,
  actor: QuillsActor,
  ticket: TicketRow,
  content: string,
  repliedAllFromTicketId?: TypeId<"ticket">,
) {
  const now = new Date();
  const metadata = repliedAllFromTicketId
    ? { repliedAllFromTicketId }
    : undefined;
  const pair =
    ticket.type === "customer" ? await pairConversationId(db, ticket.id) : null;
  const [row] = await db
    .insert(conversationMessages)
    .values({
      ...(pair ? { conversationId: pair } : { ticketId: ticket.id }),
      principalId: actor.principalId,
      senderType: "agent",
      content,
      metadata,
    })
    .returning();
  if (pair)
    await db
      .update(conversations)
      .set({
        lastMessageAt: now,
        lastMessagePreview: content.slice(0, 140),
        waitingSince: null,
      })
      .where(eq(conversations.id, pair));
  await db
    .update(tickets)
    .set({
      updatedAt: now,
      ...(!pair && !ticket.firstResponseAt && { firstResponseAt: now }),
    })
    .where(eq(tickets.id, ticket.id));
  return row!;
}

const content = z.string().trim().min(1).max(4000);

const reply = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/reply",
  operationId: "replyQuillsTicket",
  summary: "Reply to a support ticket",
  description:
    "A customer-visible reply. The request only records it; delivery to the requester runs after commit. On a tracker, replyAll=true also posts the reply on every linked customer ticket in the same transaction.",
  action: "update",
  params: ticketParams,
  body: z.object({ content, replyAll: z.boolean().default(false) }),
  response: messageSchema,
  responseDescription: "The reply",
  errors,
  event: ({ params }, message) => ({
    type: "ticket.replied",
    entityType: "ticket",
    entityId: params.ticketId,
    payload: { messageId: message.id },
  }),
  handler: async ({ db, actor, params, body }) => {
    // With reply-all, the tracker and its linked tickets are locked together, in ID order.
    const locked = await lockTickets(db, [params.ticketId], body.replyAll);
    const ticket = locked.find((t) => t.id === params.ticketId);
    if (!ticket) throw notFound("Ticket");
    const row = await insertReply(db, actor, ticket, body.content);
    await subscribe(db, ticket.id, actor.principalId, "replier");
    if (body.replyAll && ticket.type === "tracker")
      for (const target of await lockedLinkedTickets(db, ticket.id))
        await insertReply(db, actor, target, body.content, ticket.id);
    return (await messageViews(db, [row]))[0]!;
  },
});

const note = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/note",
  operationId: "addQuillsTicketNote",
  summary: "Add an internal note to a support ticket",
  description:
    "Never customer-visible. shareWithConversation=true also copies the note, as an internal note, onto each conversation the ticket was opened from (not a customer pair's conversation).",
  action: "update",
  params: ticketParams,
  body: z.object({
    content,
    shareWithConversation: z.boolean().default(false),
  }),
  response: messageSchema,
  responseDescription: "The note",
  errors,
  event: ({ params }, message) => ({
    type: "ticket.note_added",
    entityType: "ticket",
    entityId: params.ticketId,
    payload: { messageId: message.id },
  }),
  handler: async ({ db, actor, params, body }) => {
    const ticket = await findTicket(db, params.ticketId, true);
    const [row] = await db
      .insert(conversationMessages)
      .values({
        ticketId: ticket.id,
        principalId: actor.principalId,
        senderType: "agent",
        content: body.content,
        isInternal: true,
      })
      .returning();
    await db
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(eq(tickets.id, ticket.id));
    if (body.shareWithConversation) {
      const provenance = await db
        .select({ id: ticketConversations.conversationId })
        .from(ticketConversations)
        .where(
          and(
            eq(ticketConversations.ticketId, ticket.id),
            ne(ticketConversations.ticketType, "customer"),
          ),
        );
      if (provenance.length)
        await db.insert(conversationMessages).values(
          provenance.map((c) => ({
            conversationId: c.id,
            principalId: actor.principalId,
            senderType: "agent" as const,
            content: body.content,
            isInternal: true,
            metadata: { crossPostedFromTicketId: ticket.id },
          })),
        );
    }
    return (await messageViews(db, [row!]))[0]!;
  },
});

const listActivity = defineQuillsRoute({
  method: "get",
  path: "/tickets/{ticketId}/activity",
  operationId: "listQuillsTicketActivity",
  summary: "List a support ticket's activity timeline",
  description: "Newest first, at most 200 entries.",
  action: "read",
  params: ticketParams,
  response: z.object({
    items: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        principalId: z.string().nullable(),
        actorName: z.string().nullable(),
        metadata: z.object(
          Object.fromEntries(
            [
              "fromId",
              "fromName",
              "toId",
              "toName",
              "from",
              "to",
              "fromPrincipalId",
              "fromPrincipalName",
              "toPrincipalId",
              "toPrincipalName",
              "fromTeamId",
              "fromTeamName",
              "toTeamId",
              "toTeamName",
              "ticketType",
            ].map((key) => [key, z.string().nullable().optional()]),
          ),
        ),
        createdAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "The ticket's activity",
  errors,
  handler: async ({ db, params }) => {
    await findTicket(db, params.ticketId);
    const rows = await db
      .select({
        id: ticketActivity.id,
        type: ticketActivity.type,
        principalId: ticketActivity.principalId,
        actorName: principal.displayName,
        metadata: ticketActivity.metadata,
        createdAt: ticketActivity.createdAt,
      })
      .from(ticketActivity)
      .leftJoin(principal, eq(principal.id, ticketActivity.principalId))
      .where(eq(ticketActivity.ticketId, params.ticketId))
      .orderBy(desc(ticketActivity.createdAt), desc(ticketActivity.id))
      .limit(200);
    return {
      items: rows.map((r) => ({
        ...r,
        // Only string metadata values are part of the timeline contract.
        metadata: Object.fromEntries(
          Object.entries((r.metadata ?? {}) as Record<string, unknown>).filter(
            ([, v]) => v === null || typeof v === "string",
          ),
        ) as Record<string, string | null>,
      })),
    };
  },
});

/** Teammate routes for a ticket's thread and activity. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listMessages)
  .openapi(...reply)
  .openapi(...note)
  .openapi(...listActivity);
