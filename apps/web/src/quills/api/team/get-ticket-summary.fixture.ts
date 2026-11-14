import type { GetTicketSummaryResponse } from "./get-ticket-summary";
export const getTicketSummaryFixture = {
  ok: (overrides: Partial<GetTicketSummaryResponse> = {}) =>
    ({
      ...{ ticketId: "ticket_id_test_1", summary: null, updatedAt: null },
      ...overrides,
    }) satisfies GetTicketSummaryResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
