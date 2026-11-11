import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import {
  sendConversationMessageEmail,
  sendNoteMentionEmail,
  type SealedEmail,
  type SendingIdentity,
} from "@kaneo/email/quills";
import type { PostCommentId, PostId, PrincipalId } from "@kaneo/ids";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../../database/quills/client";
import {
  principal,
  settings,
  user as customer,
} from "../../../database/quills/schema/auth";
import {
  channelAccounts,
  emailSendingDomains,
} from "../../../database/quills/schema/channel-accounts";
import {
  conversationMessageMentions,
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { ticketSubscriptions } from "../../../database/quills/schema/ticket-subscriptions";
import { tickets } from "../../../database/quills/schema/tickets";
import { realEmail } from "../../directory/customer";
import { portalAccount } from "../../framework/platform-reads";
import {
  commentVisible,
  postVisible,
  viewerFor,
  visibleBoards,
} from "../../portal/feedback/viewer";
import type { DeliveryEvent, Subscribers } from "../fanout";

// Support delivery: the customer's copy of a teammate reply on an email conversation, mention and
// ticket-watcher notices for teammates, and the send-time decision for customer post mail.
// Every entry reads its records again at send time; an internal note never produces customer mail.

type MessageId = (typeof conversationMessages.$inferSelect)["id"];
type TicketId = (typeof tickets.$inferSelect)["id"];

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;
const clientUrl = () =>
  (process.env.KANEO_CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");
// ponytail: apps/web has no Quills support pages yet. Point these at the real routes when they land.
const customerConversationUrl = (workspaceId: string, conversationId: string) =>
  `${clientUrl()}/portal/${encodeURIComponent(workspaceId)}/conversations/${conversationId}`;
const teammateConversationUrl = (workspaceId: string, conversationId: string) =>
  `${clientUrl()}/dashboard/workspace/${encodeURIComponent(workspaceId)}/support/conversations/${conversationId}`;

async function workspaceOf(db: Database) {
  const [row] = await db
    .select({ id: settings.workspaceId, name: settings.name })
    .from(settings)
    .limit(1);
  return row;
}

const payloadOf = (event: DeliveryEvent) =>
  event.payload as Record<string, string | undefined>;

/**
 * The verified support address that the conversation may send from, or undefined for the platform
 * sender. The only place a SendingIdentity is minted: the address must be a live sending account
 * whose own domain is verified.
 */
async function sendingIdentity(
  db: Database,
  conversation: typeof conversations.$inferSelect,
): Promise<SendingIdentity | undefined> {
  // Without an account or a team, any verified address of the workspace would match below.
  if (!conversation.channelAccountId && !conversation.assignedTeamId)
    return undefined;
  const rows = await db
    .select({
      address: channelAccounts.address,
      domain: emailSendingDomains.domain,
    })
    .from(channelAccounts)
    .innerJoin(
      emailSendingDomains,
      eq(emailSendingDomains.id, channelAccounts.sendingDomainId),
    )
    .where(
      and(
        eq(channelAccounts.role, "sending"),
        isNull(channelAccounts.deletedAt),
        eq(emailSendingDomains.status, "verified"),
        or(
          conversation.channelAccountId
            ? eq(channelAccounts.id, conversation.channelAccountId)
            : undefined,
          conversation.assignedTeamId
            ? and(
                eq(channelAccounts.module, "support"),
                eq(channelAccounts.owningTeamId, conversation.assignedTeamId),
              )
            : undefined,
        ),
      ),
    )
    .limit(5);
  const own = rows.find(
    (row) =>
      row.address &&
      row.address.slice(row.address.lastIndexOf("@") + 1).toLowerCase() ===
        row.domain.toLowerCase(),
  );
  return own ? (own.address as SendingIdentity) : undefined;
}

/**
 * The event's message when it is a live, customer-visible agent message with text on an email
 * conversation, with that conversation. A message with only an embed (a shared post) has no text
 * to mail.
 */
async function emailReply(db: Database, event: DeliveryEvent) {
  const messageId = (
    event.entityType === "conversation_message"
      ? event.entityId
      : payloadOf(event).messageId
  ) as MessageId | undefined;
  if (!messageId) return undefined;
  const [message] = await db
    .select({
      conversationId: conversationMessages.conversationId,
      senderType: conversationMessages.senderType,
      isInternal: conversationMessages.isInternal,
      content: conversationMessages.content,
      author: principal.displayName,
    })
    .from(conversationMessages)
    .leftJoin(principal, eq(principal.id, conversationMessages.principalId))
    .where(
      and(
        eq(conversationMessages.id, messageId),
        isNull(conversationMessages.deletedAt),
      ),
    );
  if (
    !message?.conversationId ||
    message.senderType !== "agent" ||
    message.isInternal ||
    !message.content.trim()
  )
    return undefined;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, message.conversationId));
  return conversation?.channel === "email"
    ? { message, conversation }
    : undefined;
}

/**
 * The customer's mail copy of a teammate reply on an email conversation. Read at send time:
 * the message must still be a live, customer-visible agent message, and the address is the
 * conversation's captured address, else the customer's contact or profile address.
 */
const replyMail: NonNullable<Subscribers["mail"]> = async (db, event) => {
  const reply = await emailReply(db, event);
  if (!reply) return undefined;
  const { message, conversation } = reply;
  const [visitor] = await db
    .select({
      contactEmail: principal.contactEmail,
      email: customer.email,
      blockedAt: principal.blockedAt,
    })
    .from(principal)
    .leftJoin(customer, eq(customer.id, principal.userId))
    .where(eq(principal.id, conversation.visitorPrincipalId));
  const to =
    realEmail(conversation.visitorEmail) ??
    realEmail(visitor?.contactEmail ?? null) ??
    realEmail(visitor?.email ?? null);
  const workspace = await workspaceOf(db);
  if (!to || visitor?.blockedAt || !workspace) return undefined;
  const from = await sendingIdentity(db, conversation);
  return {
    type: "conversation_reply",
    emailType: "ConversationReplyEmail",
    to,
    send: (address) =>
      sendConversationMessageEmail({
        // Sealed: the address read from the conversation and its visitor at send time.
        to: address as SealedEmail,
        direction: "agent_reply",
        senderName: message.author ?? workspace.name,
        messagePreview: clip(message.content, 500),
        ctaUrl: customerConversationUrl(workspace.id, conversation.id),
        workspaceName: workspace.name,
        channel: "email",
        correspondence: true,
        conversationSubject: conversation.subject,
        conversationId: conversation.id,
        from,
      }),
  };
};

/** The live note's mentioned principals; fan-out keeps current teammates and drops the author. */
const mentioned: Subscribers["recipients"] = async (db, event) => {
  const rows = await db
    .select({ principalId: conversationMessageMentions.principalId })
    .from(conversationMessageMentions)
    .innerJoin(
      conversationMessages,
      eq(
        conversationMessages.id,
        conversationMessageMentions.conversationMessageId,
      ),
    )
    .where(
      and(
        eq(
          conversationMessageMentions.conversationMessageId,
          event.entityId as MessageId,
        ),
        isNull(conversationMessages.deletedAt),
      ),
    );
  return { principalIds: rows.map((row) => row.principalId) };
};

async function liveNote(db: Database, event: DeliveryEvent) {
  const [note] = await db
    .select({
      conversationId: conversationMessages.conversationId,
      content: conversationMessages.content,
      author: principal.displayName,
    })
    .from(conversationMessages)
    .leftJoin(principal, eq(principal.id, conversationMessages.principalId))
    .where(
      and(
        eq(conversationMessages.id, event.entityId as MessageId),
        eq(conversationMessages.isInternal, true),
        isNull(conversationMessages.deletedAt),
      ),
    );
  return note?.conversationId ? note : undefined;
}

/** A ticket's watchers who have not muted it; fan-out keeps current teammates and drops the actor. */
const watchers: Subscribers["recipients"] = async (db, event) => {
  const rows = await db
    .select({ principalId: ticketSubscriptions.principalId })
    .from(ticketSubscriptions)
    .innerJoin(tickets, eq(tickets.id, ticketSubscriptions.ticketId))
    .where(
      and(
        eq(ticketSubscriptions.ticketId, event.entityId as TicketId),
        isNull(tickets.deletedAt),
        or(
          isNull(ticketSubscriptions.mutedUntil),
          lte(ticketSubscriptions.mutedUntil, sql`now()`),
        ),
      ),
    );
  return { principalIds: rows.map((row) => row.principalId) };
};

const watcherNotice =
  (
    title: (reference: string) => string,
  ): NonNullable<Subscribers["notification"]> =>
  async (db, event) => {
    const [ticket] = await db
      .select({ number: tickets.number, title: tickets.title })
      .from(tickets)
      .where(
        and(
          eq(tickets.id, event.entityId as TicketId),
          isNull(tickets.deletedAt),
        ),
      );
    if (!ticket) return undefined;
    return {
      type: "ticket_watch",
      title: clip(title(`#${ticket.number}`), 255),
      body: clip(ticket.title, 500),
    };
  };

const noRecipients = async () => ({ principalIds: [] as PrincipalId[] });

/** Support entries for jobs/fanout.ts#subscribers. */
export const supportSubscribers: Partial<Record<string, Subscribers>> = {
  "message.created": {
    recipients: noRecipients,
    // Decided at fan-out, so a messenger message or a visitor message queues no mail job.
    direct: async (db, event) => Boolean(await emailReply(db, event)),
    mail: replyMail,
  },
  "message.note_created": {
    recipients: mentioned,
    notification: async (db, event) => {
      const note = await liveNote(db, event);
      if (!note) return undefined;
      return {
        type: "note_mention",
        title: clip(
          `${note.author ?? "A teammate"} mentioned you in a note`,
          255,
        ),
        body: clip(note.content, 150),
      };
    },
    mail: async (db, event) => {
      const note = await liveNote(db, event);
      const workspace = await workspaceOf(db);
      if (!note || !workspace) return undefined;
      return {
        type: "note_mention",
        emailType: "NoteMentionEmail",
        send: (to) =>
          sendNoteMentionEmail({
            to,
            authorName: note.author ?? "A teammate",
            preview: clip(note.content, 150),
            conversationUrl: teammateConversationUrl(
              workspace.id,
              note.conversationId!,
            ),
            workspaceName: workspace.name,
          }),
      };
    },
  },
  // Watchers hear in-app; the requester's reply copy is direct mail. Fan-out sends no
  // per-watcher mail for a direct entry.
  "ticket.replied": {
    recipients: watchers,
    // A reply on a customer pair is a conversation message (`payload.messageId`).
    direct: async (db, event) => Boolean(await emailReply(db, event)),
    notification: watcherNotice((ref) => `New reply on ticket ${ref}`),
    mail: replyMail,
  },
  "ticket.status_changed": {
    recipients: watchers,
    notification: watcherNotice((ref) => `Ticket ${ref} changed status`),
  },
  "ticket.note_added": {
    recipients: watchers,
    notification: watcherNotice((ref) => `New internal note on ticket ${ref}`),
  },
};

/**
 * The address to mail a customer about a post, decided at send time: the customer is live and not
 * blocked, a Kaneo account's address is verified, the portal (a Kaneo account) or the widget (a
 * widget-only profile) still admits them, the private-portal gate lets them in, the post is
 * visible to them by the public rules of portal/feedback/viewer.ts, and a comment is one they may
 * read (not private, not held). Undefined means no mail.
 */
export async function customerPostAddress(
  workspaceId: string,
  principalId: PrincipalId,
  postId: PostId | undefined,
  commentId?: PostCommentId,
) {
  if (!postId) return undefined;
  const person = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const [row] = await db
      .select({
        customerId: customer.id,
        kaneoUserId: customer.kaneoUserId,
        email: customer.email,
        blockedAt: principal.blockedAt,
        teammate: principal.kaneoUserId,
        test: principal.testOwnerPrincipalId,
      })
      .from(principal)
      .innerJoin(customer, eq(customer.id, principal.userId))
      .where(eq(principal.id, principalId));
    return row;
  });
  if (!person || person.blockedAt || person.teammate || person.test)
    return undefined;
  const account = person.kaneoUserId
    ? await portalAccount(workspaceId, person.kaneoUserId)
    : undefined;
  // An unverified account address may belong to someone else: subscribing is allowed, mail is not.
  if (person.kaneoUserId && !account?.emailVerified) return undefined;
  const visible = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    try {
      const viewer = await viewerFor(db, account ? "portal" : "widget", {
        principalId,
        customerId: person.customerId,
        account: account ?? null,
      });
      const boards = await visibleBoards(db, viewer);
      const [post] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(
          and(
            eq(posts.id, postId),
            postVisible(
              viewer,
              boards.map((board) => board.id),
            ),
          ),
        );
      if (!post || !commentId) return Boolean(post);
      // A private (team) comment, a held one or a test customer's never reaches a customer.
      const [comment] = await db
        .select({ id: postComments.id })
        .from(postComments)
        .where(
          and(
            eq(postComments.id, commentId),
            eq(postComments.postId, postId),
            isNull(postComments.deletedAt),
            commentVisible(viewer),
          ),
        );
      return Boolean(comment);
    } catch (error) {
      // A closed portal or widget, or a private portal that denies the customer.
      if (error instanceof HTTPException) return false;
      throw error;
    }
  });
  if (!visible) return undefined;
  return realEmail(account ? account.email : person.email) ?? undefined;
}
