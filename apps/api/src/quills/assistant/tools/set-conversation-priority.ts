// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import { z } from "../../../openapi";
import { priorities } from "../../support/conversation-model";
import { setPriority } from "../../support/conversation-ops";
import { conversationChange, defineWriteTool } from "../ai/tool";

export const setConversationPriority = defineWriteTool({
  name: "set_conversation_priority",
  description:
    "Propose a new priority for the current conversation. A teammate must approve it.",
  args: z.object({ priority: z.enum(priorities) }),
  action: "update",
  approval: "required",
  available: (context) => Boolean(context.conversationId),
  summary: (args) => `Set the conversation priority to ${args.priority}`,
  previewDiff: (conversation, args) => ({
    targetType: "conversation",
    targetId: conversation?.id ?? null,
    fields: [
      {
        field: "priority",
        before: conversation?.priority ?? null,
        after: args.priority,
      },
    ],
    recordCount: 1,
  }),
  execute: async (db, actor, conversation, args) =>
    (await setPriority(db, actor, conversation, args.priority))
      ? conversationChange(conversation, "conversation.priority_changed", {
          priority: args.priority,
        })
      : null,
});
