import { and, eq, isNull, or, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { tickets } from "../../database/quills/schema/tickets";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  findTicket,
  notFound,
  pairConversationId,
  ticketParams,
  type TicketRow,
} from "./ticket-view";

const errors = { 404: "Ticket or message not found" };
const readState = z.object({ agentLastReadAt: nullableResponseTimestamp });
const marker = {
  none: "The teammate read marker is a view state; the source publishes no change event for it.",
};

/** A customer pair keeps its read marker on the conversation; any other ticket on itself. */
async function setMarker(db: Database, ticket: TicketRow, at: Date | null) {
  const pair = await pairConversationId(db, ticket.id);
  if (pair)
    await db
      .update(conversations)
      .set({ agentLastReadAt: at })
      .where(eq(conversations.id, pair));
  else
    await db
      .update(tickets)
      // Keeps updated_at: reading a ticket must not move it in the recent-first list.
      .set({ assigneeLastReadAt: at, updatedAt: sql`${tickets.updatedAt}` })
      .where(eq(tickets.id, ticket.id));
  return { agentLastReadAt: at, pair };
}

const markRead = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/read",
  operationId: "markQuillsTicketRead",
  summary: "Mark a support ticket read for teammates",
  action: "read",
  params: ticketParams,
  response: readState,
  responseDescription: "The teammate read marker",
  errors,
  event: marker,
  handler: async ({ db, params }) => {
    const ticket = await findTicket(db, params.ticketId);
    const { agentLastReadAt } = await setMarker(db, ticket, new Date());
    return { agentLastReadAt };
  },
});

const markUnread = defineQuillsRoute({
  method: "post",
  path: "/tickets/{ticketId}/unread",
  operationId: "markQuillsTicketUnread",
  summary: "Mark a support ticket unread from one message",
  description: "The message and every later one count as unread for teammates.",
  action: "read",
  params: ticketParams,
  body: z.object({ messageId: flexibleToTypeIdSchema("conversation_msg") }),
  response: readState,
  responseDescription: "The teammate read marker",
  errors,
  event: marker,
  handler: async ({ db, params, body }) => {
    const ticket = await findTicket(db, params.ticketId);
    const pair = await pairConversationId(db, ticket.id);
    const [message] = await db
      .select({ createdAt: conversationMessages.createdAt })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, body.messageId),
          isNull(conversationMessages.deletedAt),
          pair
            ? or(
                eq(conversationMessages.ticketId, ticket.id),
                eq(conversationMessages.conversationId, pair),
              )
            : eq(conversationMessages.ticketId, ticket.id),
        ),
      );
    if (!message) throw notFound("Message");
    // One millisecond before the message, so the message itself reads as unread.
    const { agentLastReadAt } = await setMarker(
      db,
      ticket,
      new Date(message.createdAt.getTime() - 1),
    );
    return { agentLastReadAt };
  },
});

/** Teammate read markers for tickets. */
export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...markRead)
  .openapi(...markUnread);
