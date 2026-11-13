import type { PageMeta } from "../../core/types";
export const meta = {
  id: "feedback-home",
  feature: "feedback",
  route: "/portal/$workspaceId/",
  audience: "portal",
  mailLinked: true,
  token: "none",
  operations: [
    "listQuillsPortalBoards",
    "listQuillsPortalPosts",
    "findQuillsPortalSimilarPosts",
    "createQuillsPortalPost",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
