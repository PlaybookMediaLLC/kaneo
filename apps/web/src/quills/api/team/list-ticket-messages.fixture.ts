import type { ListTicketMessagesResponse } from "./list-ticket-messages";
export const listTicketMessagesFixture = {
  ok: (overrides: Partial<ListTicketMessagesResponse> = {}) =>
    ({
      ...{ items: [], nextCursor: null, hasMore: false },
      ...overrides,
    }) satisfies ListTicketMessagesResponse,
  problem: (status: 401 | 403 | 404 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
