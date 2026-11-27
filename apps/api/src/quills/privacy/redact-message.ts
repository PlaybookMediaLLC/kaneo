import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { apiRouter, z, type BaseVariables } from "../../openapi";
import {
  conversationMessages,
  conversationMessageTranslations,
  conversations,
} from "../../database/quills/schema/conversation";
import { conversationSummaries } from "../../database/quills/schema/conversation-summary";
import { files } from "../../database/quills/schema/files";
import { defineQuillsRoute, type Database } from "../framework/define-route";
import {
  conflict,
  errors,
  findConversation,
  notFound,
} from "../support/conversation-model";
import {
  loadMessage,
  messageSchema,
  type MessageId,
} from "../support/message-model";

const redactParams = z.object({
  conversationId: flexibleToTypeIdSchema("conversation"),
  messageId: flexibleToTypeIdSchema("conversation_msg"),
});

const redactBody = z.object({
  mode: z.enum(["text", "attachments", "both"]),
  replacement: z.string().trim().min(1).max(200).optional(),
  attachmentIds: z.array(flexibleToTypeIdSchema("file")).max(50).optional(),
  reason: z.string().trim().min(1).max(200),
});

async function refreshConversationPreview(
  db: Database,
  conversationId: z.output<typeof redactParams>["conversationId"],
) {
  const visible = sql`m.conversation_id = ${sql.param(conversationId, conversationMessages.conversationId)} and m.deleted_at is null and m.is_internal = false and m.sender_type <> 'system'`;
  await db
    .update(conversations)
    .set({
      lastMessagePreview: sql`(select case when length(m.content) > 140 then left(m.content, 139) || '…' else nullif(m.content, '') end from ${conversationMessages} m where ${visible} order by m.created_at desc, m.id desc limit 1)`,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

const redactMessage = defineQuillsRoute({
  method: "post",
  path: "/conversations/{conversationId}/messages/{messageId}/redact",
  operationId: "redactQuillsConversationMessage",
  summary: "Redact sensitive text or attachments from a message",
  description:
    "Surgically scrubs message text, rich JSON, translations, conversation summaries/embeddings, and/or attached files (queuing storage deletion) while keeping the conversation thread intact.",
  action: "update",
  params: redactParams,
  body: redactBody,
  response: z.object({
    message: messageSchema,
    removedFiles: z.number().int().min(0),
    clearedSummary: z.boolean(),
  }),
  responseDescription: "The redacted message and scrub counts",
  errors,
  event: ({ params, body }) => ({
    type: "message.redacted",
    entityType: "conversation_message",
    entityId: params.messageId,
    payload: {
      conversationId: params.conversationId,
      mode: body.mode,
    },
  }),
  handler: async ({ db, actor, params, body }) => {
    const conversation = await findConversation(
      db,
      params.conversationId,
      true,
    );
    const [message] = await db
      .select({
        id: conversationMessages.id,
        conversationId: conversationMessages.conversationId,
        senderType: conversationMessages.senderType,
        isInternal: conversationMessages.isInternal,
        content: conversationMessages.content,
        attachments: conversationMessages.attachments,
        metadata: conversationMessages.metadata,
      })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.id, params.messageId),
          eq(conversationMessages.conversationId, conversation.id),
          isNull(conversationMessages.deletedAt),
        ),
      )
      .limit(1);

    if (!message) throw notFound("Message");
    if (message.senderType === "system") {
      throw conflict("System notices cannot be redacted");
    }

    const redactText = body.mode === "text" || body.mode === "both";
    const redactAttachments =
      body.mode === "attachments" || body.mode === "both";
    const now = new Date();
    const replacement = body.replacement ?? "[Redacted]";

    let nextAttachments = message.attachments;
    let removedFiles = 0;

    if (redactAttachments) {
      const targetFileIds = body.attachmentIds?.length
        ? new Set<string>(body.attachmentIds)
        : null;

      if (Array.isArray(message.attachments)) {
        nextAttachments = targetFileIds
          ? message.attachments.filter(
              (att) => !att.fileId || !targetFileIds.has(att.fileId),
            )
          : [];
      }

      // Delete matching rows in quills.files so the quills_storage_changes trigger queues
      // object + thumbnail/rendition deletion in public.storage_cleanup inside this transaction.
      const deletedFiles = await db
        .delete(files)
        .where(
          and(
            eq(files.messageId, message.id),
            targetFileIds
              ? inArray(files.id, [...targetFileIds] as Array<
                  typeof files.$inferSelect.id
                >)
              : undefined,
          ),
        )
        .returning({ id: files.id });
      removedFiles = deletedFiles.length;
    }

    let nextMetadata = message.metadata;
    if (redactText && nextMetadata && "translatedFrom" in nextMetadata) {
      const { translatedFrom: _, ...rest } = nextMetadata as Record<
        string,
        unknown
      >;
      nextMetadata = rest as typeof message.metadata;
    }

    await db
      .update(conversationMessages)
      .set({
        ...(redactText
          ? {
              content: replacement,
              contentJson: null,
              metadata: nextMetadata,
            }
          : {}),
        ...(redactAttachments
          ? {
              attachments:
                nextAttachments && nextAttachments.length > 0
                  ? nextAttachments
                  : null,
            }
          : {}),
        redactedAt: now,
        redactedByPrincipalId: actor.principalId,
        redactionReason: body.reason,
        updatedAt: now,
      })
      .where(eq(conversationMessages.id, message.id));

    let clearedSummary = false;
    if (redactText) {
      await db
        .delete(conversationMessageTranslations)
        .where(
          eq(conversationMessageTranslations.conversationMessageId, message.id),
        );

      // Clear any cached summary + embedding for the conversation so stale vectors cannot leak
      // the redacted secret in past-conversation retrieval.
      const deletedSummaries = await db
        .delete(conversationSummaries)
        .where(eq(conversationSummaries.conversationId, conversation.id))
        .returning({ id: conversationSummaries.id });
      clearedSummary = deletedSummaries.length > 0;

      if (!message.isInternal) {
        await refreshConversationPreview(db, conversation.id);
      }
    }

    return {
      message: await loadMessage(db, actor, message.id as MessageId),
      removedFiles,
      clearedSummary,
    };
  },
});

export default apiRouter<BaseVariables & { workspaceId: string }>().openapi(
  ...redactMessage,
);
