// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { z } from "../../../openapi";
import { attachTag, resolveLiveTag } from "../../support/conversation-ops";
import { conversationChange, defineWriteTool } from "../ai/tool";

export const addConversationTag = defineWriteTool({
  name: "add_conversation_tag",
  description:
    "Propose a tag (by its ID) for the current conversation. A teammate must approve it.",
  args: z.object({ tagId: flexibleToTypeIdSchema("conversation_tag") }),
  action: "update",
  approval: "required",
  available: (context) => Boolean(context.conversationId),
  summary: (args) => `Tag the conversation with ${args.tagId}`,
  previewDiff: (conversation, args) => ({
    targetType: "conversation",
    targetId: conversation?.id ?? null,
    fields: [{ field: "tagId", before: null, after: args.tagId }],
    recordCount: 1,
  }),
  execute: async (db, _actor, conversation, args) => {
    const tagId = await resolveLiveTag(
      db,
      args.tagId as TypeId<"conversation_tag">,
    );
    return (await attachTag(db, conversation, tagId))
      ? conversationChange(conversation, "conversation.tags_changed")
      : null;
  },
});
