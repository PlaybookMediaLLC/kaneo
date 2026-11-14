// quills-web-allow C11: portal/feedback-composer.tsx composes createQuillsPortalPost with the file uploads, and portal/similar-requests.tsx reads listQuillsPortalVotedPosts for the similar posts of this page.
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
    "listQuillsPortalVotedPosts",
    "createQuillsPortalPost",
    "getQuillsPortalActiveSurvey",
    "submitQuillsPortalSurveyResponse",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
