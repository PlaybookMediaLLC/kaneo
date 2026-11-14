import type { ListTicketActivityResponse } from "./list-ticket-activity";
export const listTicketActivityFixture = {
  ok: (overrides: Partial<ListTicketActivityResponse> = {}) =>
    ({ ...{ items: [] }, ...overrides }) satisfies ListTicketActivityResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
