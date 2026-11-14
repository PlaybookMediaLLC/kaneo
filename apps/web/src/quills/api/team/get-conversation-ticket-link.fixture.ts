import type { GetConversationTicketLinkResponse } from "./get-conversation-ticket-link";
export const getConversationTicketLinkFixture = {
  ok: (overrides: Partial<GetConversationTicketLinkResponse> = {}) =>
    ({
      ...{ ticket: null },
      ...overrides,
    }) satisfies GetConversationTicketLinkResponse,
  problem: (status: 401 | 403 | 404 | 409 | 429) => ({
    status,
    body: { message: "Request could not be completed" },
  }),
};
