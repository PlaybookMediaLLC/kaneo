// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { eq } from "drizzle-orm";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { z } from "../../../openapi";
import { defineWriteTool } from "../ai/tool";

// A note only teammates see. Defaults to `required` approval under safe AI actions (#300)
// unless an admin explicitly opts it into `auto_write`.
export const addPrivateNote = defineWriteTool({
  name: "add_private_note",
  description:
    "Propose adding a private note to the current conversation, for example a summary or a next step. Only teammates see it; the customer never does.",
  args: z.object({ content: z.string().trim().min(1).max(4000) }),
  // Requires update so the approval route (quills:update) matches the tool action.
  action: "update",
  approval: "required",
  available: (context) => Boolean(context.conversationId),
  summary: (args) => `Add a private note: ${args.content.slice(0, 120)}`,
  previewDiff: (conversation, args) => ({
    targetType: "conversation",
    targetId: conversation?.id ?? null,
    fields: [{ field: "privateNote", before: null, after: args.content }],
    recordCount: 1,
  }),
  execute: async (db, actor, conversation, args) => {
    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId: conversation.id,
        principalId: actor.principalId,
        senderType: "agent",
        isInternal: true,
        content: args.content,
      })
      .returning({
        id: conversationMessages.id,
        createdAt: conversationMessages.createdAt,
      });
    await db
      .update(conversations)
      .set({ updatedAt: message!.createdAt })
      .where(eq(conversations.id, conversation.id));
    return {
      type: "message.note_created",
      entityType: "conversation_message",
      entityId: message!.id,
      payload: { conversationId: conversation.id },
    };
  },
});
