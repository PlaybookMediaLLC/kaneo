import type { MarkTicketReadResponse } from "./mark-ticket-read";
export const markTicketReadFixture = {
  ok: (overrides: Partial<MarkTicketReadResponse> = {}) =>
    ({
      ...{ agentLastReadAt: null },
      ...overrides,
    }) satisfies MarkTicketReadResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
