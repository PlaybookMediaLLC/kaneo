import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-triage",
  feature: "team-triage",
  route: "/feedback/$workspaceId/triage",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "listQuillsPosts",
    "getQuillsRevenueAtRisk",
    "setQuillsPostScore",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
