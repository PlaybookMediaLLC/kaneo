import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import {
  apiRouter,
  nullableResponseTimestamp,
  pagingNumber,
  responseTimestamp,
  z,
  type BaseVariables,
} from "../../openapi";
import {
  conversationMessageFlags,
  conversationMessageMentions,
  conversationMessageReactions,
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { defineQuillsRoute } from "../framework/define-route";
import { memberUserIds } from "../framework/platform-reads";
import {
  conflict,
  conversationItem,
  conversationParams,
  currentTeammates,
  errors,
  findConversation,
  loadConversation,
  messageParams,
  messageText,
  notFound,
  preview,
} from "./conversation-model";
import { insertReply } from "./conversation-ops";
import {
  findContentMessage,
  findMessage,
  loadMessage,
  messageSchema,
  reactionEmojis,
  reactionsFor,
  selectMessages,
  toMessages,
} from "./message-model";

const listMessages = defineQuillsRoute({
  method: "get",
  path: "/conversations/{conversationId}/messages",
  operationId: "listQuillsConversationMessages",
  summary: "List a conversation's messages, newest first",
  description:
    "Internal notes and team-only notices appear only with includeInternal=true. Deleted messages are left out. `before` is a message of this conversation.",
  action: "read",
  params: conversationParams,
  query: z.object({
    includeInternal: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    before: flexibleToTypeIdSchema("conversation_msg").optional(),
    limit: pagingNumber(1, 100, 30),
  }),
  response: z.object({
    items: z.array(messageSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
  responseDescription: "One page of messages",
  errors,
  handler: async ({ db, actor, params, query }) => {
    const conversation = await findConversation(db, params.conversationId);
    if (query.before) {
      const cursor = await findMessage(db, query.before);
      if (cursor.conversationId !== conversation.id) throw notFound("Message");
    }
    const keys = sql`${conversationMessages.createdAt}, ${conversationMessages.id}`;
    const rows = await selectMessages(
      db,
      and(
        eq(conversationMessages.conversationId, conversation.id),
        isNull(conversationMessages.deletedAt),
        query.includeInternal
          ? undefined
          : eq(conversationMessages.isInternal, false),
        query.before
          ? sql`(${keys}) < (select ${keys} from ${conversationMessages} where ${eq(conversationMessages.id, query.before)})`
          : undefined,
      ),
    )
      .orderBy(
        desc(conversationMessages.createdAt),
        desc(conversationMessages.id),
      )
      .limit(query.limit + 1);
    const hasMore = rows.length > query.limit;
    const items = await toMessages(db, actor, rows.slice(0, query.limit));
    return { items, nextCursor: hasMore ? items.at(-1)!.id : null, hasMore };
  },
});

const reply = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/reply",
  operationId: "replyQuillsConversation",
  summary: "Reply to the customer",
  description:
    "Plain text. Reopens a closed conversation and assigns an unassigned one to the caller. The reply reaches the customer through the delivery worker, never in the request.",
  action: "update",
  params: conversationParams,
  body: z.object({ content: messageText }),
  response: z.object({
    message: messageSchema,
    conversation: conversationItem,
  }),
  responseDescription: "The reply and the updated conversation",
  errors,
  event: (_input, result) => ({
    type: "message.created",
    entityType: "conversation_message",
    entityId: result.message.id,
    payload: { conversationId: result.conversation.id },
  }),
  handler: async ({ db, actor, params, body }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const id = await insertReply(db, actor, conversation, body.content);
    return {
      message: await loadMessage(db, actor, id),
      conversation: await loadConversation(db, conversation.id),
    };
  },
});

const note = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/note",
  operationId: "addQuillsConversationNote",
  summary: "Add an internal note",
  description:
    "Team-only: never sent to the customer and never changes the customer-facing preview. Each mentioned principal must be a teammate of a current workspace member.",
  action: "create",
  params: conversationParams,
  body: z.object({
    content: messageText,
    mentionPrincipalIds: z
      .array(flexibleToTypeIdSchema("principal"))
      .max(20)
      .default([])
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Each principal can appear only once",
      ),
  }),
  response: z.object({ message: messageSchema }),
  responseDescription: "The note",
  errors,
  event: (_input, result) => ({
    type: "message.note_created",
    entityType: "conversation_message",
    entityId: result.message.id,
    payload: { conversationId: result.message.conversationId },
  }),
  load: ({ workspaceId }) => memberUserIds(workspaceId),
  handler: async ({ db, actor, params, body, loaded: members }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const mentioned = await currentTeammates(
      db,
      members,
      body.mentionPrincipalIds,
    );
    if (mentioned.length !== body.mentionPrincipalIds.length)
      throw notFound("Teammate");
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        principalId: actor.principalId,
        senderType: "agent",
        isInternal: true,
        content: body.content,
      })
      .returning({
        id: conversationMessages.id,
        createdAt: conversationMessages.createdAt,
      });
    if (mentioned.length)
      await db.insert(conversationMessageMentions).values(
        mentioned.map((teammate) => ({
          conversationMessageId: message!.id,
          principalId: teammate.id,
        })),
      );
    await db
      .update(conversations)
      .set({ updatedAt: message!.createdAt })
      .where(eq(conversations.id, conversation.id));
    return { message: await loadMessage(db, actor, message!.id) };
  },
});

/** A message a channel already delivered (or is delivering) cannot change here: the copies would diverge. */
function assertLocal(message: Awaited<ReturnType<typeof findMessage>>) {
  if (
    message.metadata?.githubCommentId ||
    message.metadata?.channelDelivery?.status === "pending"
  )
    throw conflict("A message delivered to an external channel cannot change");
}

const editMessage = defineQuillsRoute({
  method: "patch",
  path: "/conversation-messages/{messageId}",
  operationId: "updateQuillsConversationMessage",
  summary: "Edit your own message",
  description:
    "Only the author can edit an agent message or note; nobody rewrites another person's words. An email that was already sent is not changed.",
  action: "update",
  params: messageParams,
  body: z.object({ content: messageText }),
  response: messageSchema,
  responseDescription: "Edited message",
  errors,
  event: ({ params }, result) => ({
    type: result.isInternal ? "message.note_updated" : "message.updated",
    entityType: "conversation_message",
    entityId: params.messageId,
    payload: { conversationId: result.conversationId },
  }),
  handler: async ({ db, actor, params, body }) => {
    const message = await findMessage(db, params.messageId);
    if (
      message.senderType !== "agent" ||
      message.principalId !== actor.principalId
    )
      throw new HTTPException(403, {
        message: "You can only edit your own messages",
      });
    assertLocal(message);
    const now = new Date();
    await db
      .update(conversationMessages)
      .set({
        content: body.content,
        contentJson: null,
        editedAt: now,
        updatedAt: now,
      })
      .where(eq(conversationMessages.id, message.id));
    // The list preview follows an edit of the message that set it.
    if (!message.isInternal)
      await db
        .update(conversations)
        .set({ lastMessagePreview: preview(body.content) })
        .where(
          and(
            eq(conversations.id, message.conversationId),
            eq(conversations.lastMessageAt, message.createdAt),
          ),
        );
    return loadMessage(db, actor, message.id);
  },
});

const deleteMessage = defineQuillsRoute({
  method: "delete",
  path: "/conversation-messages/{messageId}",
  operationId: "deleteQuillsConversationMessage",
  summary: "Delete a message",
  description:
    "Soft delete of any customer or teammate message; needs the delete action, also for your own. System notices cannot be deleted.",
  action: "delete",
  params: messageParams,
  response: z.object({
    id: z.string(),
    conversationId: z.string(),
    isInternal: z.boolean(),
    deletedAt: responseTimestamp,
  }),
  responseDescription: "Deleted message",
  errors,
  event: ({ params }, result) => ({
    type: result.isInternal ? "message.note_deleted" : "message.deleted",
    entityType: "conversation_message",
    entityId: params.messageId,
    payload: { conversationId: result.conversationId },
  }),
  handler: async ({ db, actor, params }) => {
    const message = await findContentMessage(db, params.messageId);
    assertLocal(message);
    // The state in WHERE makes the second of two parallel deletes a 404.
    const [row] = await db
      .update(conversationMessages)
      .set({
        deletedAt: new Date(),
        deletedByPrincipalId: actor.principalId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(conversationMessages.id, message.id),
          isNull(conversationMessages.deletedAt),
        ),
      )
      .returning({ deletedAt: conversationMessages.deletedAt });
    if (!row) throw notFound("Message");
    return {
      id: message.id,
      conversationId: message.conversationId,
      isInternal: message.isInternal,
      deletedAt: row.deletedAt!,
    };
  },
});

const reactionResult = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  changed: z.boolean(),
  reactions: z.array(
    z.object({ emoji: z.string(), count: z.number(), reacted: z.boolean() }),
  ),
});
const reaction = <M extends "put" | "delete">(method: M) =>
  defineQuillsRoute({
    method,
    path: "/conversation-messages/{messageId}/reactions",
    operationId:
      method === "put"
        ? "setQuillsMessageReaction"
        : "removeQuillsMessageReaction",
    summary:
      method === "put"
        ? "React to a message"
        : "Remove your reaction from a message",
    description:
      "Team-only. Idempotent. The caller's own reaction; the emoji is one of a fixed set.",
    action: "update",
    params: messageParams,
    query: z.object({ emoji: z.enum(reactionEmojis) }),
    response: reactionResult,
    responseDescription: "Reactions",
    errors,
    event: ({ params }, result) =>
      result.changed && {
        type: method === "put" ? "message.reacted" : "message.unreacted",
        entityType: "conversation_message",
        entityId: params.messageId,
        payload: { conversationId: result.conversationId },
      },
    handler: async ({ db, actor, params, query }) => {
      const message = await findContentMessage(db, params.messageId);
      const changed =
        method === "put"
          ? await db
              .insert(conversationMessageReactions)
              .values({
                conversationMessageId: message.id,
                principalId: actor.principalId,
                emoji: query.emoji,
              })
              .onConflictDoNothing()
              .returning({ id: conversationMessageReactions.id })
          : await db
              .delete(conversationMessageReactions)
              .where(
                and(
                  eq(
                    conversationMessageReactions.conversationMessageId,
                    message.id,
                  ),
                  eq(
                    conversationMessageReactions.principalId,
                    actor.principalId,
                  ),
                  eq(conversationMessageReactions.emoji, query.emoji),
                ),
              )
              .returning({ id: conversationMessageReactions.id });
      return {
        messageId: message.id,
        conversationId: message.conversationId,
        changed: changed.length > 0,
        reactions:
          (await reactionsFor(db, actor, [message.id])).get(message.id) ?? [],
      };
    },
  });

const flag = <M extends "put" | "delete">(method: M) =>
  defineQuillsRoute({
    method,
    path: "/conversation-messages/{messageId}/flag",
    operationId:
      method === "put" ? "setQuillsMessageFlag" : "removeQuillsMessageFlag",
    summary:
      method === "put"
        ? "Save a message for later"
        : "Remove a message from saved for later",
    description: "A personal marker of the caller. Idempotent.",
    action: "update",
    params: messageParams,
    response: z.object({
      messageId: z.string(),
      flaggedAt: nullableResponseTimestamp,
    }),
    responseDescription: "Flag state",
    errors,
    event: {
      none: "A personal saved-for-later marker: no other teammate's view or data changes.",
    },
    handler: async ({ db, actor, params }) => {
      const message = await findContentMessage(db, params.messageId);
      const mine = and(
        eq(conversationMessageFlags.conversationMessageId, message.id),
        eq(conversationMessageFlags.principalId, actor.principalId),
      );
      if (method === "put")
        await db
          .insert(conversationMessageFlags)
          .values({
            conversationMessageId: message.id,
            principalId: actor.principalId,
          })
          .onConflictDoNothing();
      else await db.delete(conversationMessageFlags).where(mine);
      const [row] = await db
        .select({ flaggedAt: conversationMessageFlags.flaggedAt })
        .from(conversationMessageFlags)
        .where(mine);
      return { messageId: message.id, flaggedAt: row?.flaggedAt ?? null };
    },
  });

const flagged = defineQuillsRoute({
  method: "get",
  path: "/conversation-messages/flagged",
  operationId: "listQuillsFlaggedMessages",
  summary: "List your saved-for-later messages",
  description:
    "The caller's flags on live conversation messages, newest first.",
  action: "read",
  query: z.object({ limit: pagingNumber(1, 100, 100) }),
  response: z.object({
    items: z.array(
      z.object({
        messageId: z.string(),
        conversationId: z.string(),
        preview: z.string(),
        isInternal: z.boolean(),
        authorPrincipalId: z.string().nullable(),
        flaggedAt: responseTimestamp,
      }),
    ),
  }),
  responseDescription: "Flagged messages",
  errors,
  handler: async ({ db, actor, query }) => {
    const rows = await db
      .select({
        messageId: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        content: conversationMessages.content,
        isInternal: conversationMessages.isInternal,
        authorPrincipalId: conversationMessages.principalId,
        flaggedAt: conversationMessageFlags.flaggedAt,
      })
      .from(conversationMessageFlags)
      .innerJoin(
        conversationMessages,
        eq(
          conversationMessages.id,
          conversationMessageFlags.conversationMessageId,
        ),
      )
      .where(
        and(
          eq(conversationMessageFlags.principalId, actor.principalId),
          isNotNull(conversationMessages.conversationId),
          isNull(conversationMessages.deletedAt),
        ),
      )
      .orderBy(desc(conversationMessageFlags.flaggedAt))
      .limit(query.limit);
    return {
      items: rows.map(({ content, conversationId, ...row }) => ({
        ...row,
        conversationId: conversationId!,
        preview: preview(content),
      })),
    };
  },
});

const readState = z.object({
  conversationId: z.string(),
  agentLastReadAt: nullableResponseTimestamp,
  changed: z.boolean(),
});
const readEvent = (
  { params }: { params: { conversationId: string } },
  result: z.output<typeof readState>,
) =>
  result.changed && {
    type: "conversation.read" as const,
    entityType: "conversation" as const,
    entityId: params.conversationId,
  };

const markRead = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/read",
  operationId: "markQuillsConversationRead",
  summary: "Mark a conversation read for the team",
  description:
    "Moves the team's read mark to now. The customer's read mark is not touched.",
  action: "update",
  params: conversationParams,
  response: readState,
  responseDescription: "Read state",
  errors,
  event: readEvent,
  handler: async ({ db, params }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const [row] = await db
      .update(conversations)
      .set({ agentLastReadAt: new Date() })
      .where(eq(conversations.id, conversation.id))
      .returning({ agentLastReadAt: conversations.agentLastReadAt });
    return {
      conversationId: conversation.id,
      agentLastReadAt: row!.agentLastReadAt,
      changed: true,
    };
  },
});

const markUnread = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/unread",
  operationId: "markQuillsConversationUnreadFromMessage",
  summary: "Mark a conversation unread from a message",
  description:
    "Moves the team's read mark to just before the message, never forward. A conversation the team never read stays unread.",
  action: "update",
  params: conversationParams,
  body: z.object({ messageId: flexibleToTypeIdSchema("conversation_msg") }),
  response: readState,
  responseDescription: "Read state",
  errors,
  event: readEvent,
  handler: async ({ db, params, body }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const message = await findMessage(db, body.messageId);
    if (message.conversationId !== conversation.id) throw notFound("Message");
    const anchor = sql`((select ${conversationMessages.createdAt} from ${conversationMessages} where ${eq(conversationMessages.id, message.id)}) - interval '1 microsecond')`;
    const moved = await db
      .update(conversations)
      .set({ agentLastReadAt: anchor })
      .where(
        and(
          eq(conversations.id, conversation.id),
          sql`${conversations.agentLastReadAt} > ${anchor}`,
        ),
      )
      .returning({ agentLastReadAt: conversations.agentLastReadAt });
    return {
      conversationId: conversation.id,
      agentLastReadAt:
        moved[0]?.agentLastReadAt ?? conversation.agentLastReadAt,
      changed: moved.length > 0,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(...listMessages)
  .openapi(...reply)
  .openapi(...note)
  .openapi(...flagged)
  .openapi(...editMessage)
  .openapi(...deleteMessage)
  .openapi(...reaction("put"))
  .openapi(...reaction("delete"))
  .openapi(...flag("put"))
  .openapi(...flag("delete"))
  .openapi(...markRead)
  .openapi(...markUnread);
