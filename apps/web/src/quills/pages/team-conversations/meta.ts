import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-conversations",
  feature: "team-conversations",
  route: "/feedback/$workspaceId/conversations/mine",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "listQuillsConversationViews",
    "listQuillsConversations",
    "listQuillsPrincipals",
    "listQuillsUsers",
    "startQuillsAgentConversation",
    "createQuillsConversationView",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
