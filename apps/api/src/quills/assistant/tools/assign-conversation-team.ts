// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.
import type { TypeId } from "@kaneo/ids";
import { flexibleToTypeIdSchema } from "@kaneo/ids/zod";
import { z } from "../../../openapi";
import { assignTeam, resolveTeam } from "../../support/conversation-ops";
import { conversationChange, defineWriteTool } from "../ai/tool";

export const assignConversationTeam = defineWriteTool({
  name: "assign_conversation_team",
  description:
    "Propose a team (by its ID) for the current conversation. A teammate must approve it.",
  args: z.object({ teamId: flexibleToTypeIdSchema("team") }),
  action: "update",
  approval: "required",
  available: (context) => Boolean(context.conversationId),
  summary: (args) => `Assign the conversation to the team ${args.teamId}`,
  previewDiff: (conversation, args) => ({
    targetType: "conversation",
    targetId: conversation?.id ?? null,
    fields: [
      {
        field: "assignedTeamId",
        before: conversation?.assignedTeamId ?? null,
        after: args.teamId,
      },
    ],
    recordCount: 1,
  }),
  execute: async (db, actor, conversation, args) => {
    const team = await resolveTeam(db, args.teamId as TypeId<"team">);
    return (await assignTeam(db, actor, conversation, team))
      ? conversationChange(conversation, "conversation.assigned", {
          field: "team",
          cleared: "false",
        })
      : null;
  },
});
