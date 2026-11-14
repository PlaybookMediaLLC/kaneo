import { and, eq, isNull } from "drizzle-orm";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  ticketConversations,
  tickets,
  ticketStatuses,
} from "../../database/quills/schema/tickets";
import { TICKET_STATUS_CATEGORIES } from "../../database/quills/types";
import { defineQuillsRoute } from "../framework/define-route";
import {
  conversationParams,
  errors,
  findConversation,
} from "./conversation-model";

// The customer ticket that shares a conversation's thread (the 1:1 pair in
// ticket_conversations). Tickets opened from a conversation are not its pair.

const getTicketLink = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/ticket",
  operationId: "getQuillsConversationTicketLink",
  summary: "Get the customer ticket of a conversation",
  description:
    "The customer ticket paired with the conversation, or null. A deleted ticket is null.",
  action: "read",
  params: conversationParams,
  response: z.object({
    ticket: z
      .object({
        id: z.string(),
        number: z.number(),
        reference: z.string(),
        title: z.string(),
        status: z.object({
          name: z.string(),
          category: z.enum(TICKET_STATUS_CATEGORIES),
        }),
      })
      .nullable(),
  }),
  responseDescription: "The paired customer ticket",
  errors,
  handler: async ({ db, params }) => {
    await findConversation(db, params.conversationId);
    const [row] = await db
      .select({
        id: tickets.id,
        number: tickets.number,
        title: tickets.title,
        name: ticketStatuses.name,
        category: ticketStatuses.category,
      })
      .from(ticketConversations)
      .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
      .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
      .where(
        and(
          eq(ticketConversations.conversationId, params.conversationId),
          eq(ticketConversations.ticketType, "customer"),
          isNull(tickets.deletedAt),
        ),
      )
      .limit(1);
    return {
      ticket: row
        ? {
            id: row.id,
            number: row.number,
            reference: `#${row.number}`,
            title: row.title,
            status: { name: row.name, category: row.category },
          }
        : null,
    };
  },
});

/** Teammate route for the customer ticket of a conversation. */
export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...getTicketLink,
);
