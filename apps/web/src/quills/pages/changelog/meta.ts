import type { PageMeta } from "../../core/types";
export const meta = {
  id: "changelog",
  feature: "changelog",
  route: "/portal/$workspaceId/changelog",
  audience: "portal",
  mailLinked: true,
  token: "none",
  operations: ["listQuillsPortalChangelog", "listQuillsPortalVotedPosts"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
