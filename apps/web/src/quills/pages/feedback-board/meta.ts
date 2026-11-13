import type { PageMeta } from "../../core/types";
export const meta = {
  id: "feedback-board",
  feature: "feedback",
  route: "/portal/$workspaceId/boards/$boardId",
  audience: "portal",
  mailLinked: true,
  token: "none",
  operations: [
    "listQuillsPortalBoards",
    "listQuillsPortalPosts",
    "listQuillsPortalStatuses",
    "findQuillsPortalSimilarPosts",
    "createQuillsPortalPost",
    "setQuillsPortalVote",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
