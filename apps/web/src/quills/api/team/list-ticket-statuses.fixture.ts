import type { ListTicketStatusesResponse } from "./list-ticket-statuses";
export const listTicketStatusesFixture = {
  ok: (overrides: Partial<ListTicketStatusesResponse> = {}) =>
    ({ ...{ items: [] }, ...overrides }) satisfies ListTicketStatusesResponse,
  problem: (status: 401 | 403 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
