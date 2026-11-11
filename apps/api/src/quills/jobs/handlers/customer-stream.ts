import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
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
import { trackerTargets } from "./support-mail";

// The customer's live channel: Kaneo's user WebSocket (/api/ws/user). A portal customer signs in
// with a Kaneo account, so the socket is authorized on connect by the session middleware and is
// closed when the session ends; a reconnect with a revoked session is refused there. The message
// is an invalidation with IDs only: the client fetches through the customer routes, which filter
// internal notes and check ownership. A widget visitor has no Kaneo account and polls instead.

type ConversationId = (typeof conversations.$inferSelect)["id"];
type MessageId = (typeof conversationMessages.$inferSelect)["id"];
type TicketId = (typeof tickets.$inferSelect)["id"];
type PrincipalId = (typeof principal.$inferSelect)["id"];

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
type Found = { visitor: PrincipalId; target: Target };

/** Customer tickets' requesters, with each ticket and its paired conversation, in one read. */
async function ticketTargets(db: Database, ticketIds: TicketId[]) {
  const rows = await db
    .select({
      ticketId: tickets.id,
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
    .where(and(inArray(tickets.id, ticketIds), eq(tickets.type, "customer")));
  return rows.flatMap((row): Found[] =>
    row.requester
      ? [
          {
            visitor: row.requester,
            target: {
              ticketId: row.ticketId,
              ...(row.conversationId && {
                conversationId: row.conversationId,
              }),
            },
          },
        ]
      : [],
  );
}

/**
 * The customer conversations and tickets an event is about, with their owners. A tracker's
 * reply-all or status move reaches the requester of each linked ticket it changed.
 */
async function targetsOf(workspaceId: string, eventId: string) {
  return withQuillsSystemWorkspace(workspaceId, async (db) => {
    const event = await loadEvent(db, eventId);
    if (!event) return [];
    const found: Found[] = [];
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
      if (row && !row.isInternal)
        found.push({
          visitor: row.visitor,
          target: { conversationId: row.conversationId! },
        });
    } else if (
      CONVERSATION_EVENTS.has(event.type) &&
      event.entityType === "conversation"
    ) {
      const [row] = await db
        .select({ visitor: conversations.visitorPrincipalId })
        .from(conversations)
        .where(eq(conversations.id, event.entityId as ConversationId));
      if (row)
        found.push({
          visitor: row.visitor,
          target: { conversationId: event.entityId },
        });
    } else if (TICKET_EVENTS.has(event.type) && event.entityType === "ticket") {
      const ids = new Set([
        event.entityId as TicketId,
        ...(await trackerTargets(db, event)),
      ]);
      found.push(...(await ticketTargets(db, [...ids])));
    }
    const visitors = [...new Set(found.map((one) => one.visitor))];
    const owners = new Map(
      (visitors.length
        ? await db
            .select({
              principalId: principal.id,
              userId: customer.kaneoUserId,
              customerId: customer.id,
              blockedAt: principal.blockedAt,
            })
            .from(principal)
            .innerJoin(customer, eq(customer.id, principal.userId))
            .where(inArray(principal.id, visitors))
        : []
      ).map((owner) => [owner.principalId as string, owner]),
    );
    return found.flatMap(({ visitor, target }) => {
      const owner = owners.get(visitor);
      return owner?.userId && !owner.blockedAt
        ? [
            {
              userId: owner.userId,
              principalId: visitor,
              customerId: owner.customerId,
              ...target,
            },
          ]
        : [];
    });
  });
}

/**
 * Tells each portal customer who owns a conversation or ticket the event changed, while the portal,
 * its private gate and its support switch still admit them and the account is not banned. Runs
 * after commit from the event job, so a rolled-back write never reaches a customer. Each target
 * hears once per delivery; a retry may repeat an invalidation, and the client refetches.
 */
export async function deliverCustomerChange(
  workspaceId: string,
  eventId: string,
) {
  const targets = await targetsOf(workspaceId, eventId);
  if (!targets.length) return;
  const accounts = new Map<string, Awaited<ReturnType<typeof portalAccount>>>();
  for (const { userId } of targets)
    if (!accounts.has(userId))
      accounts.set(userId, await portalAccount(workspaceId, userId));
  // One transaction checks every target's surface (a tracker can reach many linked requesters).
  const admitted = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const passed = [];
    for (const target of targets) {
      const account = accounts.get(target.userId);
      if (!account) continue;
      try {
        await requireSurface(
          db,
          "portal",
          {
            principalId: target.principalId,
            customerId: target.customerId,
            account,
          },
          target.ticketId ? "tickets" : "messenger",
        );
        passed.push(target);
      } catch (error) {
        if (!(error instanceof HTTPException)) throw error;
      }
    }
    return passed;
  });
  for (const { userId, principalId: _p, customerId: _c, ...ids } of admitted)
    await broadcastToUserAndWait(userId, {
      type: "QUILLS_CUSTOMER_CHANGED",
      workspaceId,
      eventId,
      ...ids,
    });
}
