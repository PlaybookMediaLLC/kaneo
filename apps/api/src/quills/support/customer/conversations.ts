import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { createId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  pagingNumber,
  responseTimestamp,
  z,
} from "../../../openapi";
import { assistantInvolvements } from "../../../database/quills/schema/assistant";
import {
  principal,
  settings,
  user as customer,
} from "../../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { files } from "../../../database/quills/schema/files";
import { looksLikeSpam } from "../../feedback/content-checks";
import {
  challengeInputSchema,
  enforceWidgetAntiSpam,
  isTrustedSender,
} from "../../framework/anti-spam";
import { defineQuillsRoute } from "../../framework/define-route";
import { createDownload } from "../../framework/files";
import { widgetMetadata } from "../../portal/feedback/posts";
import { CUSTOMER_SOURCES } from "../../portal/feedback/attachments";
import { attachmentIds, attachMessageFiles } from "../message-attachments";
import {
  claimReceipt,
  conversationParams,
  cursorMessage,
  customerConversationSchema,
  customerMessageSchema,
  idempotencyKey,
  insertVisitorMessage,
  isTyping,
  messageText,
  notFound,
  ownConversation,
  recordCsat,
  requireSurface,
  selectCustomerMessages,
  signalTyping,
  toConversations,
  toMessages,
  unreadTotal,
  type ConversationId,
  type Customer,
  type MessageId,
  type PrincipalId,
} from "./model";
import { sendAwayReply } from "../away-reply";
import { rememberSender } from "../ip-blocks";
import { posts } from "../../../database/quills/schema/posts";
import { HTTPException } from "hono/http-exception";

// The customer's own conversations, for the widget (`/widget/...`, widget session) and the portal
// (`/support/...`, Kaneo session). Messages are plain text. Replies and notices reach the customer
// through these reads; the delivery worker only signals that something changed.

const errors = { 404: "Conversation, message or support surface not found" };
const sendErrors = { ...errors, 409: "Idempotency key conflict" };
const sent = z.object({
  message: customerMessageSchema,
  conversation: customerConversationSchema,
  /** True when this key already sent the message: nothing new was written. */
  replayed: z.boolean(),
});
const PAGE = 30;
/** The widget's host-page context, kept with the visitor's message. */
const messageMetadata = widgetMetadata.describe(
  "Context from the host page, such as pageUrl and browser, and keys that the host app set with the widget's metadata command. Stored with the message for the team; never returned to the visitor.",
);
/** What a receipt hashes: the text and the attached files, so a retry with other files is a conflict. */
const receiptText = (body: {
  content: string;
  attachmentIds: readonly string[];
}) =>
  body.attachmentIds.length
    ? `${body.content}\u0000${body.attachmentIds.join(",")}`
    : body.content;
const metadataOf = (body: object) =>
  (body as { metadata?: Record<string, string> }).metadata;

/** Builds the conversation routes of one customer audience. */
export function conversationRoutes(audience: Customer) {
  const widget = audience === "widget";
  const base = widget ? "/widget" : "/support";
  const name = (forWidget: string, forPortal: string) =>
    widget ? forWidget : forPortal;
  const who = widget ? "the widget visitor" : "the signed-in customer";
  // Portal writes create the account's customer profile; a widget session already has one.
  const writer = widget ? {} : { ensureCustomer: true };

  async function loadSent(
    db: Parameters<typeof ownConversation>[0],
    me: PrincipalId,
    conversationId: ConversationId,
    messageId: MessageId,
    replayed: boolean,
  ) {
    const conversation = await ownConversation(db, me, conversationId);
    const [row] = await selectCustomerMessages(
      db,
      me,
      eq(conversationMessages.id, messageId),
    );
    if (!row) throw notFound("Message");
    return {
      message: toMessages([row])[0]!,
      conversation: (await toConversations(db, me, [conversation]))[0]!,
      replayed,
    };
  }

  const list = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/conversations`,
    operationId: name(
      "listQuillsWidgetConversations",
      "listQuillsMyConversations",
    ),
    summary: `List the conversations of ${who}`,
    description:
      "Newest activity first. `cursor` is the last conversation of the previous page. A caller with no customer profile yet has none.",
    action: "read",
    query: z.object({
      cursor: flexibleToTypeIdSchema("conversation").optional(),
      limit: pagingNumber(1, 50, 20),
    }),
    response: z.object({
      items: z.array(customerConversationSchema),
      nextCursor: z.string().nullable(),
    }),
    responseDescription: "One page of the caller's conversations",
    errors,
    handler: async ({ db, caller, query }) => {
      await requireSurface(db, audience, caller, "messenger");
      const me = caller.principalId;
      if (!me) return { items: [], nextCursor: null };
      // The cursor must be the caller's own conversation.
      if (query.cursor) await ownConversation(db, me, query.cursor);
      const keys = sql`${conversations.lastMessageAt}, ${conversations.id}`;
      const rows = await db
        .select()
        .from(conversations)
        .where(
          and(
            eq(conversations.visitorPrincipalId, me),
            query.cursor
              ? sql`(${keys}) < (select ${keys} from ${conversations} where ${eq(conversations.id, query.cursor)})`
              : undefined,
          ),
        )
        .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
        .limit(query.limit + 1);
      const items = await toConversations(db, me, rows.slice(0, query.limit));
      return {
        items,
        nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
      };
    },
  });

  const messagesResponse = z.object({
    items: z.array(customerMessageSchema),
    hasMore: z.boolean(),
  });

  /** One page in reading order. `after` reads newer messages, else the latest or those `before`. */
  async function page(
    db: Parameters<typeof ownConversation>[0],
    me: PrincipalId,
    conversationId: ConversationId,
    cursor: { before?: MessageId; after?: MessageId },
    limit: number,
  ) {
    const keys = sql`(${conversationMessages.createdAt}, ${conversationMessages.id})`;
    const at = async (id: MessageId) => {
      await cursorMessage(db, conversationId, id);
      return sql`(select ${conversationMessages.createdAt}, ${conversationMessages.id} from ${conversationMessages} where ${eq(conversationMessages.id, id)})`;
    };
    const newer = Boolean(cursor.after);
    if (cursor.after) await cursorMessage(db, conversationId, cursor.after);
    const rows = await selectCustomerMessages(
      db,
      me,
      and(
        eq(conversationMessages.conversationId, conversationId),
        // created_at is the writer's transaction start, so a message that commits after the
        // cursor can carry an earlier time. `after` also returns the 30 seconds before the
        // cursor; the client merges by message ID.
        cursor.after
          ? sql`${conversationMessages.createdAt} > (select ${conversationMessages.createdAt} - interval '30 seconds' from ${conversationMessages} where ${eq(conversationMessages.id, cursor.after)}) and ${conversationMessages.id} <> ${sql.param(cursor.after, conversationMessages.id)}`
          : undefined,
        cursor.before ? sql`${keys} < ${await at(cursor.before)}` : undefined,
      ),
    )
      .orderBy(
        ...(newer
          ? [conversationMessages.createdAt, conversationMessages.id]
          : [
              desc(conversationMessages.createdAt),
              desc(conversationMessages.id),
            ]),
      )
      .limit(limit + 1);
    const items = toMessages(rows.slice(0, limit));
    return {
      items: newer ? items : items.reverse(),
      hasMore: rows.length > limit,
    };
  }

  const get = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/conversations/{conversationId}`,
    operationId: name("getQuillsWidgetConversation", "getQuillsMyConversation"),
    summary: `Get a conversation of ${who} with its latest messages`,
    description:
      "Messages are in reading order, oldest first; hasMore means older ones exist. teamTyping is true for a few seconds after a teammate types.",
    action: "read",
    params: conversationParams,
    response: z.object({
      conversation: customerConversationSchema,
      messages: z.array(customerMessageSchema),
      hasMore: z.boolean(),
      teamTyping: z.boolean(),
    }),
    responseDescription: "The conversation",
    errors,
    handler: async ({ db, caller, params }) => {
      await requireSurface(db, audience, caller, "messenger");
      const me = caller.principalId;
      const conversation = await ownConversation(db, me, params.conversationId);
      const { items, hasMore } = await page(db, me!, conversation.id, {}, PAGE);
      return {
        conversation: (await toConversations(db, me!, [conversation]))[0]!,
        messages: items,
        hasMore,
        teamTyping: await isTyping(db, conversation.id, "agent"),
      };
    },
  });

  const file = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/conversations/{conversationId}/files/{fileId}`,
    operationId: name(
      "getQuillsWidgetConversationFile",
      "getQuillsMyConversationFile",
    ),
    summary: `Get a file of a conversation of ${who} and a short-lived download URL`,
    description:
      "Only a file of a live message that the customer reads: never one of an internal note, of a deleted message or of another conversation.",
    action: "read",
    params: conversationParams.extend({
      fileId: flexibleToTypeIdSchema("file"),
    }),
    response: z.object({
      id: z.string(),
      name: z.string(),
      contentType: z.string(),
      size: z.number(),
      downloadUrl: z.string(),
      downloadExpiresAt: responseTimestamp,
    }),
    responseDescription: "The file",
    errors,
    handler: async ({ db, caller, params }) => {
      await requireSurface(db, audience, caller, "messenger");
      const conversation = await ownConversation(
        db,
        caller.principalId,
        params.conversationId,
      );
      const [row] = await db
        .select({
          id: files.id,
          name: files.name,
          contentType: files.contentType,
          size: files.size,
          storageKey: files.storageKey,
        })
        .from(files)
        .innerJoin(
          conversationMessages,
          eq(conversationMessages.id, files.messageId),
        )
        .where(
          and(
            eq(files.id, params.fileId),
            isNull(files.deletedAt),
            eq(conversationMessages.conversationId, conversation.id),
            eq(conversationMessages.isInternal, false),
            isNull(conversationMessages.deletedAt),
          ),
        )
        .limit(1);
      if (!row) throw notFound("File");
      const { id, name, contentType, size } = row;
      return { id, name, contentType, size, ...(await createDownload(row)) };
    },
  });

  const listMessages = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/conversations/{conversationId}/messages`,
    operationId: name(
      "listQuillsWidgetConversationMessages",
      "listQuillsMyConversationMessages",
    ),
    summary: `List the messages of a conversation of ${who}`,
    description:
      "Reading order, oldest first. `before` pages back. `after` returns newer messages and also the 30 seconds before the cursor, because a message that commits late can carry an earlier time: merge by message ID. It is how a client without a push channel catches up. Each cursor is a message of this conversation.",
    action: "read",
    params: conversationParams,
    query: z.object({
      before: flexibleToTypeIdSchema("conversation_msg").optional(),
      after: flexibleToTypeIdSchema("conversation_msg").optional(),
      limit: pagingNumber(1, 100, PAGE),
    }),
    response: messagesResponse,
    responseDescription: "One page of messages",
    errors,
    handler: async ({ db, caller, params, query }) => {
      await requireSurface(db, audience, caller, "messenger");
      const conversation = await ownConversation(
        db,
        caller.principalId,
        params.conversationId,
      );
      return page(db, caller.principalId!, conversation.id, query, query.limit);
    },
  });

  const start = defineQuillsRoute({
    audience,
    ...writer,
    method: "post",
    path: `${base}/conversations`,
    operationId: name(
      "startQuillsWidgetConversation",
      "startQuillsMyConversation",
    ),
    summary: `Start a conversation as ${who}`,
    description:
      "Creates the conversation and its first message. A retry with the same idempotencyKey and text returns the first result; other text with that key is 409.",
    action: "create",
    rateLimit: { limit: widget ? 500 : 20, windowSeconds: 600 },
    body: z.object({
      content: messageText,
      idempotencyKey,
      /** The visitor's own uploads (POST /uploads, then /files), at most 10. */
      attachmentIds,
      ...(widget && {
        metadata: messageMetadata,
        challenge: challengeInputSchema.optional(),
      }),
    }),
    response: sent,
    responseDescription: "The new conversation and its first message",
    errors: {
      ...sendErrors,
      ...(widget && {
        403: "Anti-spam challenge required or failed, or origin/sender blocked",
      }),
    },
    event: (_input, result) =>
      !result.replayed && {
        type: "conversation.created",
        entityType: "conversation",
        entityId: result.conversation.id,
        payload: { messageId: result.message.id },
      },
    handler: async ({ db, workspaceId, caller, body, request }) => {
      await requireSurface(db, audience, caller, "messenger");
      const me = caller.principalId!;
      const [cfgRow] = await db
        .select({
          widgetConfig: settings.widgetConfig,
          spamFilterConfig: settings.spamFilterConfig,
        })
        .from(settings)
        .limit(1);
      const receipt = await claimReceipt(
        db,
        me,
        "new",
        body.idempotencyKey,
        receiptText(body),
        {
          conversationId: createId("conversation"),
          messageId: createId("conversation_message"),
        },
      );
      if (receipt.claimed) {
        if (widget) {
          const bodyChallenge = (
            body as { challenge?: z.output<typeof challengeInputSchema> }
          ).challenge;
          await enforceWidgetAntiSpam(db, {
            workspaceId,
            widgetConfig: cfgRow?.widgetConfig,
            kind: "conversation",
            ip: request.ip,
            sessionId: me,
            challenge: bodyChallenge ?? request.challenge,
          });
        }
        const [senderRow] = await db
          .select({
            contactEmail: principal.contactEmail,
            userEmail: customer.email,
          })
          .from(principal)
          .leftJoin(customer, eq(customer.id, principal.userId))
          .where(eq(principal.id, me))
          .limit(1);
        const senderEmail = senderRow?.userEmail ?? senderRow?.contactEmail;
        const quarantined =
          !isTrustedSender(cfgRow?.spamFilterConfig, senderEmail) &&
          looksLikeSpam(body.content);
        const [created] = await db
          .insert(conversations)
          .values({
            id: receipt.conversationId,
            visitorPrincipalId: me,
            channel: "messenger",
            source: widget ? "widget" : "portal",
            status: quarantined ? "closed" : "open",
            ...(quarantined && {
              endReason: "spam",
              spamReason: "heuristic",
              resolvedAt: new Date(),
            }),
            subject: body.content.slice(0, 140),
          })
          .returning();
        await insertVisitorMessage(
          db,
          me,
          created!,
          receipt.messageId,
          body.content,
          metadataOf(body),
        );
        await rememberSender(db, created!.id, request.ip);
        if (!quarantined) {
          await sendAwayReply(db, created!.id);
        }
        await attachMessageFiles(
          db,
          me,
          receipt.messageId,
          body.attachmentIds,
          CUSTOMER_SOURCES,
        );
      }
      return loadSent(
        db,
        me,
        receipt.conversationId,
        receipt.messageId,
        !receipt.claimed,
      );
    },
  });

  const send = defineQuillsRoute({
    audience,
    ...writer,
    method: "post",
    path: `${base}/conversations/{conversationId}/messages`,
    operationId: name(
      "sendQuillsWidgetConversationMessage",
      "sendQuillsMyConversationMessage",
    ),
    summary: `Send a message in a conversation of ${who}`,
    description:
      "Reopens a closed or snoozed conversation, except one ended as spam. A retry with the same idempotencyKey and text returns the first result; other text with that key is 409.",
    action: "update",
    rateLimit: { limit: 60, windowSeconds: 600 },
    params: conversationParams,
    body: z.object({
      content: messageText,
      idempotencyKey,
      /** The visitor's own uploads (POST /uploads, then /files), at most 10. */
      attachmentIds,
      ...(widget && { metadata: messageMetadata }),
    }),
    response: sent,
    responseDescription: "The message and the updated conversation",
    errors: sendErrors,
    event: (_input, result) =>
      !result.replayed && {
        type: "message.created",
        entityType: "conversation_message",
        entityId: result.message.id,
        payload: { conversationId: result.conversation.id },
      },
    handler: async ({ db, caller, params, body }) => {
      await requireSurface(db, audience, caller, "messenger");
      const me = caller.principalId!;
      const conversation = await ownConversation(
        db,
        me,
        params.conversationId,
        true,
      );
      const receipt = await claimReceipt(
        db,
        me,
        conversation.id,
        body.idempotencyKey,
        receiptText(body),
        {
          conversationId: conversation.id,
          messageId: createId("conversation_message"),
        },
      );
      if (receipt.claimed) {
        await insertVisitorMessage(
          db,
          me,
          conversation,
          receipt.messageId,
          body.content,
          metadataOf(body),
        );
        // Honest resolution tracking (#302): a customer follow-up after an assumed or confirmed
        // assistant resolution marks the involvement as reopened so resolution rates stay truthful.
        await db
          .update(assistantInvolvements)
          .set({ reopenedAfterResolutionAt: new Date() })
          .where(
            and(
              eq(assistantInvolvements.conversationId, conversation.id),
              inArray(assistantInvolvements.status, [
                "resolved_confirmed",
                "resolved_assumed",
              ]),
              isNull(assistantInvolvements.reopenedAfterResolutionAt),
            ),
          );
        await sendAwayReply(db, conversation.id);
        await attachMessageFiles(
          db,
          me,
          receipt.messageId,
          body.attachmentIds,
          CUSTOMER_SOURCES,
        );
      }
      return loadSent(
        db,
        me,
        conversation.id,
        receipt.messageId,
        !receipt.claimed,
      );
    },
  });

  const markRead = defineQuillsRoute({
    audience,
    ...writer,
    method: "put",
    path: `${base}/conversations/{conversationId}/read`,
    operationId: name(
      "markQuillsWidgetConversationRead",
      "markQuillsMyConversationRead",
    ),
    summary: `Mark a conversation of ${who} read through a message`,
    description:
      "The watermark only moves forward: a late acknowledgment of an older message never marks a newer team reply read.",
    action: "update",
    params: conversationParams,
    body: z.object({
      throughMessageId: flexibleToTypeIdSchema("conversation_msg"),
    }),
    response: z.object({ unreadCount: z.number(), changed: z.boolean() }),
    responseDescription: "The conversation's unread count after the change",
    errors,
    event: { none: "A read marker is the customer's own view state" },
    handler: async ({ db, caller, params, body }) => {
      await requireSurface(db, audience, caller, "messenger");
      const me = caller.principalId!;
      const conversation = await ownConversation(
        db,
        me,
        params.conversationId,
        true,
      );
      const through = await cursorMessage(
        db,
        conversation.id,
        body.throughMessageId,
      );
      // The stored microsecond time, not the millisecond JS Date, or the message itself stays unread.
      const at = sql`(select ${conversationMessages.createdAt} from ${conversationMessages} where ${eq(conversationMessages.id, through.id)})`;
      const changed = await db
        .update(conversations)
        .set({ visitorLastReadAt: at })
        .where(
          and(
            eq(conversations.id, conversation.id),
            sql`coalesce(${conversations.visitorLastReadAt}, '-infinity'::timestamptz) < ${at}`,
          ),
        )
        .returning({ id: conversations.id });
      const [after] = await toConversations(db, me, [
        await ownConversation(db, me, conversation.id),
      ]);
      return { unreadCount: after!.unreadCount, changed: changed.length > 0 };
    },
  });

  const unread = defineQuillsRoute({
    audience,
    method: "get",
    path: `${base}/unread`,
    operationId: name("getQuillsWidgetUnreadCount", "getQuillsMyUnreadCount"),
    summary: `Count the unread team messages of ${who}`,
    description:
      "Team messages after the read watermark, across all of the caller's conversations. The launcher badge polls this.",
    action: "read",
    response: z.object({ unreadCount: z.number() }),
    responseDescription: "The unread count",
    errors,
    handler: async ({ db, caller }) => {
      await requireSurface(db, audience, caller, "messenger");
      return { unreadCount: await unreadTotal(db, caller.principalId) };
    },
  });

  const typing = defineQuillsRoute({
    audience,
    ...writer,
    method: "post",
    path: `${base}/conversations/{conversationId}/typing`,
    operationId: name(
      "sendQuillsWidgetConversationTyping",
      "sendQuillsMyConversationTyping",
    ),
    summary: `Signal that ${who} is typing`,
    description:
      "A bounded write: one marker per conversation side that lapses after 8 seconds. Teammates read it with getQuillsConversationTyping.",
    action: "update",
    rateLimit: { limit: 120, windowSeconds: 600 },
    params: conversationParams,
    response: z.object({ ok: z.literal(true) }),
    responseDescription: "The signal is stored",
    errors,
    event: { none: "Ephemeral: the marker lapses after a few seconds" },
    handler: async ({ db, caller, params }) => {
      await requireSurface(db, audience, caller, "messenger");
      const conversation = await ownConversation(
        db,
        caller.principalId,
        params.conversationId,
      );
      await signalTyping(db, conversation.id, "visitor");
      return { ok: true as const };
    },
  });

  const csat = defineQuillsRoute({
    audience,
    ...writer,
    method: "post",
    path: `${base}/conversations/{conversationId}/csat`,
    operationId: name("submitQuillsWidgetCsat", "submitQuillsCsat"),
    summary: `Rate a conversation of ${who}`,
    description:
      "The first rating and its time stay; a later call may add the comment once. A repeat that adds nothing records no event.",
    action: "update",
    rateLimit: { limit: 30, windowSeconds: 600 },
    params: conversationParams,
    body: z.object({
      rating: z.number().int().min(1).max(5),
      comment: z.string().max(2000).optional(),
    }),
    response: z.object({ rating: z.number(), changed: z.boolean() }),
    responseDescription: "The stored rating",
    errors,
    event: ({ params }, result) =>
      result.changed && {
        type: "conversation.csat_submitted",
        entityType: "conversation",
        entityId: params.conversationId,
        payload: { rating: String(result.rating) },
      },
    handler: async ({ db, caller, params, body }) => {
      await requireSurface(db, audience, caller, "messenger");
      const conversation = await ownConversation(
        db,
        caller.principalId,
        params.conversationId,
        true,
      );
      return recordCsat(db, conversation, body.rating, body.comment);
    },
  });

  // Gap G-31: the visitor posted the customer agent's proposed request with the feedback route,
  // and marks the card with that post. Each card is confirmed once, only with the visitor's post.
  const confirmCard = defineQuillsRoute({
    audience,
    ...writer,
    method: "put",
    path: `${base}/conversations/{conversationId}/messages/{messageId}/feedback-card`,
    operationId: name(
      "confirmQuillsWidgetFeedbackCard",
      "confirmQuillsFeedbackCard",
    ),
    summary: `Confirm the feedback request that the assistant proposed to ${who}`,
    description:
      "postId is the caller's own post made from the card. A card that is confirmed already answers 409.",
    action: "update",
    rateLimit: { limit: 30, windowSeconds: 600 },
    params: conversationParams.extend({
      messageId: flexibleToTypeIdSchema("conversation_msg"),
    }),
    body: z.object({ postId: flexibleToTypeIdSchema("post") }),
    response: z.object({ message: customerMessageSchema }),
    responseDescription: "The message with its confirmed card",
    errors: { ...errors, 409: "The card is confirmed already" },
    event: ({ params }) => ({
      type: "message.updated",
      entityType: "conversation_message",
      entityId: params.messageId,
      payload: { conversationId: params.conversationId },
    }),
    handler: async ({ db, caller, params, body }) => {
      await requireSurface(db, audience, caller, "messenger");
      const me = caller.principalId!;
      const conversation = await ownConversation(db, me, params.conversationId);
      const [row] = await db
        .select({ metadata: conversationMessages.metadata })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.id, params.messageId),
            eq(conversationMessages.conversationId, conversation.id),
            eq(conversationMessages.isInternal, false),
            isNull(conversationMessages.deletedAt),
          ),
        )
        .for("update");
      const card = row?.metadata?.feedbackCard;
      if (!card) throw notFound("Feedback card");
      if (card.status === "confirmed")
        throw new HTTPException(409, {
          message: "The card is confirmed already",
        });
      const [post] = await db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.id, body.postId), eq(posts.principalId, me)));
      if (!post) throw notFound("Post");
      await db
        .update(conversationMessages)
        .set({
          metadata: {
            ...row!.metadata,
            feedbackCard: { ...card, status: "confirmed", postId: post.id },
          },
        })
        .where(eq(conversationMessages.id, params.messageId));
      const [updated] = await selectCustomerMessages(
        db,
        me,
        eq(conversationMessages.id, params.messageId),
      );
      return { message: toMessages([updated!])[0]! };
    },
  });

  const resolutionFeedback = defineQuillsRoute({
    audience,
    ...writer,
    method: "post",
    path: `${base}/conversations/{conversationId}/resolution-feedback`,
    operationId: name(
      "submitQuillsWidgetResolutionFeedback",
      "submitQuillsResolutionFeedback",
    ),
    summary: `Confirm whether the assistant resolved a conversation of ${who}`,
    description:
      "Records explicit customer confirmation (resolved: true -> resolved_confirmed) or rejection (resolved: false -> handed_off with reopenedAfterResolutionAt stamped).",
    action: "update",
    rateLimit: { limit: 30, windowSeconds: 600 },
    params: conversationParams,
    body: z.object({ resolved: z.boolean() }),
    response: z.object({
      involvementId: z.string(),
      status: z.enum([
        "active",
        "handed_off",
        "resolved_confirmed",
        "resolved_assumed",
        "abandoned",
      ]),
    }),
    responseDescription: "Updated assistant involvement status",
    errors,
    event: (_input, result) => ({
      type: "assistant.resolution_feedback_recorded",
      entityType: "assistant_involvement",
      entityId: result.involvementId,
      payload: { status: result.status },
    }),
    handler: async ({ db, caller, params, body }) => {
      await requireSurface(db, audience, caller, "messenger");
      const conversation = await ownConversation(
        db,
        caller.principalId,
        params.conversationId,
        true,
      );
      const [latest] = await db
        .select({
          id: assistantInvolvements.id,
          status: assistantInvolvements.status,
          endedAt: assistantInvolvements.endedAt,
        })
        .from(assistantInvolvements)
        .where(eq(assistantInvolvements.conversationId, conversation.id))
        .orderBy(desc(assistantInvolvements.createdAt))
        .limit(1)
        .for("update");
      if (!latest) throw notFound("Assistant involvement");
      const now = new Date();
      if (body.resolved) {
        await db
          .update(assistantInvolvements)
          .set({
            status: "resolved_confirmed",
            endedAt: latest.endedAt ?? now,
          })
          .where(eq(assistantInvolvements.id, latest.id));
        return {
          involvementId: latest.id,
          status: "resolved_confirmed" as const,
        };
      }
      await db
        .update(assistantInvolvements)
        .set({
          status: "handed_off",
          handoffReason: "explicit_request",
          endedAt: latest.endedAt ?? now,
          reopenedAfterResolutionAt: now,
        })
        .where(eq(assistantInvolvements.id, latest.id));
      if (conversation.endReason !== "spam") {
        await db
          .update(conversations)
          .set({
            status: "open",
            waitingSince: sql`coalesce(${conversations.waitingSince}, now())`,
            updatedAt: now,
          })
          .where(eq(conversations.id, conversation.id));
      }
      return { involvementId: latest.id, status: "handed_off" as const };
    },
  });

  return apiRouter()
    .openapi(...list)
    .openapi(...unread)
    .openapi(...start)
    .openapi(...get)
    .openapi(...listMessages)
    .openapi(...file)
    .openapi(...send)
    .openapi(...markRead)
    .openapi(...typing)
    .openapi(...csat)
    .openapi(...confirmCard)
    .openapi(...resolutionFeedback);
}
