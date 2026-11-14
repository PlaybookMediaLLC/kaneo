import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-insights",
  feature: "insights",
  route: "/feedback/$workspaceId/insights",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: ["getQuillsFeedbackInsights"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
