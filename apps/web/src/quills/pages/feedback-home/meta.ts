// quills-web-allow C11: portal/feedback-composer.tsx composes createQuillsPortalPost with the file uploads for this page.
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
    "listQuillsPortalStatuses",
    "getQuillsPortalUserStats",
    "setQuillsPortalVote",
    "findQuillsPortalSimilarPosts",
    "createQuillsPortalPost",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
