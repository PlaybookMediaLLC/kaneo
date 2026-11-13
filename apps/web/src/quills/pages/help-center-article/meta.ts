import type { PageMeta } from "../../core/types";
export const meta = {
  id: "help-center-article",
  feature: "help-center",
  route: "/portal/$workspaceId/hc/$locale/articles/$idSlug",
  audience: "public",
  mailLinked: true,
  token: "none",
  operations: ["getQuillsPublicHelpCenterArticle"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
