import type { ListTicketWatchersResponse } from "./list-ticket-watchers";
export const listTicketWatchersFixture = {
  ok: (overrides: Partial<ListTicketWatchersResponse> = {}) =>
    ({ ...{ items: [] }, ...overrides }) satisfies ListTicketWatchersResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
