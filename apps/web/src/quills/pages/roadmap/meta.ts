import type { PageMeta } from "../../core/types";
export const meta = {
  id: "roadmap",
  feature: "roadmap",
  route: "/portal/$workspaceId/roadmap",
  audience: "portal",
  mailLinked: false,
  token: "none",
  operations: [
    "listQuillsPortalStatuses",
    "listQuillsPortalBoards",
    "listQuillsPortalPosts",
    "setQuillsPortalVote",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
