import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-changelog",
  feature: "team-changelog",
  route: "/dashboard/workspace/$workspaceId/quills/changelog",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "listQuillsChangelogEngagement",
    "searchQuillsShippedPosts",
    "draftQuillsChangelogFromPosts",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
