import type { RequestTicketSummaryResponse } from "./request-ticket-summary";
export const requestTicketSummaryFixture = {
  ok: (overrides: Partial<RequestTicketSummaryResponse> = {}) =>
    ({
      ...{ requested: true },
      ...overrides,
    }) satisfies RequestTicketSummaryResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
