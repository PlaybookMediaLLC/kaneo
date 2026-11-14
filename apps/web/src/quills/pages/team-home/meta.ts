import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-home",
  feature: "team",
  route: "/dashboard/workspace/$workspaceId/quills",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: ["fetchQuillsAdminOverview", "listQuillsBoards"],
  states: ["loading", "failed", "ready"],
} satisfies PageMeta;
