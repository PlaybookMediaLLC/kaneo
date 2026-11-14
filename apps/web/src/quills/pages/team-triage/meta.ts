import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-triage",
  feature: "team-triage",
  route: "/dashboard/workspace/$workspaceId/quills/triage",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: [
    "listQuillsPosts",
    "getQuillsRevenueAtRisk",
    "listQuillsBoards",
    "getQuillsBoardSettings",
    "setQuillsPostScore",
    "updateQuillsBoardSettings",
  ],
  states: ["loading", "failed", "ready", "done"],
} satisfies PageMeta;
