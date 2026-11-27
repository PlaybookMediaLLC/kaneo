import {
  and,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import {
  sendConversationMessageEmail,
  sendCsatRequestEmail,
  sendNoteMentionEmail,
  type EmailAttachment,
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
import { emailLog } from "../../../database/quills/schema/email-log";
import {
  conversationMessageMentions,
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { postComments, posts } from "../../../database/quills/schema/posts";
import { ticketSubscriptions } from "../../../database/quills/schema/ticket-subscriptions";
import {
  ticketConversations,
  ticketLinks,
  tickets,
} from "../../../database/quills/schema/tickets";
import { realEmail } from "../../directory/customer";
import { portalAccount } from "../../framework/platform-reads";
import { outboundMessageId, replyAddress } from "../../framework/signed";
import {
  csatRatingUrls,
  mintCsatToken,
} from "../../support/customer/csat-email";
import {
  commentVisible,
  postVisible,
  viewerFor,
  visibleBoards,
} from "../../portal/feedback/viewer";
import type { DeliveryEvent, Subscribers } from "../fanout";
import { wants } from "../preferences";
import { loadMailAttachments, messageFiles } from "./mail-attachments";
import { portalPaths } from "../../portal/paths";
import { portalOn } from "../../settings/area";
import { requireSurface } from "../../support/customer/model";

// Support delivery: the customer's copy of a teammate reply on an email conversation, mention and
// ticket-watcher notices for teammates, and the send-time decision for customer post mail.
// Every entry reads its records again at send time; an internal note never produces customer mail.

type MessageId = (typeof conversationMessages.$inferSelect)["id"];
type TicketId = (typeof tickets.$inferSelect)["id"];
type TicketRow = typeof tickets.$inferSelect;

const clip = (text: string, length: number) =>
  text.length > length ? `${text.slice(0, length - 1)}…` : text;
/**
 * The portal page of a conversation, only when its customer can open it there: a profile linked to
 * a Kaneo account while the portal is on. An inbound mail's sender has no such link (a profile is
 * never matched to an account by email), so that customer replies by mail instead.
 */
export async function customerConversationLink(
  db: Database,
  workspaceId: string,
  conversation: Pick<
    typeof conversations.$inferSelect,
    "id" | "visitorPrincipalId"
  >,
) {
  const [visitor] = await db
    .select({ account: customer.kaneoUserId })
    .from(principal)
    .innerJoin(customer, eq(customer.id, principal.userId))
    .where(eq(principal.id, conversation.visitorPrincipalId));
  if (!visitor?.account) return undefined;
  const [row] = await db
    .select({ portalConfig: settings.portalConfig })
    .from(settings)
    .limit(1);
  return portalOn(row?.portalConfig ?? null)
    ? portalPaths.conversation(workspaceId, conversation.id)
    : undefined;
}
const teammateConversationUrl = (workspaceId: string, conversationId: string) =>
  portalPaths.teammateConversation(workspaceId, conversationId);

async function workspaceOf(db: Database) {
  const [row] = await db
    .select({
      id: settings.workspaceId,
      name: settings.name,
      slug: settings.slug,
    })
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
 * The event's message (or `target`, a copy the entry names) when it is a live, customer-visible
 * agent message with text, with its conversation. A message with only an embed (a shared post) has
 * no text to mail.
 */
async function agentReply(db: Database, event: DeliveryEvent, target?: string) {
  const messageId = (target ??
    (event.entityType === "conversation_message"
      ? event.entityId
      : payloadOf(event).messageId)) as MessageId | undefined;
  if (!messageId) return undefined;
  const [message] = await db
    .select({
      id: conversationMessages.id,
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
  return conversation ? { message, conversation } : undefined;
}

/** The reply on an email conversation: the customer's mail thread is the conversation. */
async function emailReply(db: Database, event: DeliveryEvent, target?: string) {
  const reply = await agentReply(db, event, target);
  return reply?.conversation.channel === "email" ? reply : undefined;
}

/** A portal reply waits this long: the open conversation page polls every 10 s and marks it read. */
export const PORTAL_REPLY_DELAY_SECONDS = 120;

/**
 * The reply on a portal conversation or ticket whose customer has a Kaneo account. Whether it is
 * mailed is decided at send time (`portalReplyMail`). A widget visitor has no portal page to link.
 */
async function portalReply(
  db: Database,
  event: DeliveryEvent,
  target?: string,
) {
  const reply = await agentReply(db, event, target);
  if (!reply || reply.conversation.channel === "email") return undefined;
  const [visitor] = await db
    .select({
      customerId: customer.id,
      account: customer.kaneoUserId,
      blockedAt: principal.blockedAt,
      test: principal.testOwnerPrincipalId,
    })
    .from(principal)
    .innerJoin(customer, eq(customer.id, principal.userId))
    .where(eq(principal.id, reply.conversation.visitorPrincipalId));
  return visitor?.account && !visitor.blockedAt && !visitor.test
    ? { ...reply, customerId: visitor.customerId, account: visitor.account }
    : undefined;
}

/** A widget visitor with a reachable email address (identified or contact_email) (#319). */
async function widgetReply(
  db: Database,
  event: DeliveryEvent,
  target?: string,
) {
  const reply = await agentReply(db, event, target);
  if (
    !reply ||
    reply.conversation.channel !== "messenger" ||
    reply.conversation.source !== "widget"
  ) {
    return undefined;
  }
  const [cfg] = await db
    .select({ widgetConfig: settings.widgetConfig })
    .from(settings)
    .limit(1);
  let widgetOn = true;
  if (cfg?.widgetConfig) {
    try {
      const parsed = JSON.parse(cfg.widgetConfig) as {
        enabled?: boolean;
        tabs?: { messenger?: boolean } | string[];
      };
      const messengerOff = Array.isArray(parsed.tabs)
        ? !parsed.tabs.includes("messages") &&
          !parsed.tabs.includes("messenger")
        : parsed.tabs?.messenger === false;
      widgetOn = parsed.enabled !== false && !messengerOff;
    } catch {
      widgetOn = false;
    }
  }
  if (!widgetOn) return undefined;
  const [visitor] = await db
    .select({
      blockedAt: principal.blockedAt,
      test: principal.testOwnerPrincipalId,
      kaneoUserId: principal.kaneoUserId,
    })
    .from(principal)
    .where(eq(principal.id, reply.conversation.visitorPrincipalId))
    .limit(1);
  if (!visitor || visitor.blockedAt || visitor.test || visitor.kaneoUserId) {
    return undefined;
  }
  const address = await visitorAddress(db, reply.conversation);
  return address ? { ...reply, to: address } : undefined;
}

/** A reply that reaches the customer by mail: email pair, portal conversation, or offline widget visitor (#319). */
const customerReply = async (
  db: Database,
  event: DeliveryEvent,
  target?: string,
) =>
  (await emailReply(db, event, target)) ??
  (await portalReply(db, event, target)) ??
  (await widgetReply(db, event, target));

const replyDelay = async (db: Database, event: DeliveryEvent) =>
  (await emailReply(db, event)) ? 0 : PORTAL_REPLY_DELAY_SECONDS;

/** The conversation's customer address: the captured one, else the contact or profile address. */
async function visitorAddress(
  db: Database,
  conversation: typeof conversations.$inferSelect,
) {
  const [visitor] = await db
    .select({
      contactEmail: principal.contactEmail,
      email: customer.email,
      blockedAt: principal.blockedAt,
    })
    .from(principal)
    .leftJoin(customer, eq(customer.id, principal.userId))
    .where(eq(principal.id, conversation.visitorPrincipalId));
  if (visitor?.blockedAt) return undefined;
  return (
    realEmail(conversation.visitorEmail) ??
    realEmail(visitor?.contactEmail ?? null) ??
    realEmail(visitor?.email ?? null) ??
    undefined
  );
}

/**
 * RFC 5322 threading and the Reply-To of a mail about `messageId` (or about the conversation, for
 * a mail with no message): the earlier customer-visible messages' Message-IDs, oldest first (at
 * most 20): a customer mail's own, our deterministic one for a teammate reply. The Reply-To is the
 * conversation's signed reply address, so a reply routes back even without the headers.
 */
async function threading(
  db: Database,
  workspace: { id: string; slug: string },
  conversationId: string,
  message?: { id: string },
) {
  const keys = sql`${conversationMessages.createdAt}, ${conversationMessages.id}`;
  const rows = await db
    .select({
      id: conversationMessages.id,
      senderType: conversationMessages.senderType,
      emailMessageId: sql<
        string | null
      >`${conversationMessages.metadata} ->> 'emailMessageId'`,
    })
    .from(conversationMessages)
    .where(
      and(
        eq(
          conversationMessages.conversationId,
          conversationId as typeof conversations.$inferSelect.id,
        ),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt),
        // Compared in PostgreSQL, so microsecond timestamps keep their order.
        message
          ? sql`(${keys}) < (select ${keys} from ${conversationMessages} where ${eq(conversationMessages.id, message.id as MessageId)})`
          : undefined,
      ),
    )
    .orderBy(
      desc(conversationMessages.createdAt),
      desc(conversationMessages.id),
    )
    .limit(20);
  const references = rows
    .reverse()
    .flatMap((row) =>
      row.emailMessageId
        ? [row.emailMessageId]
        : row.senderType === "agent"
          ? [outboundMessageId(row.id) ?? []].flat()
          : [],
    );
  return {
    replyTo: replyAddress(workspace, conversationId) ?? undefined,
    messageId: message ? outboundMessageId(message.id) : undefined,
    inReplyTo: references.at(-1),
    references: references.length ? references : undefined,
  };
}

/**
 * The customer's mail copy of a teammate reply on an email conversation (or of a reply-all copy,
 * `target`). Read at send time: the message must still be a live, customer-visible agent message,
 * and the address is the conversation's captured address, else the customer's contact or profile
 * address.
 */
const replyMail: NonNullable<Subscribers["mail"]> = async (
  db,
  event,
  _principalId,
  target,
) => {
  const reply = await emailReply(db, event, target);
  if (!reply) {
    if (await portalReply(db, event, target)) {
      return portalReplyMail(db, event, target);
    }
    return widgetReplyMail(db, event, target);
  }
  const { message, conversation } = reply;
  const to = await visitorAddress(db, conversation);
  const workspace = await workspaceOf(db);
  if (!to || !workspace) return undefined;
  const from = await sendingIdentity(db, conversation);
  const thread = await threading(db, workspace, conversation.id, message);
  const stored = await messageFiles(db, message.id);
  const ctaUrl = await customerConversationLink(db, workspace.id, conversation);
  let attachments: EmailAttachment[] = [];
  return {
    type: "conversation_reply",
    emailType: "ConversationReplyEmail",
    to,
    conversationId: conversation.id,
    prepare: async () => {
      attachments = await loadMailAttachments(stored);
    },
    send: (address) =>
      sendConversationMessageEmail({
        // Sealed: the address read from the conversation and its visitor at send time.
        to: address as SealedEmail,
        direction: "agent_reply",
        attachments,
        senderName: message.author ?? workspace.name,
        messagePreview: clip(message.content, 500),
        ctaUrl,
        workspaceName: workspace.name,
        channel: "email",
        correspondence: true,
        conversationSubject: conversation.subject,
        conversationId: conversation.id,
        from,
        ...thread,
      }),
  };
};

/**
 * A teammate's reply on a portal conversation, decided at send time: the customer has not read it,
 * no newer reply exists (that one mails instead), the portal and support still admit the customer,
 * and the Kaneo account's address is verified. The mail links to the conversation page.
 */
async function portalReplyMail(
  db: Database,
  event: DeliveryEvent,
  target?: string,
) {
  const reply = await portalReply(db, event, target);
  const workspace = reply && (await workspaceOf(db));
  if (!reply || !workspace) return undefined;
  const { message, conversation } = reply;
  // Unread, and no newer reply (that one mails instead). In SQL: a JS Date drops microseconds.
  const newer = alias(conversationMessages, "newer");
  const [due] = await db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMessages.conversationId),
    )
    .where(
      and(
        eq(conversationMessages.id, message.id),
        sql`${conversationMessages.createdAt} > coalesce(${conversations.visitorLastReadAt}, '-infinity'::timestamptz)`,
        notExists(
          db
            .select({ id: newer.id })
            .from(newer)
            .where(
              and(
                eq(newer.conversationId, conversationMessages.conversationId),
                eq(newer.senderType, "agent"),
                eq(newer.isInternal, false),
                isNull(newer.deletedAt),
                gt(newer.createdAt, conversationMessages.createdAt),
              ),
            ),
        ),
      ),
    );
  if (!due) return undefined;
  // A customer who muted mail (the unsubscribe-all link) gets none.
  if (
    !(await wants(
      db,
      conversation.visitorPrincipalId,
      "conversation_reply",
      "email",
    ))
  )
    return undefined;
  const ctaUrl = await customerConversationLink(db, workspace.id, conversation);
  const account = ctaUrl
    ? await portalAccount(workspace.id, reply.account)
    : undefined;
  // An unverified account address may belong to someone else.
  const to = account?.emailVerified ? realEmail(account.email) : undefined;
  if (!account || !to) return undefined;
  try {
    await requireSurface(
      db,
      "portal",
      {
        principalId: conversation.visitorPrincipalId,
        customerId: reply.customerId,
        account,
      },
      "messenger",
    );
  } catch (error) {
    // A private portal that no longer admits the customer, or support turned off.
    if (error instanceof HTTPException) return undefined;
    throw error;
  }
  const from = await sendingIdentity(db, conversation);
  return {
    type: "conversation_reply",
    emailType: "ConversationMessageEmail",
    to,
    conversationId: conversation.id,
    send: (address: string) =>
      sendConversationMessageEmail({
        // Sealed: the verified account address read at send time.
        to: address as SealedEmail,
        direction: "agent_reply",
        senderName: message.author ?? workspace.name,
        messagePreview: clip(message.content, 500),
        ctaUrl,
        workspaceName: workspace.name,
        channel: conversation.channel,
        conversationSubject: conversation.subject,
        conversationId: conversation.id,
        from,
      }),
  };
}

/**
 * Chat-to-email continuation for offline widget visitors (#319):
 * After the quiet delay, if the visitor has NOT read the reply AND has no active presence
 * heartbeat in the last 60 seconds, mails the reply with Reply-To threading so they can
 * reply by email right back into the same widget thread, or click the signed resume link.
 */
async function widgetReplyMail(
  db: Database,
  event: DeliveryEvent,
  target?: string,
) {
  const reply = await widgetReply(db, event, target);
  const workspace = reply && (await workspaceOf(db));
  if (!reply || !workspace) return undefined;
  const { message, conversation, to } = reply;

  const { presenceStream } = await import("../../../database/quills/schema/kv");
  const { mintWidgetResumeToken } = await import("../../framework/signed");

  // Suppress email if the visitor is actively present in the widget right now.
  const [liveVisitor] = await db
    .select({ principalId: presenceStream.principalId })
    .from(presenceStream)
    .where(
      and(
        eq(presenceStream.principalId, conversation.visitorPrincipalId),
        eq(presenceStream.isAgent, false),
        gt(presenceStream.heartbeatAt, sql`now() - interval '60 seconds'`),
      ),
    )
    .limit(1);
  if (liveVisitor) return undefined;

  // Unread and no newer customer-visible agent reply exists.
  const newer = alias(conversationMessages, "newer_widget");
  const [due] = await db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .innerJoin(
      conversations,
      eq(conversations.id, conversationMessages.conversationId),
    )
    .where(
      and(
        eq(conversationMessages.id, message.id),
        sql`${conversationMessages.createdAt} > coalesce(${conversations.visitorLastReadAt}, '-infinity'::timestamptz)`,
        notExists(
          db
            .select({ id: newer.id })
            .from(newer)
            .where(
              and(
                eq(newer.conversationId, conversationMessages.conversationId),
                eq(newer.senderType, "agent"),
                eq(newer.isInternal, false),
                isNull(newer.deletedAt),
                gt(newer.createdAt, conversationMessages.createdAt),
              ),
            ),
        ),
      ),
    );
  if (!due) return undefined;

  if (
    !(await wants(
      db,
      conversation.visitorPrincipalId,
      "conversation_reply",
      "email",
    ))
  ) {
    return undefined;
  }

  const [wsSecretRow] = await db
    .select({ widgetSecret: settings.widgetSecret })
    .from(settings)
    .limit(1);
  const resumeToken = wsSecretRow?.widgetSecret
    ? mintWidgetResumeToken(
        workspace.id,
        conversation.id,
        conversation.visitorPrincipalId,
        wsSecretRow.widgetSecret,
      )
    : null;
  const ctaUrl = resumeToken
    ? `${portalPaths.home(workspace.id)}#quills_resume=${encodeURIComponent(resumeToken)}`
    : await customerConversationLink(db, workspace.id, conversation);

  const from = await sendingIdentity(db, conversation);
  const thread = await threading(db, workspace, conversation.id, message);

  return {
    type: "conversation_reply",
    emailType: "ConversationMessageEmail",
    to,
    conversationId: conversation.id,
    send: (address: string) =>
      sendConversationMessageEmail({
        to: address as SealedEmail,
        direction: "agent_reply",
        senderName: message.author ?? workspace.name,
        messagePreview: clip(message.content, 500),
        ctaUrl,
        workspaceName: workspace.name,
        channel: conversation.channel,
        conversationSubject: conversation.subject,
        conversationId: conversation.id,
        from,
        ...thread,
      }),
  };
}

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

/**
 * The copies that a tracker's reply-all wrote on its linked tickets: live, customer-visible
 * messages that repeat the event's tracker message. The request wrote every copy in the tracker
 * message's transaction, and created_at defaults to the transaction time, so each copy has the
 * tracker message's created_at exactly: the created_at index finds them. `only` checks one copy
 * by its primary key (a copy mail job).
 */
async function replyAllCopies(
  db: Database,
  event: DeliveryEvent,
  only?: string,
) {
  const { messageId, replyAll } = payloadOf(event);
  if (event.type !== "ticket.replied" || replyAll !== "true" || !messageId)
    return [];
  const [source] = await db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .innerJoin(tickets, eq(tickets.id, conversationMessages.ticketId))
    .where(
      and(
        eq(conversationMessages.id, messageId as MessageId),
        eq(tickets.id, event.entityId as TicketId),
        eq(tickets.type, "tracker"),
      ),
    );
  if (!source) return [];
  const tracker = alias(conversationMessages, "tracker_message");
  const sourceTime = db
    .select({ at: tracker.createdAt })
    .from(tracker)
    .where(eq(tracker.id, source.id));
  // ponytail: at most 1,000 linked tickets per reply-all are mailed; page if trackers grow past it.
  return db
    .select({
      id: conversationMessages.id,
      conversationId: conversationMessages.conversationId,
      ticketId: conversationMessages.ticketId,
    })
    .from(conversationMessages)
    .where(
      and(
        only
          ? eq(conversationMessages.id, only as MessageId)
          : sql`${conversationMessages.createdAt} = (${sourceTime})`,
        sql`${conversationMessages.metadata} ->> 'repliedAllFromMessageId' = ${messageId}`,
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt),
      ),
    )
    .orderBy(conversationMessages.id)
    .limit(1000);
}

/**
 * The linked customer tickets that a tracker's event reaches: the tickets of its reply-all copies,
 * or, for a status move, the linked tickets that are now in the status it set (the cascade moved
 * them in the same transaction). Empty for any other event.
 */
export async function trackerTargets(
  db: Database,
  event: DeliveryEvent,
): Promise<TicketId[]> {
  if (event.entityType !== "ticket") return [];
  if (event.type === "ticket.replied") {
    const copies = await replyAllCopies(db, event);
    const pairs = copies.flatMap((copy) =>
      copy.conversationId ? [copy.conversationId] : [],
    );
    const paired = pairs.length
      ? await db
          .select({ id: ticketConversations.ticketId })
          .from(ticketConversations)
          .where(
            and(
              inArray(ticketConversations.conversationId, pairs),
              eq(ticketConversations.ticketType, "customer"),
            ),
          )
      : [];
    return [
      ...new Set([
        ...copies.flatMap((copy) => (copy.ticketId ? [copy.ticketId] : [])),
        ...paired.map((row) => row.id),
      ]),
    ];
  }
  const statusId = payloadOf(event).statusId;
  if (event.type !== "ticket.status_changed" || !statusId) return [];
  const linked = alias(tickets, "linked");
  const rows = await db
    .select({ id: linked.id })
    .from(ticketLinks)
    .innerJoin(tickets, eq(tickets.id, ticketLinks.trackerTicketId))
    .innerJoin(linked, eq(linked.id, ticketLinks.linkedTicketId))
    .where(
      and(
        eq(ticketLinks.trackerTicketId, event.entityId as TicketId),
        eq(ticketLinks.relation, "tracks"),
        eq(tickets.type, "tracker"),
        eq(linked.type, "customer"),
        eq(linked.statusId, statusId as TicketRow["statusId"]),
        isNull(linked.deletedAt),
      ),
    )
    .limit(1000);
  return rows.map((row) => row.id);
}

/**
 * The email conversation that a `conversation.status_changed` event closed, while its customer may
 * still be asked for a rating: closed, not spam, not rated, and not closed by the customer.
 */
async function csatConversation(db: Database, event: DeliveryEvent) {
  if (
    event.entityType !== "conversation" ||
    payloadOf(event).status !== "closed"
  )
    return undefined;
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      eq(
        conversations.id,
        event.entityId as typeof conversations.$inferSelect.id,
      ),
    );
  if (
    conversation?.channel !== "email" ||
    conversation.status !== "closed" ||
    conversation.endReason === "spam" ||
    conversation.csatRating !== null ||
    event.actorId === conversation.visitorPrincipalId
  )
    return undefined;
  // As in the source: a conversation asked once (in the mail log) is not asked again.
  const [asked] = await db
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.conversationId, conversation.id),
        eq(emailLog.emailType, "CsatRequestEmail"),
      ),
    )
    .limit(1);
  return asked ? undefined : conversation;
}

/** Support entries for jobs/fanout.ts#subscribers. */
export const supportSubscribers: Partial<Record<string, Subscribers>> = {
  "message.created": {
    recipients: noRecipients,
    // Decided at fan-out, so a visitor message, a note or a widget visitor's reply queues no mail
    // job. A portal reply's job waits, and runs only if the customer has not read it by then.
    direct: async (db, event) => Boolean(await customerReply(db, event)),
    directDelay: replyDelay,
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
    direct: async (db, event) => Boolean(await customerReply(db, event)),
    directDelay: replyDelay,
    // A tracker's reply-all: one mail per copy on an email pair or portal ticket, keyed by the copy.
    copies: async (db, event, only) => {
      const mailed: string[] = [];
      for (const copy of await replyAllCopies(db, event, only))
        if (await customerReply(db, event, copy.id)) mailed.push(copy.id);
      return mailed;
    },
    notification: watcherNotice((ref) => `New reply on ticket ${ref}`),
    mail: replyMail,
  },
  // The CSAT rating request when an email conversation closes (the source's close mail carries
  // the rating links). One per conversation: its ledger key names the conversation, not the event.
  "conversation.status_changed": {
    recipients: noRecipients,
    direct: async (db, event) => Boolean(await csatConversation(db, event)),
    mail: async (db, event) => {
      const conversation = await csatConversation(db, event);
      const workspace = conversation && (await workspaceOf(db));
      const to = conversation && (await visitorAddress(db, conversation));
      if (!conversation || !workspace || !to) return undefined;
      // ponytail: a replay of a finished delivery mints a token it never sends; it expires in 30 days.
      const token = await mintCsatToken(
        db,
        conversation.id,
        conversation.visitorPrincipalId,
      );
      const from = await sendingIdentity(db, conversation);
      return {
        type: "csat_request",
        emailType: "CsatRequestEmail",
        to,
        conversationId: conversation.id,
        ledgerKey: `mail:csat:${conversation.id}`,
        send: (address) =>
          sendCsatRequestEmail({
            to: address,
            promptText: "How would you rate the help you received?",
            ratingUrls: csatRatingUrls(workspace.id, token),
            workspaceName: workspace.name,
            from,
            conversationId: conversation.id,
          }),
      };
    },
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
