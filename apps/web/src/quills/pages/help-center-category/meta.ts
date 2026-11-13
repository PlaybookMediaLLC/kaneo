import type { PageMeta } from "../../core/types";
export const meta = {
  id: "help-center-category",
  feature: "help-center",
  route: "/portal/$workspaceId/hc/$locale/collections/$idSlug",
  audience: "public",
  mailLinked: true,
  token: "none",
  operations: ["getQuillsPublicHelpCenterCategory"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
