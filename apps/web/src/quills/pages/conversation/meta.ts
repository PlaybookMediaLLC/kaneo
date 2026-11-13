import type { PageMeta } from "../../core/types";
export const meta = {
  id: "conversation",
  feature: "conversation",
  route: "/portal/$workspaceId/conversations/$conversationId",
  audience: "signed-in",
  mailLinked: true,
  token: "none",
  operations: [
    "getQuillsMyConversation",
    "listQuillsMyConversationMessages",
    "sendQuillsMyConversationMessage",
    "markQuillsMyConversationRead",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
