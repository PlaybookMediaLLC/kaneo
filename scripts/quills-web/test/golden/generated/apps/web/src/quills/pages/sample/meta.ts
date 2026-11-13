import type { PageMeta } from "../../core/types";
export const meta = {
  id: "sample",
  feature: "sample",
  route: "/portal/$workspaceId/sample",
  audience: "public",
  mailLinked: false,
  token: "none",
  operations: ["getQuillsPublicPortalConfig"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
