import { and, desc, eq, sql } from "drizzle-orm";
import { createId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, pagingNumber, z } from "../../../openapi";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { defineQuillsRoute } from "../../framework/define-route";
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
    rateLimit: { limit: 20, windowSeconds: 600 },
    body: z.object({ content: messageText, idempotencyKey }),
    response: sent,
    responseDescription: "The new conversation and its first message",
    errors: sendErrors,
    event: (_input, result) =>
      !result.replayed && {
        type: "conversation.created",
        entityType: "conversation",
        entityId: result.conversation.id,
        payload: { messageId: result.message.id },
      },
    handler: async ({ db, caller, body }) => {
      await requireSurface(db, audience, caller, "messenger");
      const me = caller.principalId!;
      const receipt = await claimReceipt(
        db,
        me,
        "new",
        body.idempotencyKey,
        body.content,
        {
          conversationId: createId("conversation"),
          messageId: createId("conversation_message"),
        },
      );
      if (receipt.claimed) {
        const [created] = await db
          .insert(conversations)
          .values({
            id: receipt.conversationId,
            visitorPrincipalId: me,
            channel: "messenger",
            source: widget ? "widget" : "portal",
            status: "open",
            subject: body.content.slice(0, 140),
          })
          .returning();
        await insertVisitorMessage(
          db,
          me,
          created!,
          receipt.messageId,
          body.content,
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
    body: z.object({ content: messageText, idempotencyKey }),
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
        body.content,
        {
          conversationId: conversation.id,
          messageId: createId("conversation_message"),
        },
      );
      if (receipt.claimed)
        await insertVisitorMessage(
          db,
          me,
          conversation,
          receipt.messageId,
          body.content,
        );
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

  return apiRouter()
    .openapi(...list)
    .openapi(...unread)
    .openapi(...start)
    .openapi(...get)
    .openapi(...listMessages)
    .openapi(...send)
    .openapi(...markRead)
    .openapi(...typing)
    .openapi(...csat);
}
