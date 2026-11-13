import type { PageMeta } from "../../core/types";
export const meta = {
  id: "tickets",
  feature: "tickets",
  route: "/portal/$workspaceId/support/tickets",
  audience: "signed-in",
  mailLinked: false,
  token: "none",
  operations: ["getQuillsMyTickets", "createQuillsMyTicket"],
  states: [
    "loading",
    "empty",
    "conflict",
    "rateLimited",
    "failed",
    "ready",
    "done",
  ],
} satisfies PageMeta;
