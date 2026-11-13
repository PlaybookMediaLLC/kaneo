// quills-web-allow C11: Upload operations are composed in core/use-feedback-attachments.ts and retain their generated hook contracts.
import type { PageMeta } from "../../core/types";
export const meta = {
  id: "post",
  feature: "post",
  route: "/portal/$workspaceId/posts/$postId",
  audience: "portal",
  mailLinked: true,
  token: "none",
  operations: [
    "getQuillsPortalFile",
    "setQuillsPortalFollow",
    "prepareQuillsPortalUpload",
    "createQuillsPortalUpload",
    "createQuillsPortalFiles",
    "discardQuillsPortalFile",
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
