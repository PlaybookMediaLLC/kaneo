import type { ListTicketExternalLinksResponse } from "./list-ticket-external-links";
export const listTicketExternalLinksFixture = {
  ok: (overrides: Partial<ListTicketExternalLinksResponse> = {}) =>
    ({
      ...{ links: [], trackers: [] },
      ...overrides,
    }) satisfies ListTicketExternalLinksResponse,
  problem: (status: 400 | 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
