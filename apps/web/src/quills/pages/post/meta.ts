import type { PageMeta } from "../../core/types";
export const meta = {
  id: "post",
  feature: "post",
  route: "/portal/$workspaceId/posts/$postId",
  audience: "portal",
  mailLinked: true,
  token: "none",
  operations: [
    "getQuillsPortalPost",
    "listQuillsPortalPostComments",
    "setQuillsPortalVote",
    "createQuillsPortalComment",
    "editQuillsPortalOwnPost",
    "deleteQuillsPortalOwnPost",
    "editQuillsPortalOwnComment",
    "deleteQuillsPortalOwnComment",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
