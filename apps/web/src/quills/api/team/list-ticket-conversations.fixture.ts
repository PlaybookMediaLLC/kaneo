import type { ListTicketConversationsResponse } from "./list-ticket-conversations";
export const listTicketConversationsFixture = {
  ok: (overrides: Partial<ListTicketConversationsResponse> = {}) =>
    ({
      ...{ pairConversationId: null, provenanceConversationIds: [], count: 0 },
      ...overrides,
    }) satisfies ListTicketConversationsResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
