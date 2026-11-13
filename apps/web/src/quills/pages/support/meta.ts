import type { PageMeta } from "../../core/types";
export const meta = {
  id: "support",
  feature: "support",
  route: "/portal/$workspaceId/support",
  audience: "signed-in",
  mailLinked: false,
  token: "none",
  operations: ["listQuillsMyConversations", "startQuillsMyConversation"],
  states: [
    "loading",
    "empty",
    "conflict",
    "rateLimited",
    "failed",
    "ready",
    "done",
  ],
} satisfies PageMeta;
