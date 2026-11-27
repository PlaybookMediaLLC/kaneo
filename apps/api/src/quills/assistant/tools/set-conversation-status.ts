// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { z } from "../../../openapi";
import { statuses } from "../../support/conversation-model";
import { requireClosable, setStatus } from "../../support/conversation-ops";
import { conversationChange, defineWriteTool } from "../ai/tool";

export const setConversationStatus = defineWriteTool({
  name: "set_conversation_status",
  description:
    "Propose a new status for the current conversation. A teammate must approve it.",
  args: z.object({ status: z.enum(statuses) }),
  action: "update",
  approval: "required",
  available: (context) => Boolean(context.conversationId),
  summary: (args) => `Set the conversation status to ${args.status}`,
  previewDiff: (conversation, args) => ({
    targetType: "conversation",
    targetId: conversation?.id ?? null,
    fields: [
      {
        field: "status",
        before: conversation?.status ?? null,
        after: args.status,
      },
    ],
    recordCount: 1,
  }),
  // As setQuillsConversationStatus: a close needs every required attribute.
  execute: async (db, _actor, conversation, args) => {
    if (args.status === "closed" && conversation.status !== "closed")
      await requireClosable(db, conversation);
    return (await setStatus(db, conversation, args.status))
      ? conversationChange(conversation, "conversation.status_changed", {
          status: args.status,
        })
      : null;
  },
});
