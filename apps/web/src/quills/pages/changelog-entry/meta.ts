import type { PageMeta } from "../../core/types";
export const meta = {
  id: "changelog-entry",
  feature: "changelog",
  route: "/portal/$workspaceId/changelog/$entryId",
  audience: "portal",
  mailLinked: true,
  token: "none",
  operations: ["getQuillsPortalChangelogEntry"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
