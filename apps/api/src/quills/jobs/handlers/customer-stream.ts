import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import {
  principal,
  user as customer,
} from "../../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import {
  ticketConversations,
  tickets,
} from "../../../database/quills/schema/tickets";
import { broadcastToUserAndWait } from "../../../ws";
import { portalAccount } from "../../framework/platform-reads";
import { requireSurface } from "../../support/customer/model";
import { loadEvent } from "../fanout";

// The customer's live channel: Kaneo's user WebSocket (/api/ws/user). A portal customer signs in
// with a Kaneo account, so the socket is authorized on connect by the session middleware and is
// closed when the session ends; a reconnect with a revoked session is refused there. The message
// is an invalidation with IDs only: the client fetches through the customer routes, which filter
// internal notes and check ownership. A widget visitor has no Kaneo account and polls instead.

type ConversationId = (typeof conversations.$inferSelect)["id"];
type MessageId = (typeof conversationMessages.$inferSelect)["id"];
type TicketId = (typeof tickets.$inferSelect)["id"];

/** Event types a customer hears about. Note events (`message.note_*`, `ticket.note_added`) are not here. */
const MESSAGE_EVENTS = new Set([
  "message.created",
  "message.updated",
  "message.deleted",
]);
/** "Track as feedback" shares the post into the thread and names that message in the payload. */
const SHARED_MESSAGE_EVENTS = new Set(["post.created", "post.voted"]);
const CONVERSATION_EVENTS = new Set([
  "conversation.created",
  "conversation.status_changed",
  "conversation.csat_submitted",
]);
const TICKET_EVENTS = new Set([
  "ticket.created",
  "ticket.status_changed",
  "ticket.replied",
]);

type Target = { conversationId?: string; ticketId?: string };

/** The customer conversation or ticket an event is about, and its owner, or undefined. */
async function targetOf(workspaceId: string, eventId: string) {
  return withQuillsSystemWorkspace(workspaceId, async (db) => {
    const event = await loadEvent(db, eventId);
    if (!event) return undefined;
    let visitor: (typeof principal.$inferSelect)["id"] | undefined;
    const target: Target = {};
    const messageId = MESSAGE_EVENTS.has(event.type)
      ? event.entityType === "conversation_message" && event.entityId
      : SHARED_MESSAGE_EVENTS.has(event.type) &&
        (event.payload as { messageId?: string }).messageId;
    if (messageId) {
      const [row] = await db
        .select({
          conversationId: conversationMessages.conversationId,
          isInternal: conversationMessages.isInternal,
          visitor: conversations.visitorPrincipalId,
        })
        .from(conversationMessages)
        .innerJoin(
          conversations,
          eq(conversations.id, conversationMessages.conversationId),
        )
        .where(eq(conversationMessages.id, messageId as MessageId));
      if (!row || row.isInternal) return undefined;
      visitor = row.visitor;
      target.conversationId = row.conversationId!;
    } else if (
      CONVERSATION_EVENTS.has(event.type) &&
      event.entityType === "conversation"
    ) {
      const [row] = await db
        .select({ visitor: conversations.visitorPrincipalId })
        .from(conversations)
        .where(eq(conversations.id, event.entityId as ConversationId));
      visitor = row?.visitor;
      target.conversationId = event.entityId;
    } else if (TICKET_EVENTS.has(event.type) && event.entityType === "ticket") {
      const [row] = await db
        .select({
          requester: tickets.requesterPrincipalId,
          conversationId: ticketConversations.conversationId,
        })
        .from(tickets)
        .leftJoin(
          ticketConversations,
          and(
            eq(ticketConversations.ticketId, tickets.id),
            eq(ticketConversations.ticketType, "customer"),
          ),
        )
        .where(
          and(
            eq(tickets.id, event.entityId as TicketId),
            eq(tickets.type, "customer"),
          ),
        );
      visitor = row?.requester ?? undefined;
      target.ticketId = event.entityId;
      if (row?.conversationId) target.conversationId = row.conversationId;
    }
    if (!visitor) return undefined;
    const [owner] = await db
      .select({
        userId: customer.kaneoUserId,
        customerId: customer.id,
        blockedAt: principal.blockedAt,
      })
      .from(principal)
      .innerJoin(customer, eq(customer.id, principal.userId))
      .where(eq(principal.id, visitor));
    return owner?.userId && !owner.blockedAt
      ? {
          userId: owner.userId,
          principalId: visitor,
          customerId: owner.customerId,
          ...target,
        }
      : undefined;
  });
}

/**
 * Tells the portal customer who owns the conversation or ticket that it changed, while the portal,
 * its private gate and its support switch still admit them and the account is not banned. Runs
 * after commit from the event job, so a rolled-back write never reaches a customer. Invalidations
 * may repeat on a retry; the client refetches.
 */
export async function deliverCustomerChange(
  workspaceId: string,
  eventId: string,
) {
  const target = await targetOf(workspaceId, eventId);
  if (!target) return;
  const { userId, principalId, customerId, ...ids } = target;
  const account = await portalAccount(workspaceId, userId);
  if (!account) return;
  const admitted = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    try {
      await requireSurface(
        db,
        "portal",
        { principalId, customerId, account },
        ids.ticketId ? "tickets" : "messenger",
      );
      return true;
    } catch (error) {
      if (error instanceof HTTPException) return false;
      throw error;
    }
  });
  if (!admitted) return;
  await broadcastToUserAndWait(userId, {
    type: "QUILLS_CUSTOMER_CHANGED",
    workspaceId,
    eventId,
    ...ids,
  });
}
