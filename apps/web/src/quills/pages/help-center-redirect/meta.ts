import type { PageMeta } from "../../core/types";
export const meta = {
  id: "help-center-redirect",
  feature: "help-center",
  route: "/portal/$workspaceId/hc/$",
  audience: "public",
  mailLinked: false,
  token: "none",
  operations: ["resolveQuillsPublicHelpCenterRedirect"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
