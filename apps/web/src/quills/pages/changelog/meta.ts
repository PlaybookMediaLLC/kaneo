import type { PageMeta } from "../../core/types";
export const meta = {
  id: "changelog",
  feature: "changelog",
  route: "/portal/$workspaceId/changelog",
  audience: "portal",
  mailLinked: true,
  token: "none",
  operations: [
    "listQuillsPortalChangelog",
    "listQuillsPortalVotedPosts",
    "setQuillsPortalChangelogReaction",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
