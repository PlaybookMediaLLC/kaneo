import type { PageMeta } from "../../core/types";
export const meta = {
  id: "team-tickets",
  feature: "team-tickets",
  route: "/feedback/$workspaceId/tickets",
  audience: "teammate",
  mailLinked: false,
  token: "none",
  operations: ["listQuillsTickets", "listQuillsTicketStatuses"],
  states: ["loading", "failed", "empty", "ready"],
} satisfies PageMeta;
