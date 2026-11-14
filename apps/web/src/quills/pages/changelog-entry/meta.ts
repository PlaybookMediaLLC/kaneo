import type { PageMeta } from "../../core/types";
export const meta = {
  id: "changelog-entry",
  feature: "changelog",
  route: "/portal/$workspaceId/changelog/$entryId",
  audience: "portal",
  mailLinked: true,
  token: "none",
  operations: [
    "getQuillsPortalChangelogEntry",
    "setQuillsPortalChangelogReaction",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
